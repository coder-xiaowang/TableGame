const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {once} = require('node:events');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const startServer = require('./start-authoritative-game-server');

async function openTable(t, game, capacity, {random = Math.random, start = true, onStart} = {}) {
  const rules = await import(`../../${game}/server/game-engine.mjs`);
  const engine = {...rules, applyAction(state, actor, action, context) {
    const result = rules.applyAction(state, actor, action, {...context,random});
    if (action.type === 'start') onStart?.(state, rules);
    return result;
  }};
  const server = startServer({gameRoot:path.resolve(__dirname, '../..', game), engine, defaultPort:0});
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = 'http://127.0.0.1:' + server.address().port;
  async function post(route, body) {
    const response = await fetch(base + route, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    return response.json();
  }
  const host = await post('/api/rooms', {hostId:'p0', capacity});
  const {roomCode} = host;
  const seats = [host];
  for (let i = 1; i < capacity; i++) seats.push(await post('/api/join', {roomCode, clientId:'p'+i}));
  for (const {clientId,resumeToken} of seats) {
    const query = new URLSearchParams({clientId,roomCode,resumeToken});
    const [stream] = await once(http.get(base+'/api/events?'+query), 'response');
    await once(stream, 'data');
    stream.resume();
  }
  const view = seat => post('/api/join', {roomCode, clientId:seat.clientId, resumeToken:seat.resumeToken});
  const act = (seat, action, expectedVersion, actionId=randomUUID()) => post('/api/actions', {
    roomCode, playerId:seat.clientId, resumeToken:seat.resumeToken, action, expectedVersion, actionId
  });
  async function play(seat, action) {
    const result = await act(seat,action,(await view(seat)).version);
    assert.ok(result.ok,result.code);
  }
  if (start) await play(host,{type:'start'});
  return {host,seats,view,act,play};
}

// All players have seen the same snapshot when they click. None has time to
// receive the others' SSE updates before their HTTP requests leave.
async function together(table, seats, choose) {
  const snapshots = await Promise.all(seats.map(table.view));
  const version = snapshots[0].version;
  assert.ok(snapshots.every(s => s.version === version));
  const results = await Promise.all(seats.map((s,i) => table.act(s,choose(snapshots[i].view),version)));
  assert.deepEqual(results.map(r => r.code || r.ok), seats.map(() => true));
  return version;
}

test('bull: ten simultaneous card locks reveal exactly ten plays', async t => {
  const table = await openTable(t,'game6',10);
  const version = await together(table,table.seats,view => ({
    type:'selectCard',card:view.players.find(p=>p.id===view.selfId).hand[0]
  }));
  const after = await table.view(table.host);
  assert.equal(after.view.phase,'revealing');
  assert.equal(after.view.revealedPlays.length,10);
  assert.equal(after.version,version+10);
});

test('avalon: concurrent ballots close once; an earlier proposal cannot vote on the next one', async t => {
  const table = await openTable(t,'game22',5);
  await together(table,table.seats,()=>({type:'acknowledgeSecret'}));
  const team = table.seats.slice(0,2).map(s=>s.clientId);
  async function propose() {
    const {view,version} = await table.view(table.host);
    const leader = table.seats.find(s=>s.clientId===view.leaderId);
    assert.ok((await table.act(leader,{type:'proposeTeam',memberIds:team},version)).ok);
  }
  await propose();
  const previous = await together(table,table.seats,()=>({type:'submitTeamVote',approve:false}));
  await propose();
  const current = (await table.view(table.host)).version;
  const ballot = {type:'submitTeamVote',approve:true};
  const id = randomUUID();
  assert.ok((await table.act(table.host,ballot,current,id)).ok);
  assert.ok((await table.act(table.host,ballot,current,id)).duplicate);
  const peerView = (await table.view(table.seats[1])).view;
  assert.deepEqual(peerView.teamVoteProgress,[table.host.clientId]);
  assert.equal(peerView.myTeamVote,null);
  assert.equal((await table.act(table.seats[1],ballot,current+5)).code,'version_conflict');
  assert.equal((await table.act(table.host,{...ballot,approve:false},current)).code,'version_conflict');
  assert.equal((await table.act(table.seats[1],ballot,previous)).code,'version_conflict');
  assert.equal((await table.act(table.host,{type:'end'},current)).code,'version_conflict');
  for (const seat of table.seats.slice(1)) assert.ok((await table.act(seat,ballot,current)).ok);
  assert.equal((await table.view(table.host)).view.phase,'questAction');
  const questVersion = (await table.view(table.host)).version;
  const questCard = {type:'submitQuestCard',card:'success'};
  assert.ok((await table.act(table.seats[0],questCard,questVersion)).ok);
  assert.equal((await table.act(table.seats[2],questCard,questVersion)).code,'not_on_quest');
  assert.ok((await table.act(table.seats[1],questCard,questVersion)).ok);
  assert.equal((await table.view(table.host)).view.phase,'questReveal');
});

test('dixit: simultaneous decoys and votes retain the private choices and settle the round', async t => {
  const table = await openTable(t,'game23',5);
  const {storytellerId} = (await table.view(table.host)).view;
  const teller = table.seats.find(s=>s.clientId===storytellerId);
  const others = table.seats.filter(s=>s!==teller);
  const story = await table.view(teller);
  assert.ok((await table.act(teller,{type:'submitStory',cardId:story.view.hand[0].id,clueMode:'text',clueText:'梦'},story.version)).ok);
  await together(table,others,v=>({type:'submitDecoys',cardIds:[v.hand[0].id]}));
  await together(table,others,v=>({type:'submitVote',displayId:v.displayCards.find(c=>!v.ownDisplayIds.includes(c.displayId)).displayId}));
  assert.equal(Object.keys((await table.view(teller)).view.roundResult.votes).length,others.length);
});

test('cabo: four players independently peek at their own cards', async t => {
  const table = await openTable(t,'game13',4);
  await together(table,table.seats,v => ({type:'initialPeek',slotIds:v.players.find(p=>p.id===v.selfId).slots.slice(0,2).map(s=>s.slotId)}));
  const {view} = await table.view(table.host);
  assert.equal(view.phase,'initialReveal');
  assert.ok(view.players.filter(p=>p.id!==table.host.clientId).every(p=>p.slots.every(s=>s.value===null)));
});

test('spy: simultaneous secret confirmations and accusation votes', async t => {
  const table = await openTable(t,'game21',6);
  await together(table,table.seats,()=>({type:'acknowledgeSecret'}));
  await table.play(table.host,{type:'accuse',targetId:table.seats[1].clientId});
  await together(table,table.seats.slice(2),()=>({type:'voteAccusation',agree:true}));
  assert.equal((await table.view(table.host)).view.phase,'roundEnd');
});

test('insider: each eligible player gets one vote in both ballots', async t => {
  const table = await openTable(t,'game20',5);
  const snapshots = await Promise.all(table.seats.map(table.view));
  const byRole = role => table.seats[snapshots.findIndex(s=>s.view.privateRole===role)];
  const master = byRole('master'), insider = byRole('insider'), guesser = byRole('common');
  await together(table,[master,insider],()=>({type:'acknowledgeSecret'}));
  await table.play(master,{type:'markCorrectGuesser',playerId:guesser.clientId});
  await together(table,table.seats,()=>({type:'readyToVote'}));
  await together(table,table.seats.filter(s=>s!==guesser),()=>({type:'submitFirstVote',accuse:false}));
  await together(table,table.seats,()=>({type:'submitSecondVote',targetId:insider.clientId}));
  assert.equal((await table.view(table.host)).view.result.accusedId,insider.clientId);
});

for (const cardType of ['trade','passLeft']) {
  test('criminal: simultaneous '+cardType+' selections exchange each card once', async t => {
    // This deal puts both exchange cards in the first acting player's hand.
    const table = await openTable(t,'game18',5,{random:()=>0.4});
    const seat = id => table.seats.find(s=>s.clientId===id);
    const ownHand = v => v.players.find(p=>p.id===v.selfId).hand;
    const opened = (await table.view(table.host)).view;
    await table.play(seat(opened.pending.actorId),{type:'submitCase',text:'消失的布丁'});
    const actor = seat((await table.view(table.host)).view.currentPlayerId);
    const card = ownHand((await table.view(actor)).view).find(c=>c.type===cardType);
    await table.play(actor,{type:'playCard',cardId:card.id});
    let participants = table.seats, type = 'submitPassCard';
    if (cardType==='trade') {
      const target = table.seats.find(s=>s!==actor);
      await table.play(actor,{type:'chooseTarget',targetId:target.clientId});
      participants = [actor,target];
      type = 'submitTradeCard';
    }
    const before = (await Promise.all(participants.map(table.view))).map(s=>ownHand(s.view)[0].id);
    await together(table,participants,v=>({type,cardId:ownHand(v)[0].id}));
    const after = await Promise.all(participants.map(table.view));
    assert.equal(after[0].view.phase,'turn');
    const hands = after.map(s=>ownHand(s.view).map(c=>c.id));
    before.forEach((id,i)=>{
      assert.ok(!hands[i].includes(id));
      assert.equal(hands.flat().filter(cardId=>cardId===id).length,1);
    });
  });
}

test('cipher: all words and answers count once, and delayed answers cannot enter the next question', async t => {
  const table = await openTable(t,'game',6,{start:false});
  await table.play(table.host,{type:'configure',gameMode:'playerWords'});
  await table.play(table.host,{type:'start'});
  await together(table,table.seats,v=>({type:'submitWord',word:'word-'+v.selfId}));
  const playing = (await table.view(table.host)).view;
  assert.equal(playing.phase,'playing');
  const asker = table.seats.find(s=>s.clientId===playing.players.find(p=>p.isCurrent).id);
  await table.play(asker,{type:'question',text:'Is it blue?'});
  const answer = {type:'answer',answer:'yes'};
  const others = table.seats.filter(s=>s!==asker);
  const oldVersion = await together(table,others,()=>answer);
  assert.equal((await table.view(asker)).view.currentQuestion,null);
  await table.play(asker,{type:'skip'});
  const next = (await table.view(asker)).view.players.find(p=>p.isCurrent);
  await table.play(table.seats.find(s=>s.clientId===next.id),{type:'question',text:'Is it red?'});
  const voter = others.find(s=>s.clientId!==next.id);
  assert.equal((await table.act(voter,answer,oldVersion)).code,'version_conflict');
  assert.deepEqual((await table.view(voter)).view.currentQuestion.answers,{});
});

test('words: independent seats can change together, a contested seat has one occupant', async t => {
  const table = await openTable(t,'game2',4,{start:false});
  const index = new Map(table.seats.map((s,i)=>[s.clientId,i]));
  await together(table,table.seats,v=>({type:'sit',seatIndex:index.get(v.selfId)}));
  assert.deepEqual((await table.view(table.host)).view.players.map(p=>p.seatIndex),[0,1,2,3]);
  await together(table,table.seats,()=>({type:'leaveSeat'}));
  const {version} = await table.view(table.host);
  const results = await Promise.all(table.seats.slice(0,2).map(s=>table.act(s,{type:'sit',seatIndex:1},version)));
  assert.deepEqual(results.map(r=>r.code || 'ok').sort(),['ok','seat_taken']);
});

test('manila: only the named share changes, including simultaneous redemptions and mortgages', async t => {
  const table = await openTable(t,'game7',4);
  const own = v=>v.players.find(p=>p.id===v.selfId);
  await together(table,table.seats,v=>({type:'mortgage',shareId:own(v).shares[0].shareId}));
  const {version} = await table.view(table.host);
  const shares = (await Promise.all(table.seats.map(table.view))).map(r=>own(r.view).shares);
  const invalid = await table.act(table.seats[0],{type:'redeem',shareId:shares[1][0].shareId},version);
  assert.equal(invalid.code,'invalid_redeem');
  await together(table,table.seats,v=>own(v).isHost
    ? {type:'mortgage',shareId:own(v).shares[1].shareId}
    : {type:'redeem',shareId:own(v).shares[0].shareId});
  for (const seat of table.seats) {
    const player = own((await table.view(seat)).view);
    assert.equal(player.cash,player.isHost?54:27);
    assert.ok(player.shares.every(s=>s.mortgaged===player.isHost));
  }
});

for (const mode of ['guess','tiebreak']) {
  test('decrypto: both teams submit in the same '+mode+' window', async t => {
    const table = await openTable(t,'game11',4,{start:false,onStart(state,rules) {
      if (mode==='tiebreak') { state.phase='tiebreak'; return; }
      // Advance both first-round transmissions via their normal timeout handlers.
      for (let i=0;i<7;i++) assert.ok(rules.handleTimeout(state,{now:state.deadline}));
      assert.equal(state.phase,'guess');
      assert.equal(state.round,2);
    }});
    await together(table,table.seats,v=>({type:'sit',team:table.seats.findIndex(s=>s.clientId===v.selfId)%2?'white':'black'}));
    await table.play(table.host,{type:'start'});
    const views = await Promise.all(table.seats.map(table.view));
    const eligible = table.seats.filter((s,i)=>mode==='guess'?views[i].view.permissions.guessRole:views[i].view.permissions.canSubmitTiebreak);
    assert.equal(eligible.length,2);
    if (mode==='tiebreak') {
      await together(table,eligible,()=>({type:'tiebreak',words:['one','two','three','four']}));
      assert.equal((await table.view(table.host)).view.phase,'ended');
      return;
    }
    const draft = {type:'guessDraft',code:[1,2,3]};
    const lock = {type:'guess',code:[2,3,4]};
    const old = await together(table,eligible,()=>draft);
    const {version} = await table.view(eligible[0]);
    assert.ok((await table.act(eligible[0],lock,version)).ok);
    assert.ok((await table.act(eligible[1],draft,version)).ok);
    assert.equal((await table.act(eligible[1],lock,old)).code,'version_conflict');
    await table.play(eligible[1],lock);
    const view = (await table.view(table.host)).view;
    assert.equal(view.phase,'reveal');
    assert.deepEqual(view.records.at(-1).decodeGuess,lock.code);
    assert.deepEqual(view.records.at(-1).interceptGuess,lock.code);
  });
}

for (const decision of ['pass','challenge','block']) {
  test('coup: '+decision+' after other players pass on the same declaration', async t => {
    const table = await openTable(t,'game16',5);
    const initial = (await table.view(table.host)).view;
    const actor = table.seats.find(s=>s.clientId===initial.currentPlayerId);
    await table.play(actor,{type:'declareAction',actionType:decision==='block'?'foreignAid':'tax'});
    const {view,version} = await table.view(actor);
    const reaction = {reactionId:view.reaction.id,reactionKind:view.reaction.kind};
    const others = table.seats.filter(s=>s!==actor);
    if (decision==='pass') {
      await together(table,others,()=>({type:'pass',...reaction}));
      assert.equal((await table.view(actor)).view.phase,'action');
      return;
    }
    await table.play(others[0],{type:'pass',...reaction});
    const action = {type:decision,role:'duke',...reaction};
    const afterPass = (await table.view(actor)).version;
    assert.equal((await table.act(others[0],action,afterPass)).code,decision+'_not_allowed');
    assert.ok((await table.act(others[1],action,version)).ok);
    assert.equal((await table.act(others[2],action,version)).code,'version_conflict');
    assert.equal((await table.view(actor)).view.phase,decision==='block'?'challengeBlock':'proveClaim');
  });
}

test('UNO: a catch permits the current draw, a closed window cannot penalize anyone twice', async t => {
  const table = await openTable(t,'game5',4,{onStart(state) {
    const player = state.players[(state.currentIndex+3)%4];
    state.deck.push(...player.hand.splice(1));
    state.unoVulnerableId = player.id;
  }});
  const {view,version} = await table.view(table.host);
  const current = table.seats.find(s=>s.clientId===view.players[view.currentIndex].id);
  const catchers = table.seats.filter(s=>s!==current && s.clientId!==view.unoVulnerableId);
  const results = await Promise.all(catchers.map(s=>table.act(s,{type:'catchUno'},version)));
  assert.deepEqual(results.map(r=>r.code || 'ok').sort(),['catch_unavailable','ok']);
  assert.ok((await table.act(current,{type:'draw'},version)).ok);
  const after = (await table.view(table.host)).view;
  assert.equal(after.players.find(p=>p.id===view.unoVulnerableId).hand.length,3);
  assert.equal(after.unoVulnerableId,null);
  assert.equal((await table.act(current,{type:'draw'},version)).code,'version_conflict');
});

function enterBangPlay(state, rules) {
  for (let i=0;i<3 && state.phase!=='play';i++) {
    assert.ok(rules.handleTimeout(state,{now:state.deadline}));
  }
  assert.equal(state.phase,'play');
}

test('BANG: two beers revive a player from -1, a third rescuer keeps their card', async t => {
  const table = await openTable(t,'game19',5,{onStart(state,rules) {
    enterBangPlay(state,rules);
    const hands = state.players.map(p=>p.hand);
    const beers = [state.deck,...hands].flat().filter(c=>c.type==='beer').slice(0,3);
    for (const [i,beer] of beers.entries()) {
      const source = [state.deck,...hands].find(cards=>cards.includes(beer));
      source.splice(source.indexOf(beer),1);
      hands[i+1].push(beer);
    }
    state.players[0].life = -1;
    state.phase = 'dying';
    state.pending = {type:'dying',id:'effect_'+(++state.effectSequence),actorId:state.players[0].id,
      resume:{type:'play',actorId:state.players[state.currentIndex].id}};
  }});
  const beerAction = v=>({type:'useBeer',effectId:v.pending.id,
    cardId:v.players.find(p=>p.id===v.selfId).hand.find(c=>c.type==='beer').id});
  const spare = table.seats[3];
  const before = await table.view(spare);
  const extra = beerAction(before.view);
  await together(table,table.seats.slice(1,3),beerAction);
  assert.equal((await table.act(spare,extra,before.version)).code,'version_conflict');
  const after = (await table.view(spare)).view;
  assert.equal(after.phase,'play');
  assert.equal(after.players[0].life,1);
  assert.ok(after.players.find(p=>p.id===spare.clientId).hand.some(c=>c.id===extra.cardId));
});

test('BANG: Sid heals while a different player ends their turn exactly once', async t => {
  const table = await openTable(t,'game19',5,{onStart(state,rules) {
    enterBangPlay(state,rules);
    const sid = state.players[(state.currentIndex+1)%state.players.length];
    sid.characterId = 'sid_ketchum';
    sid.life--;
  }});
  const {view,version} = await table.view(table.host);
  const currentIndex = table.seats.findIndex(s=>s.clientId===view.currentPlayerId);
  const current = table.seats[currentIndex];
  const sid = table.seats[(currentIndex+1)%table.seats.length];
  const player = (await table.view(sid)).view.players.find(p=>p.id===sid.clientId);
  assert.ok((await table.act(sid,{type:'useSid',cardIds:player.hand.slice(0,2).map(c=>c.id)},version)).ok);
  assert.ok((await table.act(current,{type:'endTurn'},version)).ok);
  const after = await table.view(sid);
  assert.equal(after.view.players.find(p=>p.id===sid.clientId).life,player.life+1);
  assert.equal((await table.act(current,{type:'endTurn'},version)).code,'version_conflict');
});

