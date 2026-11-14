// Deterministic fixtures use real local engines, HTTP actions, SSE, and browser UI.
// No fixture hooks are added to production code.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {once} = require('node:events');
const start = require('../shared/server/start-authoritative-game-server');
const {openBrowser, delay} = require('./lib/browser-session.cjs');
const {measure, checkSeatAccess} = require('./check-play-layout.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'audit', 'play-interactions');
fs.mkdirSync(output, {recursive:true});

async function run() {
  const browser = await openBrowser();
  const {evaluate, send, until, viewport, tap} = browser;
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`
    const nativeFetch=window.fetch;
    window.fetch=function(url,options){
      if(String(url).endsWith('/api/actions')&&options?.body){
        const type=JSON.parse(options.body).action.type;
        if(window.__failActionType===type){window.__failActionType=null;return Promise.reject(new TypeError('simulated offline'));}
      }
      return nativeFetch.call(this,url,options);
    };
  `});
  const results = [];
  let server;
  const streams = [];
  async function closeRoom() {
    await send('Page.navigate', {url:'about:blank'});
    streams.splice(0).forEach(s => s.destroy());
    if (server) { await new Promise(resolve => {server.close(resolve);server.closeAllConnections();});server=null; }
  }
  async function room(name, count, fixture = () => {}) {
    await closeRoom(); browser.errors.length = 0;
    const engine = await import(`../${name}/server/game-engine.mjs`);
    let state, expireNextAction=false;
    const actions = [];
    const eventResponses = [];
    const wrapped = {...engine,
      createLobby(options) { state = engine.createLobby(options); return state; },
      applyAction(s, id, action, context) {
        const result = engine.applyAction(s,id,action,{...context,random:()=>0.314159});
        if (action.type === 'start') {fixture(s);engine.validateState?.(s);}
        if (expireNextAction) {s.deadline=context.now+80;expireNextAction=false;}
        if (name==='game4'&&s.phase==='handResult') s.deadline=context.now+60_000;
        state = s;
        actions.push({id,type:action.type});
        return result;
      },
      buildView(s, ...args) {state=s;return engine.buildView(s,...args);}
    };
    server = start({gameRoot:path.join(root,name),engine:wrapped,defaultPort:0,spectatorsEnabled:true});
    server.on('request',(request,response)=>{
      const url=new URL(request.url,'http://localhost');
      if(url.pathname==='/api/events')eventResponses.push({id:url.searchParams.get('clientId'),response});
    });
    await once(server,'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = async (route, data) => {
      const response = await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
      const payload = await response.json();
      assert.equal(response.ok,true,`${name}: ${JSON.stringify(payload)}`);
      return payload;
    };
    await viewport(390,844);
    await send('Page.navigate',{url:base});
    await until(()=>evaluate("!!document.getElementById('createRoomButton')"),'page ready');
    await until(()=>evaluate("!document.getElementById('playerCountSelect')||document.getElementById('playerCountSelect').options.length>0"),'capacity options initialized');
    await delay(200);
    await evaluate(`document.getElementById('hostNameInput').value='触屏房主';if(document.getElementById('playerCountSelect'))document.getElementById('playerCountSelect').value='${count}';`);
    await tap('#createRoomButton');
    await until(()=>Boolean(state),'room created');
    await until(()=>evaluate("!document.getElementById('roomPanel').classList.contains('hidden')"),'room shown');
    const code = await evaluate("document.getElementById('roomCodeDisplay').textContent.trim()");
    const saved = await evaluate("JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('tablegame:'))))");
    const sessions = [{clientId:saved.playerId,resumeToken:saved.resumeToken}];
    if (name==='game2'||name==='game11') await post('/api/actions',{roomCode:code,playerId:saved.playerId,resumeToken:saved.resumeToken,actionId:crypto.randomUUID(),action:name==='game2'?{type:'sit',seatIndex:0}:{type:'sit',team:'white'}});
    for (let i=1;i<count;i++) {
      const session = await post('/api/join',{roomCode:code,clientId:'touch-'+i,name:'玩家'+i,intent:'play'});
      sessions.push(session);
      await new Promise((resolve,reject)=>{
        const url = new URL('/api/events',base);
        for(const key of ['roomCode','clientId','resumeToken'])url.searchParams.set(key,session[key]);
        const stream = http.get(url,res=>res.once('data',resolve));stream.on('error',reject);streams.push(stream);
      });
      await post('/api/lobby-ready',{roomCode:code,playerId:session.clientId,resumeToken:session.resumeToken,ready:true});
      if (name==='game2'||name==='game11') await post('/api/actions',{roomCode:code,playerId:session.clientId,resumeToken:session.resumeToken,actionId:crypto.randomUUID(),action:name==='game2'?{type:'sit',seatIndex:i}:{type:'sit',team:i%2?'black':'white'}});
    }
    const act = async (index, action) => {
      const session = sessions[index];
      await post('/api/actions',{roomCode:code,playerId:session.clientId,resumeToken:session.resumeToken,actionId:crypto.randomUUID(),action});
      await delay(120);
    };
    await evaluate('window.__layoutName='+JSON.stringify(name));
    const begin = async()=>{await until(()=>evaluate("!document.getElementById('startGameButton').disabled"),'start enabled');await tap('#startGameButton');await until(()=>state.phase!=='lobby','started');await delay(350);};
    const check = async label => {
      await delay(120);
      for (const [w,h] of [[390,844],[844,390]]) {
        await viewport(w,h);
        const m = await evaluate(`(${measure.toString()})()`);
        const blocked = await evaluate(`(${checkSeatAccess.toString()})()`);
        assert.ok(m.documentWidth<=m.clientWidth+2,`${name}/${label}: horizontal overflow`);
        assert.equal(m.dockOverBoard,false,`${name}/${label}: dock overlap`);
        assert.deepEqual(blocked,[],`${name}/${label}: inaccessible controls`);
        assert.deepEqual(m.clipped,[],`${name}/${label}: clipped seats`);
        assert.deepEqual(m.overlaps,[],`${name}/${label}: overlapping seats`);
        assert.deepEqual(m.centerOverlaps,[],`${name}/${label}: seats cover public center`);
        if (m.play.length) {
          assert.ok(m.documentHeight<=m.height+2,`${name}/${label}: viewport shell overflow`);
          assert.ok(!m.dock||m.dock.bottom<=m.height+2,`${name}/${label}: dock below viewport`);
        }
        assert.ok(m.board.h>=40,`${name}/${label}: board collapsed`);
      }
      await viewport(390,844);
      assert.deepEqual(browser.errors,[],`${name}/${label}: runtime errors`);
      results.push({game:name,scenario:label,phase:state.phase});
      console.log(`${name}: ${label} (${state.phase})`);
    };
    const reload = async () => {
      await send('Page.reload');
      await until(()=>evaluate("!!document.getElementById('guestModeButton')"),'reload setup');await delay(350);
      await tap('#guestModeButton');
      await evaluate(`document.getElementById('roomCodeInput').value=${JSON.stringify(code)}`);
      await tap('#joinRoomButton');
      await until(()=>evaluate("!document.getElementById('roomPanel').classList.contains('hidden')"),'resumed room');
      await evaluate('window.__layoutName='+JSON.stringify(name));await delay(180);
    };
    return {get state(){return state;},engine,actions,post,act,begin,check,reload,sessions,code,
      disconnectHost(){for(const event of eventResponses)if(event.id===sessions[0].clientId)event.response.destroy();},
      async expire(index,action){expireNextAction=true;await act(index,action);}};
  }

  async function keyboardCheck(selector, name) {
    // CDP cannot open an OS keyboard. Model the visualViewport-only resize;
    // touch events and editable DOM are real, OS keyboard verification is manual.
    await viewport(390,844);
    await evaluate(`(()=>{window.__realViewport=window.visualViewport;window.__keyboardViewport=new EventTarget();Object.assign(window.__keyboardViewport,{height:844,offsetTop:0,scale:1});Object.defineProperty(window,'visualViewport',{configurable:true,value:window.__keyboardViewport});})()`);
    await evaluate("import('/shared/client/mobile-viewport.js').then(m=>window.__unbindKeyboard=m.bindMobileViewport())");
    await tap(selector);
    await send('Input.insertText',{text:'触屏输入草稿'});
    await evaluate("Object.assign(window.__keyboardViewport,{height:430,offsetTop:0});window.__keyboardViewport.dispatchEvent(new Event('resize'))");
    await delay(180);
    assert.equal(await evaluate("document.documentElement.hasAttribute('data-keyboard-open')"),true,'keyboard detected');
    const metrics=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.left+Math.min(12,r.width/2),r.top+r.height/2);return {value:e.value,top:r.top,bottom:r.bottom,reachable:hit===e,font:parseFloat(getComputedStyle(e).fontSize),dockBottom:document.querySelector('[data-play-controls]')?.getBoundingClientRect().bottom};})()`);
    assert.ok(metrics.top>=0&&metrics.bottom<=430,`${name}: input hidden behind keyboard: ${JSON.stringify(metrics)}`);
    assert.equal(metrics.reachable,true);
    assert.ok(metrics.font>=16,`${name}: touch input text too small`);
    if(metrics.dockBottom)assert.ok(metrics.dockBottom<=430,`${name}: action dock behind keyboard`);
    assert.ok(metrics.value.includes('触屏输入草稿'));
    await evaluate("window.__keyboardViewport.height=844;window.__keyboardViewport.dispatchEvent(new Event('resize'))");await delay(100);
    assert.equal(await evaluate("document.documentElement.hasAttribute('data-keyboard-open')"),false,'keyboard dismissal restores layout');
    await viewport(844,390);await viewport(390,844);
    assert.ok(await evaluate(`document.querySelector(${JSON.stringify(selector)}).value.includes('触屏输入草稿')`),'rotation preserves draft');
    await evaluate("window.__unbindKeyboard();Object.defineProperty(window,'visualViewport',{configurable:true,value:window.__realViewport});void 0");
    results.push({game:name,scenario:'visual-viewport keyboard + rotation + draft'});
  }

  try {
    const selected = process.env.INTERACTION_GAMES?.split(',');
    const include = name => !selected || selected.includes(name);
    if (include('game')) {
      const r=await room('game',32);
      await until(()=>evaluate("document.getElementById('startHint').textContent.includes('32')"),'capacity hint');
      assert.equal(await evaluate("document.getElementById('startGameButton').disabled"),true);
      assert.equal(r.actions.some(a=>a.type==='start'),false);
      await evaluate("document.getElementById('lobbyGameMode').value='playerWords';document.getElementById('lobbyGameMode').dispatchEvent(new Event('change'))");
      await r.begin();assert.equal(r.state.phase,'collectingWords');
      await keyboardCheck('#submittedWordInput','game');await r.check('32 players switch from insufficient library');
    }
    for (const [name,count,selector] of [['game2',2,'#descriptionInput'],['game11',4,'#clue1'],['game23',3,'#clueDraftInput']]) {
      if (!include(name)) continue;
      const r=await room(name,count,s=>{if(name==='game23')s.storytellerId=s.players[0].id;});
      await r.begin();await until(()=>evaluate(`!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).closest('.hidden')`),'editable turn');
      await keyboardCheck(selector,name);
      await r.post('/api/join',{roomCode:r.code,clientId:'draft-observer',name:'观察员',intent:'spectate'});await delay(150);
      assert.ok(await evaluate(`document.querySelector(${JSON.stringify(selector)}).value.includes('触屏输入草稿')`),`${name}: background SSE preserves input`);
      if(name!=='game11')await r.check('input preserved across spectator broadcast');
    }
    if (include('game4')) {
      const r=await room('game4',6,s=>{
        const stacks=[300,600,900,1200,1500,1500];
        for(const [i,p] of s.players.entries())p.chips=stacks[i]-p.totalBet;
        // A royal flush on the board produces split payouts in every side pot.
        const cards=[...s.deck,...s.players.flatMap(p=>p.hole)];
        const royal=[10,11,12,13,14].map(rank=>cards.splice(cards.findIndex(c=>c.s==='♠'&&c.r===rank),1)[0]);
        for(const p of s.players)p.hole=cards.splice(0,2);
        const deal=[cards.shift(),...royal.slice(0,3),cards.shift(),royal[3],cards.shift(),royal[4]];
        s.deck=[...cards,...deal.reverse()];
      });
      await r.begin();await r.check('blinds and bet labels');
      for(let guard=0;r.state.phase==='playing'&&guard<15;guard++){
        const index=r.state.currentIndex,p=r.state.players[index],maximum=p.streetBet+p.chips;
        await r.act(index,maximum>r.state.currentBet&&!p.acted?{type:'raise',target:maximum}:{type:'call'});
      }
      assert.equal(r.state.phase,'handResult');assert.equal(r.state.handWinners.length,5);
      assert.ok(r.state.handWinners.every(p=>p.ids.length>=2));
      assert.equal(r.state.handWinners.reduce((sum,p)=>sum+p.amount,0),6000);
      await r.check('six-way showdown with five split pots');
      for(const [w,h] of [[1440,900],[390,844],[844,390]]){
        await viewport(w,h);
        const overflow=await evaluate(`(()=>{const e=document.querySelector('[data-play-board]'),r=e.getBoundingClientRect();return {width:e.clientWidth,scrollWidth:e.scrollWidth,children:[...e.querySelectorAll('*')].filter(c=>c.checkVisibility({checkVisibilityCSS:true})&&c.getBoundingClientRect().right>r.right+2).map(c=>({tag:c.tagName,cls:c.className,width:c.getBoundingClientRect().width})).slice(0,8)};})()`);
        assert.ok(overflow.scrollWidth<=overflow.width+2,`poker ${w}: internal overflow ${JSON.stringify(overflow)}`);
        const layout=await evaluate(`(()=>{const visible=e=>e.checkVisibility({checkVisibilityCSS:true}),box=e=>e.getBoundingClientRect(),overlap=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>2&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2;const result=box(document.getElementById('showdownOverlay')),seats=[...document.querySelectorAll('.seat')];const escaped=[];for(const seat of seats)for(const badge of seat.querySelectorAll('.seat-bet,.showdown-rank'))if(visible(badge)){const a=box(seat),b=box(badge);if(b.top<a.top-1||b.bottom>a.bottom+1||b.left<a.left-1||b.right>a.right+1)escaped.push(badge.textContent);}return {pots:document.querySelectorAll('.showdown-pot').length,overlaysSeats:seats.some(s=>overlap(box(s),result)),escaped,cardRows:[...document.querySelectorAll('.best-five')].filter(visible).length};})()`);
        assert.equal(layout.pots,5);assert.equal(layout.cardRows,5);assert.equal(layout.overlaysSeats,false);assert.deepEqual(layout.escaped,[]);
      }
      await r.reload();assert.equal(await evaluate("document.querySelectorAll('.showdown-pot').length"),5);
      await viewport(390,844);await evaluate("document.getElementById('showdownOverlay').scrollIntoView({block:'start',behavior:'instant'})");
      const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'poker-split-pots.png'),Buffer.from(shot.data,'base64'));
    }
    if (include('game5')) {
      const r=await room('game5',2,s=>{
        const cards=[...s.deck,...s.discard,...s.players.flatMap(p=>p.hand)];
        const take=(type,color,value)=>{const i=cards.findIndex(c=>c.type===type&&(color===undefined||c.color===color)&&(value===undefined||c.value===value));assert.ok(i>=0);return cards.splice(i,1)[0];};
        s.discard=[take('number','red',5)];s.currentIndex=0;s.currentColor='red';s.direction=1;
        s.players[0].hand=[take('wild4'),take('number','red',7)];
        s.players[1].hand=[take('wild4'),take('number','blue',7)];
        s.players[0].hand.push(...cards.splice(0,24));s.deck=cards;
        s.pendingDraw=0;s.pendingWild=null;s.drawnCardId=null;s.unoVulnerableId=null;s.pendingWinnerId=null;
      });
      await r.begin();await r.check('26-card hand');
      const wild=r.state.players[0].hand.find(c=>c.type==='wild4');
      await tap(`[data-card="${wild.id}"]`);assert.equal(await evaluate("document.getElementById('colorModal').classList.contains('hidden')"),false);
      await tap('#cancelColorButton');assert.ok(r.state.players[0].hand.some(c=>c.id===wild.id));
      await tap(`[data-card="${wild.id}"]`);await tap('[data-color="blue"]');
      await until(()=>r.state.pendingDraw===4,'wild played');
      await r.act(1,{type:'challenge'});assert.equal(r.state.pendingDraw,0);
      await r.act(1,{type:'play',cardId:r.state.players[1].hand.find(c=>c.type==='wild4').id,color:'red'});
      await r.check('wild +4 challenge controls');
      await tap('[data-action="challenge"]');await until(()=>r.state.pendingDraw===0,'challenge resolved');
      await r.check('challenge result');
    }
    if (include('game15')) {
      const r=await room('game15',2,s=>{
        s.currentIndex=0;
        for(const [index,color] of ['red','blue','black'].entries()) {
          let source=s.pool,at=source.findIndex(t=>!t.joker&&t.color===color&&t.number===10);
          if(at<0){source=s.players[1].hand;at=source.findIndex(t=>!t.joker&&t.color===color&&t.number===10);}
          assert.ok(at>=0);[source[at],s.players[0].hand[index]]=[s.players[0].hand[index],source[at]];
        }
      });
      await r.begin();const ids=r.state.players[0].hand.slice(0,3).map(t=>t.id);
      await evaluate("window.__failActionType='beginEdit'");
      await tap(`[data-tile-id="${ids[0]}"]`);await tap('[data-new-kind="group"]');
      await until(()=>evaluate("[...document.querySelectorAll('#actionButtons button')].some(b=>b.textContent==='重试同步')"),'failed edit exposes retry');
      assert.equal(r.state.turnEdited,false);assert.equal(await evaluate("document.querySelectorAll('#table [data-tile-id]').length"),1);
      await tap('#actionButtons button','重试同步');await until(()=>r.state.turnEdited,'edit retry succeeds');
      await r.check('failed beginEdit retains draft and allows retry');
      await tap(`#table [data-tile-id="${ids[0]}"]`);await tap('#actionButtons button','放回牌架');
      assert.equal(await evaluate("document.querySelectorAll('#table [data-tile-id]').length"),0);
      await tap(`[data-tile-id="${ids[0]}"]`);await tap('[data-new-kind="group"]');
      for(const id of ids.slice(1)){await tap(`#hand [data-tile-id="${id}"]`);await tap('[data-drop-meld="0"]');}
      await tap('#actionButtons button','撤销一步');assert.equal(await evaluate("document.querySelectorAll('#table [data-tile-id]').length"),2);
      await tap(`#hand [data-tile-id="${ids[2]}"]`);await tap('[data-drop-meld="0"]');
      await r.reload();
      assert.equal(await evaluate("document.querySelectorAll('#table [data-tile-id]').length"),3);
      assert.equal(await evaluate("[...document.querySelectorAll('#actionButtons button')].find(b=>b.textContent==='撤销一步').disabled"),false);
      assert.equal(r.state.turnEdited,true);
      r.disconnectHost();
      await until(()=>evaluate("document.getElementById('connectionStatus').textContent.includes('重连')"),'SSE disconnected');
      await until(()=>evaluate("document.getElementById('connectionStatus').textContent.includes('已连接')"),'SSE reconnected',12000);
      assert.equal(await evaluate("document.querySelectorAll('#table [data-tile-id]').length"),3);
      await r.check('SSE reconnect preserves private layout');
      await r.check('touch opening draft, return and undo');
      // Rapid duplicate UI activation must produce only one authoritative commit.
      const commits=r.actions.filter(a=>a.type==='commitLayout').length;
      await evaluate("(()=>{const b=[...document.querySelectorAll('#actionButtons button')].find(b=>b.textContent==='确认并公布牌桌');if(b.disabled)throw Error('restored draft cannot submit');b.click();b.click();})()");
      await until(()=>r.state.table.length===1,'layout committed');assert.equal(r.actions.filter(a=>a.type==='commitLayout').length,commits+1);
      assert.equal(r.state.players[0].opened,true);assert.equal(r.state.players[0].hand.length,11);
      await r.act(1,{type:'draw'});await until(()=>r.state.currentIndex===0,'next turn');
      await r.reload();assert.equal(await evaluate("document.querySelectorAll('#hand [data-tile-id]').length"),11);
      await r.check('published table and next turn');
      await tap(`#hand [data-tile-id="${r.state.players[0].hand[0].id}"]`);await tap('[data-new-kind="group"]');
      await until(()=>r.state.turnEdited,'timeout fixture edited');
      const expiredTurn=r.state.turnId,handCount=r.state.players[0].hand.length;
      // Only the test wrapper accelerates the deadline; the server timer still fires.
      await r.expire(0,{type:'beginEdit'});await until(()=>r.state.turnId!==expiredTurn,'unfinished draft timeout');
      assert.equal(r.state.players[0].hand.length,handCount+3);
      await r.reload();assert.equal(await evaluate("sessionStorage.getItem('tablegame:draft:rummikub')"),null);
      assert.equal(await evaluate("document.querySelectorAll('#table .meld').length"),1);
      await r.check('timeout discards expired draft and applies penalty');
    }
    if (include('game16')) {
      const r=await room('game16',3,s=>{
        s.currentIndex=0;const duke=s.deck.findIndex(c=>c.role==='duke');
        if(!s.players[0].influences.some(c=>c.role==='duke')){
          assert.ok(duke>=0);[s.deck[duke],s.players[0].influences[0]]=[s.players[0].influences[0],s.deck[duke]];
        }
      });
      await r.begin();
      const reaction=(type,extra={})=>({type,...extra,reactionId:r.state.reaction.id,reactionKind:r.state.reaction.kind});
      const tax=await evaluate("[...document.querySelectorAll('#actionButtons button')].find(b=>b.textContent.includes('征税')).textContent");
      await tap('#actionButtons button',tax);await until(()=>r.state.phase==='challengeAction','tax challenge');
      await r.act(1,reaction('challenge'));await r.check('prove role');
      await tap('#actionButtons button','展示公爵');await until(()=>r.state.phase==='loseInfluence','challenger loses');
      await r.act(1,{type:'loseInfluence',cardId:r.state.players[1].influences.find(c=>!c.revealed).id});
      assert.equal(r.state.players[0].coins,5);
      await r.act(1,{type:'declareAction',actionType:'foreignAid'});await r.check('block response');
      await tap('#actionButtons button','声明公爵并阻挡');await until(()=>r.state.phase==='challengeBlock','block challenged');
      await r.act(1,reaction('pass'));await r.act(2,reaction('pass'));await r.check('block resolved');
    }
    if (include('game22')) {
      const r=await room('game22',5,s=>{
        s.leaderId=s.players[0].id;
        const assassin=s.players.find(p=>p.role==='assassin');
        [assassin.role,s.players[0].role]=[s.players[0].role,assassin.role];
        s.assassinId=s.players[0].id;s.merlinId=s.players.find(p=>p.role==='merlin').id;
      });
      await r.begin();
      const ack=await evaluate("[...document.querySelectorAll('#actionButtons button')].find(b=>b.textContent.includes('我已')).textContent");
      await tap('#actionButtons button',ack);for(let i=1;i<5;i++)await r.act(i,{type:'acknowledgeSecret'});
      await until(()=>r.state.phase==='teamProposal','proposal');
      const ids=r.state.players.slice(0,2).map(p=>p.id);
      for(const id of ids)await tap(`#players [data-id="${id}"]`);
      assert.ok(await evaluate("document.querySelector('.team-selection-summary').textContent.includes('2')"));
      await r.reload();assert.equal(await evaluate("document.querySelectorAll('#players .selected').length"),2);
      await r.check('proposal selection restored after reload');
      await r.check('team selection');
      await evaluate("window.__failActionType='proposeTeam'");await tap('#actionButtons button','确认远征队伍');
      await until(()=>evaluate("[...document.querySelectorAll('#actionButtons button')].some(b=>b.textContent==='确认远征队伍'&&!b.disabled)"),'failed proposal can retry');
      assert.equal(r.state.phase,'teamProposal');assert.equal(await evaluate("document.querySelectorAll('#players .selected').length"),2);
      const proposals=r.actions.filter(a=>a.type==='proposeTeam').length;
      await evaluate("(()=>{const b=[...document.querySelectorAll('#actionButtons button')].find(b=>b.textContent==='确认远征队伍');b.click();b.click();})()");
      await until(()=>r.state.phase==='teamVote','proposal retried');assert.equal(r.actions.filter(a=>a.type==='proposeTeam').length,proposals+1);
      await r.check('failed proposal retry and duplicate confirmation');
      await until(()=>r.state.phase==='teamVote','vote');await r.check('team vote');
      await r.reload();assert.equal(await evaluate("sessionStorage.getItem('tablegame:draft:avalon')"),null);
      const approve=await evaluate("[...document.querySelectorAll('#actionButtons button')].find(b=>b.textContent.includes('同意提案')).textContent");
      await tap('#actionButtons button',approve);for(let i=1;i<5;i++)await r.act(i,{type:'submitTeamVote',approve:true});
      await r.check('secret quest card');
      const success=await evaluate("[...document.querySelectorAll('#actionButtons button')].find(b=>b.textContent.includes('成功')).textContent");
      await tap('#actionButtons button',success);await r.act(1,{type:'submitQuestCard',card:'success'});
      await r.check('anonymous quest reveal');
      const drain=async()=>{await until(()=>{if(['questReveal','assassinationReveal'].includes(r.state.phase)){r.state.deadline=Date.now()-1;return false;}return true;},'ceremony finishes',15000);};
      await drain();
      const rules=await import('../game22/rules.mjs');
      for(let round=1;round<3;round++){
        const team=r.state.players.slice(0,rules.questSize(5,r.state.questIndex)).map(p=>p.id);
        await r.act(r.state.players.findIndex(p=>p.id===r.state.leaderId),{type:'proposeTeam',memberIds:team});
        for(let i=0;i<5;i++)await r.act(i,{type:'submitTeamVote',approve:true});
        for(const id of team)await r.act(r.state.players.findIndex(p=>p.id===id),{type:'submitQuestCard',card:'success'});
        await drain();
      }
      assert.equal(r.state.phase,'assassination');await r.check('assassin target selection');
      await tap(`#players [data-id="${r.state.merlinId}"]`);await until(()=>r.state.phase==='assassinationReveal','assassination submitted');
      await r.check('assassination reveal');await drain();assert.equal(r.state.result.winner,'evil');await r.check('final result');
    }
    assert.deepEqual(browser.errors,[]);
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));
    fs.rmSync(path.join(output,'failure.json'),{force:true});
    fs.rmSync(path.join(output,'failure.png'),{force:true});
    console.log(`Interaction checks passed: ${results.length} scenarios.`);
  } catch(error) {
    const shot=await send('Page.captureScreenshot',{format:'png'}).catch(()=>null);
    if(shot)fs.writeFileSync(path.join(output,'failure.png'),Buffer.from(shot.data,'base64'));
    fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:error.stack,errors:browser.errors,completed:results},null,2));
    throw error;
  } finally {await closeRoom();await browser.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
