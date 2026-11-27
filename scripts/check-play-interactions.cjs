// Deterministic fixtures use real local engines, HTTP actions, SSE, and browser UI.
// No fixture hooks are added to production code.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {once} = require('node:events');
const start = require('../shared/server/start-authoritative-game-server');
const {openBrowser, delay} = require('./lib/browser-session.cjs');
const {yachtPosition,dynamitePosition} = require('./lib/score-and-judgment-fixtures.cjs');
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
        if (action.type === 'start') {fixture(s,engine,context);engine.validateState?.(s);}
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
      const sizes = ['game5','game15'].includes(name)
        ? [[390,844],[768,1024],[1024,768],[1440,900],[844,390]]
        : [[390,844],[844,390]];
      for (const [w,h] of sizes) {
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
    async function checkFirstScreen(selectors) {
      for (const [w,h] of [[390,844],[768,1024],[1024,768],[1440,900]]) {
        await viewport(w,h);
        await evaluate('window.scrollTo(0,0)');
        for (const selector of selectors) {
          const reachable = await evaluate(`(() => {
            const node = document.querySelector(${JSON.stringify(selector)});
            if (!node) return false;
            const rect = node.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.left + rect.width/2, rect.top + rect.height/2);
            return rect.top >= 0 && rect.bottom <= innerHeight && node.contains(hit);
          })()`);
          assert.ok(reachable, `${selector} outside first screen or obscured at ${w}×${h}`);
        }
      }
      await viewport(390,844);
    }
    for (const capacity of include('game14') ? [6,2] : []) {
      const r = await room('game14',capacity,state => {
        state.currentIndex = 0;
        const hostHand = state.players[0].hand;
        const farmer = state.deck.findIndex(card => card.type === 'farmer');
        assert.notEqual(farmer,-1);
        [hostHand[0],state.deck[farmer]] = [state.deck[farmer],hostHand[0]];
        for (const player of state.players.slice(1)) player.pigs.at(-1).dirty = true;
        if (capacity === 2) {
          const take = type => {
            const index = state.deck.findIndex(card => card.type === type);
            assert.notEqual(index,-1,type);
            return state.deck.splice(index,1)[0];
          };
          const lightning = take('lightning');
          state.deck.push(hostHand[1]);
          hostHand[1] = lightning;
          const [latched,grounded] = state.players[1].pigs.slice(-2);
          latched.dirty = true;
          latched.barn = take('barn'); latched.door = take('door');
          grounded.barn = take('barn'); grounded.rod = take('rod');
        }
      });
      await r.begin();
      const last = r.state.players.at(-1);
      const pen = pig => `.pig[data-player="${last.id}"][data-pig="${pig.id}"]`;
      if (capacity === 2) {
        const [latched,grounded] = last.pigs.slice(-2);
        await tap('#hand .type-lightning');
        for (const [pig,part,eligible] of [[latched,'.pig-latch',true],[grounded,'.pig-rod',false]]) {
          const selector=JSON.stringify(pen(pig));
          const state=await evaluate(`(() => {
            const pen=document.querySelector(${selector});
            return [!!pen.querySelector('.pig-roof'),!!pen.querySelector('.pig-mud'),
              !!pen.querySelector(${JSON.stringify(part)}),pen.classList.contains('targetable')];
          })()`);
          assert.deepEqual(state,[true,true,true,eligible]);
        }
      }
      await tap('#hand .type-farmer');
      if (capacity === 2) {
        assert.equal(await evaluate(`document.querySelector(${JSON.stringify(pen(last.pigs.at(-2)))}).classList.contains('targetable')`),false);
      }
      await tap('.target-shortcut',`查看 ${last.name} 的可选小猪`);
      const target = `.pig.targetable[data-player="${last.id}"][data-pig="${last.pigs.at(-1).id}"]`;
      // Check the shortcut's own scroll result before tap() can scroll the target.
      await until(() => evaluate(`(() => {
        const pig = document.querySelector(${JSON.stringify(target)});
        const box = pig.getBoundingClientRect();
        return pig.contains(document.elementFromPoint(box.left+box.width/2,box.top+box.height/2));
      })()`),'last farm target visible after shortcut');
      await tap(target);
      await until(() => !r.state.players.at(-1).pigs.at(-1).dirty,'last pig washed');
      if (capacity === 2) {
        const washedPen = pen(last.pigs.at(-1));
        await until(() => evaluate(`!document.querySelector('${washedPen} .pig-mud') && !!document.querySelector('${washedPen} .pig-rod')`),'washed pig keeps its equipment');
      }
      await r.check(`${capacity} farms, locate and wash last-seat farthest pig`);
    }
    if (include('game3')) {
      const r = await room('game3',6);
      await r.begin();
      const ones = '[data-score-row="ones"]';
      const readScores = row => evaluate(`[...document.querySelectorAll('${row} td')].map(cell=>cell.textContent)`);
      assert.equal(await evaluate("document.querySelectorAll('#scoreGrid [scope=col]').length"),7);
      await tap('[data-action="roll"]');
      assert.equal(await evaluate("document.querySelectorAll('#scoreGrid button').length"),13);
      assert.ok(await evaluate("[...document.querySelectorAll('#scoreGrid button')].every(b=>b.closest('td').cellIndex===1)"));
      await tap('[data-category="ones"]');
      await until(()=>r.state.players[0].scorecard.ones === 0,'host registers zero');
      await r.act(1,{type:'roll'});
      await r.act(1,{type:'score',category:'twos'});
      assert.deepEqual(await readScores(ones),['0','—','—','—','—','—']);
      assert.deepEqual(await readScores('[data-score-row="twos"]'),['—','10','—','—','—','—']);
      assert.equal(await evaluate("document.querySelectorAll('#scoreGrid button').length"),0);
      await viewport(390,844);
      const pinned = await evaluate(`(() => {
        const panel = document.querySelector('.score-panel');
        panel.scrollLeft = panel.scrollWidth;
        panel.scrollTop = 240;
        const bounds = panel.getBoundingClientRect();
        const last = document.querySelector('#scoreGrid thead th:last-child').getBoundingClientRect();
        const label = document.querySelector('#scoreGrid tbody th').getBoundingClientRect();
        return panel.scrollLeft > 0 && last.right <= bounds.right+1 && last.top >= bounds.top && label.left >= bounds.left;
      })()`);
      assert.ok(pinned,'names and categories pinned while comparing the sixth player');
      await r.check('six columns, another player scores live and recorded zero stays visible');
      await evaluate('localStorage.clear()');
      await send('Page.reload');
      await until(()=>evaluate("!!document.querySelector('#guestModeButton')"),'guest setup');
      await tap('#guestModeButton');
      await evaluate(`document.querySelector('#roomCodeInput').value=${JSON.stringify(r.code)}; document.querySelector('[name=joinIntent][value=spectate]').click()`);
      await tap('#joinRoomButton');
      await until(()=>evaluate("!!document.querySelector('#turnActions .spectator-action-note')"),'spectator watching');
      await r.act(2,{type:'roll'});
      assert.equal(await evaluate("document.querySelectorAll('#scoreGrid button').length"),0);
      assert.deepEqual(await readScores(ones),['0','—','—','—','—','—']);
      await r.act(2,{type:'score',category:'chance'});
      await until(async ()=>(await readScores('[data-score-row="chance"]'))[2] === '10','spectator receives new score');
      for (const subtotal of [50,51]) {
        const scores = await room('game3',2,state=>yachtPosition(state,subtotal));
        await scores.begin();
        const pencil = '[data-category="sixes"] .upper-projection';
        const hint = await evaluate(`document.querySelector('${pencil}').textContent`);
        assert.ok(hint.includes('填后 '+(subtotal+12)) && hint.includes(subtotal===50?'差 1 分':'达标'));
        assert.equal(await evaluate("document.querySelectorAll('.bonus-stamp').length"),0);
        await tap('[data-category="sixes"]');
        await until(()=>scores.state.players[0].scorecard.sixes===12,'six box registered');
        const observer = scores.engine.buildSpectatorView(scores.state);
        assert.equal(observer.players[0].totals.upperBonus,subtotal===50?0:35);
        assert.equal(await evaluate("document.querySelectorAll('.bonus-stamp').length"),subtotal===50?0:1);
        await scores.check('upper section '+subtotal+' plus two sixes');
      }
    }
    if (include('game19')) {
      const r = await room('game19', 7, state => {
        state.currentIndex = 0;
        state.phase = 'play';
        state.pending = null;
        state.deadline = Date.now() + 75000;
        const players = state.players;
        const zones = [state.deck, ...players.map(player => player.hand)];
        for (const [type, destination] of [
          ['bang', players[0].hand], ['schofield', players[0].equipment],
          ['mustang', players[1].equipment], ['barrel', players[6].equipment]
        ]) {
          const source = zones.find(cards => cards.some(card => card.type === type));
          destination.push(source.splice(source.findIndex(card => card.type === type), 1)[0]);
        }
      });
      await r.begin();
      const [host] = r.state.players;
      const bang = host.hand.find(card => card.type === 'bang');
      await tap(`[data-card="${bang.id}"]`);
      assert.match(await evaluate("document.querySelector('#actionHint').textContent"), /斯科菲尔德.*射程2/);
      const labels = await evaluate("Array.from(document.querySelectorAll('#actionButtons button'), b => b.textContent)");
      assert.ok(labels.includes('玩家1 · 距离2 · 野马'));
      assert.ok(labels.includes('玩家6 · 距离1 · 木桶'));
      assert.ok(!labels.some(label => label.startsWith('玩家3 ·')), 'outside weapon range');
      assert.ok(await evaluate("document.querySelector('#actionButtons').getBoundingClientRect().bottom <= document.querySelector('#privateZone').getBoundingClientRect().top"), 'actions overlap hand');
      await tap('#actionButtons button', '玩家6 · 距离1 · 木桶');
      await tap('#actionButtons button', '确认对 玩家6 使用');
      await until(() => r.state.phase === 'defense', 'target receives BANG');
      assert.equal(r.state.pending.actorId, r.state.players[6].id);
      assert.deepEqual(browser.errors, []);
      results.push({game:'game19', scenario:'seven-player ranged attack and hand clearance'});
      for(const rank of ['9','10']) {
        const duel=await room('game19',4,dynamitePosition);
        await duel.begin();
        const owner=duel.state.players[0], life=owner.life;
        assert.equal(duel.engine.buildView(duel.state,duel.state.players[1].id).pending.cards.length,0);
        assert.equal(duel.engine.buildSpectatorView(duel.state).pending.cards.length,0);
        const card=duel.state.pending.cards.find(c=>c.rank===rank);
        await tap(`#actionButtons [data-judgment-choice="${card.id}"]`);
        const slot='#judgmentSlot [data-judgment-result]';
        const expected=rank==='9'?'3 点伤害':'传给';
        await until(()=>evaluate(`document.querySelector('${slot}')?.textContent.includes('${expected}')`),'public result matches the chosen face');
        assert.equal(duel.state.players[0].life,life-(rank==='9'?3:0));
        assert.equal(duel.state.players[1].equipment.some(c=>c.type==='dynamite'),rank==='10');
        await duel.check('Lucky Duke dynamite spades '+rank);
      }
    }
    if (include('game10')) {
      const roll = await room('game10', 2, state => { state.currentIndex = 0; });
      await roll.begin();
      await tap('[data-action="roll"]');
      await until(() => evaluate("!!document.querySelector('[data-choice]')"), 'double ready to choose');
      assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('#diceArea .die'), d => d.children.length)"), [2,2,2,2]);
      assert.match(await evaluate("document.querySelector('[data-choice]').textContent"), /4 号线走 2 步/);
      await tap('[data-choice="4-4"]');
      await until(() => roll.state.turnProgress[4] === 2, 'double advances two steps');
      results.push({game:'game10',scenario:'roll and choose a double in the tray'});

      const camp = await room('game10', 2, state => {
        state.currentIndex = 0;
        state.players[0].progress = {7:2};
        state.turnProgress = {7:4};
        state.turnStage = 'choose';
        state.dice = [3,4,4,5];
        state.options = [{key:'7-9', pair:[7,9], moves:[7,9]}];
      });
      await camp.begin();
      assert.equal(await evaluate("document.querySelector('[data-choice]').innerText.replace(/\\s+/g,' ')"), '7、9 号线 各走 1 步');
      await tap('[data-choice="7-9"]');
      const steps = column => evaluate(`Array.from(document.querySelectorAll('[data-column="${column}"] .trail-step'), cell => Number(cell.dataset.step))`);
      await until(() => evaluate("document.querySelectorAll('.trail-step').length === 4"), 'footprints after choosing 7 and 9');
      assert.deepEqual(await steps(7), [5,4,3]);
      assert.deepEqual(await steps(9), [1]);
      await delay(1200);
      for (const [width,height] of [[390,844],[1024,768]]) {
        await viewport(width,height);
        await evaluate("document.querySelector('#board').scrollIntoView({block:'center',behavior:'instant'})");
        const shot = await send('Page.captureScreenshot',{format:'png'});
        fs.writeFileSync(path.join(output,`cantstop-footprints-${width}.png`),Buffer.from(shot.data,'base64'));
      }
      await tap('[data-action="stop"]');
      await until(() => evaluate(`!document.querySelector('.trail-step') && !!document.querySelector('[data-column="7"] [data-step="5"] .camp')`), 'footprints become camp');
      assert.deepEqual(camp.state.players[0].progress, {7:5,9:1});
      assert.deepEqual(browser.errors, []);
      results.push({game:'game10',scenario:'temporary footsteps from camp and from the base, then camp'});

      const bust = await room('game10', 2, state => {
        state.currentIndex = 0;
        state.players[0].progress = {7:2};
        state.turnProgress = {7:5,9:1,11:2};
        state.turnStage = 'decision';
        state.options = [];
      });
      await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
      try {
        await bust.begin();
        await until(() => evaluate("document.querySelectorAll('.trail-step').length === 6"), 'three active routes');
        await tap('[data-action="roll"]');
        await until(() => evaluate("document.querySelectorAll('.trail-retreat').length === 6"), 'bust retraces only the lost steps');
        assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('#diceArea .die'), d => d.children.length)"), [2,2,2,2]);
        assert.match(await evaluate("document.querySelector('#diceHint').textContent"), /7、9、11 号线/);
        assert.deepEqual(await steps(7), []);
        assert.deepEqual(bust.state.players[0].progress, {7:2});
        await until(() => evaluate("!document.querySelector('.trail-retreat')"), 'retreat clears');
        assert.deepEqual(browser.errors, []);
      } finally {
        await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      }
      results.push({game:'game10',scenario:'bust retreats to saved camp'});
    }
    if (include('game13')) {
      const r = await room('game13', 4, state => {
        const index = state.deck.findIndex(card => card.power === 'swap');
        assert.ok(index >= 0);
        state.pending = {card:state.deck.splice(index, 1)[0], source:'deck'};
        state.phase = 'drawn';
        state.currentIndex = 0;
        state.deadline = Date.now() + 30000;
      });
      await r.begin();
      const own = r.state.players[0].slots[1], other = r.state.players[3].slots[2];
      const ownId = own.card.id, otherId = other.card.id;
      const ownButton = `[data-slot="${own.slotId}"]`, otherButton = `[data-slot="${other.slotId}"]`;
      const swap = '#actionArea .power-action';
      await tap(otherButton);
      assert.match(await evaluate("document.querySelector('#selectionHint').textContent"), /玩家3的第3张/);
      assert.ok(await evaluate("document.querySelector('#actionArea .power-action').disabled"));
      await tap(otherButton);
      await tap(ownButton);
      const ownBottom = () => evaluate(`document.querySelector('${ownButton}').getBoundingClientRect().bottom`);
      const before = await ownBottom();
      await tap(otherButton);
      assert.equal(await evaluate("document.querySelector('#selectionHint').textContent"), '交换：我的第2张 ↔ 玩家3的第3张');
      assert.ok(Math.abs(before - await ownBottom()) < 2 && before <= 844, 'SWAP shifts selected card off screen');
      await tap(swap);
      await until(() => r.state.phase === 'turn', 'SWAP accepted');
      assert.equal(r.state.players[0].slots[1].card.id, otherId);
      assert.equal(r.state.players[3].slots[2].card.id, ownId);
      await until(() => evaluate("!document.querySelector('[data-slot].selected')"), 'selection cleared');
      assert.deepEqual(browser.errors, []);
      results.push({game:'game13', scenario:'four-player SWAP selection, deselection and confirmation'});
    }
    if (include('game18')) {
      const engine = await import('../game18/server/game-engine.mjs');
      const r = await room('game18', 8, state => {
        engine.applyAction(state, state.pending.actorId, {type:'submitCase',text:'遗失的桌游'}, {now:Date.now()});
        state.currentIndex = state.players.findIndex(player => !player.isHost && player.hand.some(card => card.type === 'trade'));
        assert.ok(state.currentIndex > 0);
      });
      await r.begin();
      const traderIndex = r.state.currentIndex;
      const trader = r.state.players[traderIndex];
      const trade = trader.hand.find(card => card.type === 'trade');
      await r.act(traderIndex, {type:'playCard',cardId:trade.id});
      await r.act(traderIndex, {type:'chooseTarget',targetId:r.state.players[0].id});
      await tap('#myHand [data-card-id]');
      await tap('#actionButtons .primary');
      await until(() => evaluate("document.querySelector('#actionTitle').textContent === '选择已确认'"), 'trade acknowledged');
      assert.equal(await evaluate("document.querySelector('#actionHint').textContent"), `等待${trader.name}选牌。`);
      assert.equal(r.engine.buildView(r.state,trader.id).pending.ownSelectionId, null);
      const otherCard = r.state.players[traderIndex].hand[0];
      await r.act(traderIndex, {type:'submitTradeCard',cardId:otherCard.id});
      assert.ok(r.state.players[0].hand.some(card => card.id === otherCard.id));
      assert.deepEqual(browser.errors, []);
      results.push({game:'game18', scenario:'private trade receipt and exchange'});
    }
    if (include('game21')) {
      const r = await room('game21',8);
      await r.begin();
      await checkFirstScreen(['#secretRole','#actionButtons .primary']);
      await tap('#actionButtons .primary');
      for (let index = 1; index < 7; index++) await r.act(index,{type:'acknowledgeSecret'});
      await r.expire(7,{type:'acknowledgeSecret'});
      await until(() => r.state.phase === 'timeoutNomination','questioning expired');
      while (r.state.nominationOrder[r.state.nominationIndex] !== r.sessions[0].clientId) {
        const actor = r.state.nominationOrder[r.state.nominationIndex];
        await r.act(r.sessions.findIndex(s => s.clientId === actor),{type:'skipNomination'});
      }
      await until(() => evaluate("document.querySelector('#controlDock').dataset.task === 'nominate'"),'host nomination');
      await checkFirstScreen(['#actionTitle','#actionButtons .primary']);
      await tap('#actionButtons .primary');
      const target = r.sessions[7].clientId;
      await evaluate(`(() => {const select = document.querySelector('#actionButtons select'); select.value=${JSON.stringify(target)}; select.dispatchEvent(new Event('change'));})()`);
      await until(() => r.state.nomination?.targetId === target,'nominee submitted');
      assert.deepEqual(browser.errors,[]);
      results.push({game:'game21',scenario:'secret confirmation and eighth-seat nomination',phase:r.state.phase});
    }
    if (include('game17')) {
      const r = await room('game17',5);
      await r.begin();
      while (r.state.phase === 'supply') {
        const i = r.state.players.findIndex(p => p.id === r.state.currentActorId);
        const [up,down] = r.state.players[i].supplyHand;
        await r.act(i,{type:'placeSupply',faceUpCardId:up.id,faceDownCardId:down.id,
          faceUpPileId:r.state.stockpiles[i].id,faceDownPileId:r.state.stockpiles[i].id});
      }
      const target = r.state.stockpiles[0].id;
      let top = null;
      for (const amount of [0,1000,3000,6000]) {
        const i = r.state.players.findIndex(p => p.id === r.state.currentActorId);
        if (i === 0) break;
        await r.act(i,{type:'placeBid',pileId:target,amount});
        top = amount;
      }
      const picker = '[data-action-draft="bid-target"]';
      await until(() => evaluate(`!!document.querySelector('${picker}')`),'host bidding');
      await checkFirstScreen([picker,'.bid-choice:not([hidden]) button','#stockpiles .stockpile header']);
      await evaluate(`(() => {const picker=document.querySelector('${picker}'); picker.selectedIndex=1; picker.dispatchEvent(new Event('change')); picker.selectedIndex=0; picker.dispatchEvent(new Event('change'));})()`);
      const amount = await evaluate(`(() => {const select=document.querySelector('.bid-choice:not([hidden]) select'); select.selectedIndex=1; return Number(select.value);})()`);
      assert.ok(amount > (top ?? -1));
      assert.equal(await evaluate("document.querySelector('.bid-target').dataset.pileId"), target);
      await tap('.bid-choice:not([hidden]) button');
      await until(() => r.state.bidTokens.some(t => t.ownerId === r.sessions[0].clientId && t.pileId === target && t.amount === amount),'chosen pile and price recorded');
      await r.check('compare five lots and submit a higher bid');

      const close = await room('game17',3,state => {
        const host = state.players[0];
        for (const company of ['nova','evergreen']) {
          if (host.portfolio.some(card => card.companyId === company)) continue;
          const index = state.marketDeck.findIndex(card => card.kind === 'stock' && card.companyId === company);
          assert.notEqual(index,-1);
          host.portfolio.push(state.marketDeck.splice(index,1)[0]);
        }
        Object.assign(state.stockPrices,{nova:10,evergreen:1});
        state.closingLedger.openingPrices = {...state.stockPrices};
        const offers = [['nova','up1'],['evergreen','down2'],['harbor','up2'],['apex','dividend'],['cloud','up4'],['aurora','down3']]
          .map(([companyId,forecastId])=>({id:'info-'+companyId,companyId,forecastId}));
        state.players.forEach((player,i)=>{player.privateInformation=[offers[i]];});
        state.publicInformation=offers[3];state.hiddenInformation=offers.slice(4);
        state.phase='selling';state.currentActorId=host.id;state.turnQueue=[host.id];
      });
      await close.begin();
      await tap('#actionButtons button','确认卖出 / 不卖');
      await until(()=>close.state.phase!=='selling','last seller confirmed');
      while (close.state.phase==='dividend') {
        const actor=close.state.players.findIndex(player=>player.id===close.state.currentActorId);
        await close.act(actor,{type:'submitDividend',normal:0,split:0});
      }
      await until(()=>evaluate("document.querySelector('#closingTape')?.checkVisibility()"),'closing prices visible');
      assert.equal(await evaluate("document.querySelectorAll('#closingTape [data-close-company]').length"),6);
      for(const [company,stamp] of [['nova','拆股'],['evergreen','破产']]){
        const row = `#closingTape [data-close-company="${company}"] .settlement-stamp`;
        assert.match(await evaluate(`document.querySelector('${row}').textContent`),new RegExp(stamp));
      }
      assert.deepEqual(['nova','evergreen','harbor'].map(company=>close.state.stockPrices[company]),[6,5,7]);
      assert.ok(await evaluate("document.querySelector('#holdingSettlement').checkVisibility()"));
      await close.check('six closing prices, split and bankruptcy in one settlement');
    }
    if (include('game9')) {
      const r = await room('game9',7,state => {
        state.currentIndex = 0;
        state.players[1].chips += state.players[0].chips - 1;
        state.players[0].chips = 1;
        const rest = Array.from({length:33}, (_, i) => i + 3).filter(card => ![18,19,20].includes(card));
        state.removed = rest.splice(0,9);
        state.deck = rest;
        state.players[0].cards = [18,20];
        state.activeCard = 19;
      });
      await r.begin();
      const pass = '[data-action="pass"]';
      assert.match(await evaluate("document.querySelector('#myCards .preview-card').textContent"), /19/);
      assert.deepEqual(r.state.players[0].cards, [18,20]);
      assert.equal(await evaluate("document.querySelector('#myCardScore').textContent"), '38');
      await checkFirstScreen([pass,'[data-action="take"]']);
      assert.match(await evaluate(`document.querySelector('${pass}').textContent`),/你有 1 枚/);
      await tap(pass);
      for (let i = 1; i < 7; i++) await r.act(i,{type:'pass'});
      assert.ok(await evaluate(`document.querySelector('${pass}').disabled`));
      assert.match(await evaluate(`document.querySelector('${pass}').textContent`),/你有 0 枚/);
      await tap('[data-action="take"]');
      await until(() => evaluate(`document.querySelector('${pass}').textContent.includes('你有 7 枚')`),'collected chips available');
      assert.deepEqual(r.state.players[0].cards, [18,19,20]);
      assert.equal(await evaluate("document.querySelector('#myCardScore').textContent"), '18');
      assert.equal(await evaluate("document.querySelectorAll('#myCards .preview-card').length"), 0);
      await r.check('last chip spent, refusal disabled, pot collected');
    }
    if (include('game6')) {
      const r = await room('game6', 10, state => {
        // Put the lowest dealt card in the host's hand to force a real row choice.
        const piles = [...state.players.map(p => p.hand), ...state.rows];
        const lowest = Math.min(...piles.flat());
        const pile = piles.find(cards => cards.includes(lowest));
        const index = pile.indexOf(lowest);
        [pile[index], piles[0][0]] = [piles[0][0], pile[index]];
        // Represent the second turn, with four cards in row 1 and five in row 4.
        state.turn = 2;
        const previous = state.players.map(player => player.hand.pop());
        state.rows[0].push(...previous.splice(0,3));
        state.rows[3].push(...previous.splice(0,4));
        state.rows[1].push(previous.pop());
        state.rows[2].push(...previous);
        for (const row of state.rows) row.sort((a,b) => a-b);
      });
      await r.begin();
      const card = r.state.players[0].hand[0];
      const before = await evaluate("window.__firstRow = document.querySelector('[data-row]'); document.querySelectorAll('#rows .row-label').length");
      assert.equal(before, 4);
      const {rowBullheads} = await import('../game6/rules.mjs');
      const rowPoints = rowBullheads(r.state.rows[3]);
      assert.equal(await evaluate("document.querySelectorAll('#rows [data-row=\"0\"] > .row-slot-empty').length"), 1);
      assert.equal(await evaluate("document.querySelectorAll('#rows [data-row=\"3\"] > .row-slot-empty').length"), 0);
      const warning = await evaluate("document.querySelector('#rows [data-row=\"3\"].is-full .row-warning').textContent");
      assert.match(warning, /再接就收/);
      assert.ok(warning.includes(rowPoints+' 牛头'));
      for (const [width,height] of [[320,568],[1024,768],[390,844]]) {
        await viewport(width,height);
        const fits = await evaluate(`(() => {
          const row = document.querySelector('#rows .is-full');
          const cards = [...row.querySelectorAll('.number-card')].map(card => card.getBoundingClientRect());
          const sign = row.querySelector('.row-warning').getBoundingClientRect();
          return cards.length === 5 && cards.every(card => card.width > 0)
            && cards[4].right <= sign.left + 1 && sign.right <= row.getBoundingClientRect().right + 1;
        })()`);
        assert.ok(fits, 'five cards and the penalty fit at width '+width);
      }
      await tap(`#hand [data-card="${card}"]`);
      for (let i = 1; i < 10; i++) await r.act(i, {type:'selectCard', card:r.state.players[i].hand[0]});
      await until(() => evaluate("!!document.querySelector('#rows .choice')"), 'host can choose a row');
      assert.ok(await evaluate("window.__firstRow === document.querySelector('[data-row]')"));
      const visible = await evaluate(`(() => {
        const board = document.querySelector('[data-play-board]').getBoundingClientRect();
        return [...document.querySelectorAll('#rows .card-row')].every(row => {
          const rect = row.getBoundingClientRect();
          return rect.top >= board.top && rect.bottom <= board.bottom;
        });
      })()`);
      assert.ok(visible, 'four row choices visible before scrolling');
      const captured = [...r.state.rows[3]];
      await tap('#rows [data-row="3"]');
      await until(() => captured.every(c => r.state.players[0].captured.includes(c)), 'row captured');
      assert.equal(r.state.players[0].score, rowPoints);
      await r.check('ten players select and collect a row');
    }
    if (include('game8')) {
      const r = await room('game8', 4, state => {state.game.turn = 0;});
      await r.begin();
      await tap('.market-switch [aria-controls="specialMarket"]');
      assert.ok(await evaluate("document.querySelector('#rareMarket [data-card]').checkVisibility() && !document.querySelector('#markets').checkVisibility()"));
      await tap('.market-switch [aria-controls="markets"]');
      const card = await evaluate("document.querySelector('#markets [data-market-tier=stage1] [data-card]').dataset.card");
      await tap(`#markets [data-card="${card}"]`);
      await tap(`#markets [data-card-action="reserve"][data-card-id="${card}"]`);
      await until(() => r.state.game.players[0].reserve.includes(card), 'market card reserved');
      await r.check('switch markets and reserve a visible card');
    }
    if (include('game23')) {
      const r = await room('game23', 8, state => {state.storytellerId = state.players[1].id;});
      await r.begin();
      await r.act(1, {type:'submitStory', cardId:r.state.players[1].hand[0].id, clueMode:'text', clueText:'河上的月亮'});
      for (const index of [0,2,3,4,5,6,7]) {
        await r.act(index, {type:'submitDecoys', cardIds:[r.state.players[index].hand[0].id]});
      }
      await until(() => evaluate("document.querySelectorAll('#gallery [data-display-id]').length === 8"), 'gallery open');
      assert.ok(await evaluate("!document.querySelector('#gallery .empty-gallery') && !document.querySelector('#handPanel').checkVisibility()"));
      const decoy = r.state.displayCards.find(entry=>entry.ownerId===r.sessions[2].clientId);
      const choice = `#gallery .dream-card.selectable[data-display-id="${decoy.displayId}"]`;
      await tap(choice+' .zoom-card');
      assert.ok(await evaluate("document.querySelector('#cardPreview').open"));
      await tap('#closePreviewButton');
      await tap(choice+' .card-choice');
      const target = await evaluate("document.querySelector('#gallery .selected').dataset.displayId");
      await tap('[data-action="submit-vote"]');
      await until(() => r.state.votes[r.state.players[0].id] === target, 'selected vote sealed');
      await r.check('eight paintings, preview and confirm vote');
      const answer = r.state.displayCards.find(entry=>entry.ownerId===r.state.storytellerId);
      for (const i of [2,3,4,5,6]) {
        await r.act(i,{type:'submitVote',displayId:i===2?answer.displayId:target});
      }
      assert.equal(await evaluate("document.querySelectorAll('#gallery .vote-tickets').length"),0);
      assert.equal(r.engine.buildSpectatorView(r.state).roundResult,null);
      await r.act(7,{type:'submitVote',displayId:target});
      const frame = `#gallery [data-gallery-id="${target}"]`;
      await until(()=>evaluate(`!!document.querySelector('${frame} .vote-tickets')`),'vote tickets after reveal');
      await tap(frame+' .vote-tickets summary');
      const voterNames=await evaluate(`Array.from(document.querySelectorAll('${frame} .voter-names li > span'),label=>label.textContent.trim())`);
      assert.deepEqual(voterNames,[0,3,4,5,6,7].map(i=>r.state.players[i].name));
      await tap(frame+' .zoom-card');
      assert.ok(await evaluate("document.querySelector('#cardPreview').open"));
      await tap('#closePreviewButton');
      await r.check('six named votes under a decoy painting');
    }
    if (include('game')) {
      const table = await room('game',8);
      await table.begin();
      const publicWord = '#wordBoard .operator-card:not(.self-card) .word-value';
      await checkFirstScreen([publicWord,'#questionInput']);
      await tap('#questionInput');
      await send('Input.insertText',{text:'它能吃吗？'});
      await tap('#submitQuestionButton');
      await until(() => table.state.currentQuestion?.text === '它能吃吗？','question submitted');
      for (let i=1;i<8;i++) await table.act(i,{type:'answer',answer:'yes'});
      await tap('#skipTurnButton');
      await table.act(1,{type:'question',text:'它会飞吗？'});
      await checkFirstScreen([publicWord,'.current-question','#answerMaybeButton']);
      await tap('#answerMaybeButton');
      await until(() => table.state.currentQuestion?.answers[table.sessions[0].clientId] === 'maybe','host answer recorded');
      await table.check('eight players consult words and exchange questions');
      const r=await room('game',32);
      await until(()=>evaluate("document.getElementById('startHint').textContent.includes('32')"),'capacity hint');
      assert.equal(await evaluate("document.getElementById('startGameButton').disabled"),true);
      assert.equal(r.actions.some(a=>a.type==='start'),false);
      await evaluate("document.getElementById('lobbyGameMode').value='playerWords';document.getElementById('lobbyGameMode').dispatchEvent(new Event('change'))");
      await r.begin();assert.equal(r.state.phase,'collectingWords');
      await keyboardCheck('#submittedWordInput','game');await r.check('32 players switch from insufficient library');
      for (let i=0;i<32;i++) await r.act(i,{type:'submitWord',word:`密文${i+1}`});
      await until(() => evaluate("document.querySelectorAll('#wordBoard .operator-card').length===32 && !!document.querySelector('#questionInput')"),'32 players decoding');
      assert.equal(await evaluate("document.querySelectorAll('#roundRoster [data-player-id]').length"),32);
      await checkFirstScreen([publicWord,'#questionInput']);
      await r.check('32 dealt words and separate roster');
    }
    for (const [name,count,selector] of [['game2',2,'#descriptionInput'],['game11',4,'#clue1'],['game23',3,'#clueDraftInput']]) {
      if (!include(name)) continue;
      const r=await room(name,count,s=>{
        if(name==='game23')s.storytellerId=s.players[0].id;
        if(name==='game11'){
          s.teams.white.keywords=['桥','天文望远镜','自动气象观测站','北极光'];
          s.round=3;
          s.records=[
            {round:1,team:'black',code:[2,3,1],clues:['铁轨','车票','石头']},
            {round:1,team:'white',code:[2,1,4],clues:['星群','沙漠','土壤']},
            {round:2,team:'black',code:[4,1,2],clues:['松树','远山','站台']}
          ];
        }
      });
      await r.begin();await until(()=>evaluate(`!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).closest('.hidden')`),'editable turn');
      await keyboardCheck(selector,name);
      await r.post('/api/join',{roomCode:r.code,clientId:'draft-observer',name:'观察员',intent:'spectate'});await delay(150);
      assert.ok(await evaluate(`document.querySelector(${JSON.stringify(selector)}).value.includes('触屏输入草稿')`),`${name}: background SSE preserves input`);
      if (name === 'game11') {
        await tap('#notebookPanel > summary');
        await tap('#notebookPanel button[data-team="black"][data-number="2"]');
        const entries=await evaluate("Array.from(document.querySelectorAll('#notebookEntries li'), e=>e.textContent)");
        assert.equal(entries.length,2);
        assert.ok(entries.some(entry=>entry.includes('1')&&entry.includes('铁轨')));
        assert.ok(entries.some(entry=>entry.includes('2')&&entry.includes('站台')));
        assert.ok(await evaluate("document.querySelector('#clue1').value.includes('触屏输入草稿')"));
        await tap('#notebookPanel > summary');
        for (const [w,h,columns] of [[390,844,2],[1440,900,4]]) {
          await viewport(w,h);
          const rows = await evaluate(`(() => {
            const cards = [...document.querySelectorAll('#keywordRack .keyword')];
            return cards.map(card => [card.offsetTop,card.scrollWidth <= card.clientWidth+1]);
          })()`);
          assert.equal(rows.length,4);
          assert.equal(rows.filter(([top])=>top === rows[0][0]).length,columns);
          assert.ok(rows.every(([,fits])=>fits));
        }
        await viewport(390,844);
        for (const [selector,clue] of [['#clue2','清晨'],['#clue3','远方']]) {
          await tap(selector);
          await send('Input.insertText',{text:clue});
        }
        await tap('#submitCluesButton');
        await until(()=>r.state.phase === 'guess','three clues submitted');
        results.push({game:name,scenario:'numbered keyword layout and three-clue submission'});
      }
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
      const {compareHandCards} = await import('../game5/rules.mjs');
      const checkHandOrder = async () => {
        const expected=[...r.state.players[0].hand].sort(compareHandCards).map(card=>card.id);
        await until(async()=>JSON.stringify(await evaluate("[...document.querySelectorAll('#hand [data-card]')].map(el=>el.dataset.card)"))===JSON.stringify(expected),'displayed hand matches sorted physical cards');
      };
      await checkHandOrder();
      for (const [w,h] of [[390,844],[768,1024],[1024,768],[1440,900]]) {
        await viewport(w,h);
        await evaluate("document.querySelector('[data-play-board]').scrollTop=0;document.querySelector('[data-play-controls]').scrollTop=0;document.querySelector('#hand').scrollLeft=0");
        for (const selector of ['#discardPile .uno-card','#currentColor','#hand .uno-card']) {
          assert.ok(await evaluate(`(()=>{
            const card=document.querySelector(${JSON.stringify(selector)}), box=card.getBoundingClientRect();
            return card.contains(document.elementFromPoint(box.left+box.width/2,box.top+box.height/2));
          })()`), `UNO ${w}: ${selector} must be visible before scrolling`);
        }
      }
      await viewport(390,844);
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
      await checkHandOrder();
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

      // Keep all 106 original tiles. The acting player can extend the last of ten public groups.
      const crowded=await room('game15',4,state=>{
        const tiles=[...state.pool,...state.players.flatMap(p=>p.hand)];
        const take=(number,color)=>{const i=tiles.findIndex(t=>t.number===number&&t.color===color);assert.ok(i>=0);return tiles.splice(i,1)[0];};
        state.table=Array.from({length:10},(_,i)=>({
          id:'m'+(++state.meldSequence),kind:'group',assignments:[],
          tiles:['red','blue','black'].map(color=>take(i+2,color))
        }));
        const extra=take(11,'orange');
        for(const [i,p] of state.players.entries()) p.hand=i===0?[extra,...tiles.splice(0,13)]:tiles.splice(0,14);
        state.pool=tiles;state.currentIndex=0;state.players[0].opened=true;
      });
      await crowded.begin();
      const extra=crowded.state.players[0].hand[0].id;
      const moved=crowded.state.table[0].tiles.at(-1).id;
      const tile=id=>`#table [data-tile-id="${id}"]`;
      const origin=id=>evaluate(`document.querySelector('${tile(id)}')?.dataset.draftOrigin || null`);
      await tap(`#hand [data-tile-id="${extra}"]`);
      await tap('[data-drop-meld="9"]');
      await until(()=>crowded.state.turnEdited,'dense board edit acknowledged');
      assert.equal(await origin(extra),'rack');
      await tap(tile(moved));await tap('[data-drop-meld="9"]');
      assert.equal(await origin(moved),'meld');
      await crowded.reload();
      assert.equal(await origin(extra),'rack');
      assert.equal(await origin(moved),'meld');
      assert.equal(await evaluate("document.querySelectorAll('#table [data-draft-origin]').length"),2);
      assert.ok(crowded.engine.buildSpectatorView(crowded.state).table[0].tiles.some(t=>t.id===moved));
      await tap(tile(moved));await tap('[data-drop-meld="0"]');
      assert.equal(await origin(moved),null);
      await tap('#actionButtons button','确认并公布牌桌');
      await until(()=>crowded.state.table[9].tiles.some(t=>t.id===extra),'last group extended');
      await until(()=>evaluate("document.querySelectorAll('#table [data-draft-origin]').length === 0"),'private marks clear on commit');
      await crowded.check('extend last of ten groups from rack');
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
      const actor = r.state.players[2], defender = r.state.players[0];
      await r.act(2,{type:'declareAction',actionType:'steal',targetId:defender.id});
      await r.act(0,reaction('pass'));await r.act(1,reaction('pass'));
      await tap('#actionButtons button','声明船长并阻挡');
      await until(()=>r.state.phase==='challengeBlock','second captain can be challenged');
      const claim = '#declarationSlips [data-declaration="action"]';
      const block = '#declarationSlips [data-declaration="block"][aria-current="true"]';
      assert.ok(await evaluate(`document.querySelector('${claim}').textContent.includes(${JSON.stringify(actor.name)})`));
      assert.ok(await evaluate(`document.querySelector('${block}').textContent.includes(${JSON.stringify(defender.name)})`));
      await r.act(2,reaction('challenge'));
      await until(()=>evaluate(`document.querySelector('${block}')?.textContent.includes('待举证')`),'challenge addresses blocker during proof');
      await r.check('two captain claims with the blocker proving');
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

      const council = await room('game22',10,state => { state.leaderId = state.players[0].id; });
      await council.begin();
      for (let i = 0; i < 10; i++) await council.act(i,{type:'acknowledgeSecret'});
      await until(()=>evaluate("!!document.querySelector('.team-selection-summary')"),'ten-player proposal');
      const knights = council.state.players.slice(0,3).map(player => `#players [data-id="${player.id}"]`);
      await viewport(768,1024);
      await tap(knights[0]); await tap(knights[1]);
      await viewport(1024,768);
      const mapRect = () => evaluate("document.querySelector('#roundTable').getBoundingClientRect().toJSON()");
      const beforeReading = await mapRect();
      await tap('[data-play-reference] > summary');
      await tap('.archive-grid details > summary', '圆桌骑士资料');
      assert.equal(await evaluate("document.querySelectorAll('#rosterNotes dt').length"),10);
      assert.deepEqual(await mapRect(),beforeReading);
      await tap('[data-play-reference] > summary');
      assert.equal(await evaluate("document.querySelectorAll('#players .selected').length"),2);
      await tap(knights[2]);
      await tap('#actionButtons button','确认远征队伍');
      await until(()=>council.state.phase==='teamVote','rotated proposal accepted');
      await viewport(390,640);
      const mapPoint = await evaluate(`(()=>{
        const box=document.querySelector('#roundTable').getBoundingClientRect();
        return {x:box.left+20,y:box.top+box.height-18};
      })()`);
      const scrollTop = () => evaluate("document.querySelector('[data-play-workspace]').scrollTop");
      const startScroll = await scrollTop();
      await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[mapPoint]});
      for(let dy=15;dy<=90;dy+=15){
        await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:mapPoint.x,y:mapPoint.y-dy}]});
        await delay(30);
      }
      await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await until(async()=>await scrollTop()>startScroll,'swipe from overview scrolls to actions');
      await tap('#exploreMapButton');
      await tap('#mapZoomInButton');
      assert.ok(parseInt(await evaluate("document.querySelector('#mapZoomText').textContent"),10)>150);
      await tap('#exploreMapButton');
      assert.equal(await evaluate("document.querySelector('#mapZoomText').textContent"),'100%');
      await council.check('ten knights rotate, read volume, submit team and explore map');
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
