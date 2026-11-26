// Local layout measurements only; synthetic rooms, memory storage, no production access.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const start = require('../shared/server/start-authoritative-game-server');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'audit', process.env.LAYOUT_DETAIL_DIR||'play-layout-checks');

function measure() {
  const rect = e => { const r = e.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}; };
  const visible = e => e && e.checkVisibility({checkVisibilityCSS:true});
  const board = document.querySelector('[data-play-board]') || document.querySelector('.western-table,.case-board,.discussion-table,.intelligence-table,.court-panel,.poker-table,.table-panel,.farm-table,.round-table');
  const selectors={game:'#playerList > [data-player-id]',game2:'#seatBoard .seat-card',game3:'#playerList .player-item',game4:'.seat',game5:'#players > .player',game6:'#playerList > [data-player-panel]',game7:'#playerList > .player',game8:'#players > .player',game9:'#playerList > .player-item',game10:'#playerList > .player-item',game11:'.team-column .seat',game14:'.player-farm',game15:'#scoreboard > .score-row',game16:'.player-seat',game17:'#players > .player-row',game20:'.player-seat',game22:'#players > .player-seat',game23:'.traveler'};
  const seats = [...document.querySelectorAll(selectors[window.__layoutName])].filter(visible);
  const center = document.querySelector('#tableCenter,.public-focus,.discard-area,.court-center');
  const intersects = (a,b) => Math.min(a.right,b.right)-Math.max(a.x,b.x)>2 && Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>2;
  const boxes = seats.map(rect);
  const clipped = seats.map((e,i) => {
    const r={...boxes[i]}, clips=[];
    for(let p=e.parentElement;p;p=p.parentElement){
      const s=getComputedStyle(p),b=rect(p);
      if(/hidden|clip/.test(s.overflowX)&&(r.x<b.x-2||r.right>b.right+2))clips.push(p.id||p.className);
      if(/hidden|clip/.test(s.overflowY)&&(r.y<b.y-2||r.bottom>b.bottom+2))clips.push(p.id||p.className);
      // A deliberate scrollport makes offscreen content reachable. Intersect its
      // visible area before testing outer clipping; hit testing below verifies access.
      if(/auto|scroll/.test(s.overflowX)){r.x=Math.max(r.x,b.x);r.right=Math.min(r.right,b.right);}
      if(/auto|scroll/.test(s.overflowY)){r.y=Math.max(r.y,b.y);r.bottom=Math.min(r.bottom,b.bottom);}
      if(r.right<=r.x||r.bottom<=r.y)break;
    }
    return {index:i,clips:[...new Set(clips)]};
  }).filter(x=>x.clips.length);
  const overlaps=[];boxes.forEach((a,i)=>boxes.slice(i+1).forEach((b,j)=>{if(intersects(a,b))overlaps.push([i,i+j+1]);}));
  const dock=document.querySelector('[data-play-controls]') || document.querySelector('.table-dock,#controlDock,.action-panel,.decision-panel,#turnHandPanel');
  const diagnostics = [...document.querySelectorAll('#roomPanel button,#roomPanel input,#roomPanel select')].filter(visible).filter(e=>!e.disabled).map(e=>{const r=rect(e);return {id:e.id,label:e.textContent.trim().slice(0,32),rect:r};}).filter(x=>x.rect.right>document.documentElement.clientWidth+2||x.rect.x < -2);
  return {inRoom:document.getElementById('roomPanel').checkVisibility({checkVisibilityCSS:true}),play:[...document.querySelectorAll('[data-play-room],[data-play-workspace],[data-play-board],[data-play-controls]')].map(e=>({tag:e.tagName,cls:e.className,rect:rect(e),style:{display:getComputedStyle(e).display,rows:getComputedStyle(e).gridTemplateRows,minH:getComputedStyle(e).minHeight,overflow:getComputedStyle(e).overflow,area:getComputedStyle(e).gridArea}})),diagnostics,width:innerWidth,clientWidth:document.documentElement.clientWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,board:board&&rect(board),seatCount:seats.length,seats:boxes,clipped,overlaps,center:visible(center)?rect(center):null,centerOverlaps:visible(center)?boxes.map((a,i)=>intersects(a,rect(center))?i:null).filter(x=>x!==null):[],dock:visible(dock)?rect(dock):null,dockOverBoard:!!document.querySelector('[data-play-workspace]')&&visible(board)&&visible(dock)&&intersects(rect(board),rect(dock))};
}

// Hit-test actual controls after scrolling nested docks/hand strips. This catches
// overlap and clipping that seat bounding-box tests alone cannot detect.
async function checkSeatAccess() {
  const dock=document.querySelector('[data-play-controls]');
  if(!dock)return [];
  const visible=e=>e.checkVisibility({checkVisibilityCSS:true});
  const targets=[...document.querySelectorAll('[data-play-controls] button,[data-play-controls] input,[data-play-controls] select,[data-play-controls] textarea,[data-play-controls] summary,[data-play-board] .player-seat,[data-play-board] .seat,[data-play-board] .pig.targetable')].filter(e=>visible(e)&&!e.disabled);
  const blocked=[];
  for(const e of targets){
    e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
    await new Promise(resolve=>requestAnimationFrame(resolve));
    const r=e.getBoundingClientRect();let left=Math.max(0,r.left),right=Math.min(innerWidth,r.right),top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom);
    for(let p=e.parentElement;p;p=p.parentElement){const b=p.getBoundingClientRect(),s=getComputedStyle(p);if(/auto|scroll|hidden|clip/.test(s.overflowX)){left=Math.max(left,b.left);right=Math.min(right,b.right);}if(/auto|scroll|hidden|clip/.test(s.overflowY)){top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom);}}
    const hit=right>left&&bottom>top?document.elementFromPoint((left+right)/2,(top+bottom)/2):null;
    if(!hit||!(e===hit||e.contains(hit)))blocked.push({id:e.id,tag:e.tagName,label:e.textContent.trim().slice(0,24),hit:hit?.id||hit?.className});
  }
  for(const e of document.querySelectorAll('[data-play-workspace] *'))if(e.scrollTop||e.scrollLeft)e.scrollTo({top:0,left:0,behavior:'instant'});
  window.scrollTo(0,0);
  return blocked;
}

async function run(){
  fs.mkdirSync(outputDir, {recursive:true});
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'tablegame-layout-review-'));
  const chromePath=process.env.CHROME_PATH||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':'google-chrome');
  // This isolated Windows runner needs --no-sandbox; never used for remote sites.
  const chrome=spawn(chromePath,['--headless=new',...(process.platform==='win32'||process.env.CHROME_NO_SANDBOX==='1'?['--no-sandbox']:[]),'--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--disable-background-networking','about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let ws, server;const streams=[],results=[];
  try{
    const endpoint=await new Promise((resolve,reject)=>{let s='';const t=setTimeout(()=>reject(Error('Chrome timeout')),15000);chrome.stderr.on('data',b=>{s+=b;const m=s.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(t);resolve(new URL(m[1]));}});});
    const pages=await fetch(`http://${endpoint.host}/json/list`).then(r=>r.json());
    ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await once(ws,'open');let seq=0;const pending=new Map();let errors=[];
    ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);if(m.method==='Page.javascriptDialogOpening'){console.log('Local page dialog: '+m.params.message);ws.send(JSON.stringify({id:++seq,method:'Page.handleJavaScriptDialog',params:{accept:true}}));}});
    const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>reject(Error(method+' timeout')),10000);pending.set(id,m=>{clearTimeout(t);m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result);});ws.send(JSON.stringify({id,method,params}));});
    const evaluate=async expression=>{try{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result?.value;}catch(e){throw Error(e.message+' '+expression.slice(0,140));}};
    await send('Page.enable');await send('Runtime.enable');
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    for(const name of ['game','game2']){
      errors=[];
      const engine=await import(`../${name}/server/game-engine.mjs`);
      server=start({gameRoot:path.join(root,name),engine,protocolVersion:3,defaultPort:0,spectatorsEnabled:true});
      await once(server,'listening');
      await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});
      await delay(450);
      assert.deepEqual(errors,[],`${name}: initialization exceptions`);
      await send('Page.navigate',{url:'about:blank'});
      await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});server=null;
    }
    for(const name of (process.env.LAYOUT_GAMES?.split(',')||['game','game2','game3','game4','game5','game6','game7','game8','game9','game10','game11','game14','game15','game16','game17','game20','game22','game23'])){
      errors=[];const engine=await import(`../${name}/server/game-engine.mjs`);
      server=start({gameRoot:path.join(root,name),engine,protocolVersion:3,defaultPort:0,spectatorsEnabled:true});await once(server,'listening');
      const base=`http://127.0.0.1:${server.address().port}`;
      await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
      await send('Page.navigate',{url:base});await delay(450);
      if(name==='game'&&Number(process.env.GAME1_PLAYERS)>18)await evaluate("document.getElementById('gameModeSelect').value='playerWords'");
      const capacity=await evaluate(`(()=>{const s=document.getElementById('playerCountSelect');if(s)s.selectedIndex=s.options.length-1;document.getElementById('hostNameInput').value='布局测试房主';document.getElementById('createRoomButton').click();return s?Number(s.value):${Number(process.env.GAME1_PLAYERS||8)};})()`);
      await delay(350);
      const code=await evaluate(`document.getElementById('roomCodeDisplay').textContent.trim()`);
      if (name === 'game5') {
        await send('Emulation.setDeviceMetricsOverride',{width:1800,height:948,deviceScaleFactor:1,mobile:false});
        await delay(120);
        const waiting = await evaluate(`({
          code: document.querySelector('#invitationCode').innerText,
          roster: document.querySelector('#players').checkVisibility(),
          piles: document.querySelector('#tableStage').checkVisibility(),
          hand: document.querySelector('#handPanel').checkVisibility()
        })`);
        assert.deepEqual(waiting, {code,roster:true,piles:false,hand:false}, 'UNO single-player waiting room');
        const shot=await send('Page.captureScreenshot',{format:'png'});
        fs.writeFileSync(path.join(outputDir,'uno-wide-lobby.png'),Buffer.from(shot.data,'base64'));
      }
      const post=async(url,data)=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const p=await r.json();if(!r.ok)throw Error(name+' '+r.status+' '+JSON.stringify(p));return p;};
      if(name==='game2')await evaluate("document.querySelector('[data-sit=\"0\"]').click()");
      if(name==='game11')await evaluate("document.querySelector('[data-sit=\"white\"]').click()");
      const guestSessions=[];
      for(let i=1;i<capacity;i++){
        const session=await post('/api/join',{roomCode:code,clientId:'layout-'+i,name:'玩家'+i+'测试长昵称',intent:'play'});
        guestSessions.push(session);
        await new Promise((resolve,reject)=>{const url=new URL('/api/events',base);for(const k of ['roomCode','clientId','resumeToken'])url.searchParams.set(k,session[k]);const request=http.get(url,res=>res.once('data',resolve));request.on('error',reject);streams.push(request);});
        if(name==='game2'||name==='game11')await post('/api/actions',{roomCode:code,playerId:session.clientId,resumeToken:session.resumeToken,actionId:'layout-sit-'+i,action:name==='game2'?{type:'sit',seatIndex:i}:{type:'sit',team:i%2?'black':'white'}});
        await post('/api/lobby-ready',{roomCode:code,playerId:session.clientId,resumeToken:session.resumeToken,ready:true});
      }
      await delay(180);await evaluate(`document.getElementById('startGameButton').click()`);await delay(1500);
      if(name==='game17'){
        // Exercise a real supply action, including its animation after board scrolling.
        // Sessions belong exclusively to this disposable in-memory test room.
        const saved=await evaluate("JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('tablegame:stockpile:'))))");
        const sessions=[{clientId:saved.playerId,resumeToken:saved.resumeToken},...guestSessions];
        for(const session of sessions){
          const {view}=await post('/api/join',{roomCode:code,clientId:session.clientId,resumeToken:session.resumeToken});
          if(!view.permissions.canPlaceSupply)continue;
          await evaluate("(()=>{document.querySelector('[data-play-board]').scrollTop=150;window.__marketToken=false;window.__marketObserver=new MutationObserver(records=>{for(const record of records)for(const n of record.addedNodes)if(n.classList?.contains('presentation-token'))window.__marketToken=Number.isFinite(parseFloat(n.style.getPropertyValue('--from-x')))&&Number.isFinite(parseFloat(n.style.getPropertyValue('--to-y')));});window.__marketObserver.observe(document.getElementById('presentationEffects'),{childList:true});})()");
          await post('/api/actions',{roomCode:code,playerId:session.clientId,resumeToken:session.resumeToken,actionId:'layout-supply',action:{type:'placeSupply',faceUpCardId:view.supplyHand[0].id,faceDownCardId:view.supplyHand[1].id,faceUpPileId:view.stockpiles[0].id,faceDownPileId:view.stockpiles[1].id}});
          let animated=false;for(let i=0;i<30&&!animated;i++){await delay(100);animated=await evaluate('window.__marketToken');}
          assert.equal(animated,true,'game17: supply animation must retain a valid coordinate origin');
          await evaluate("window.__marketObserver.disconnect();document.querySelector('[data-play-board]').scrollTop=0");
          await delay(600);break;
        }
      }
      if(process.env.ACK_SECRETS!=='0'&&['game20','game22'].includes(name)){
        await evaluate("[...document.querySelectorAll('#actionButtons button')].find(b=>b.textContent.includes('我已'))?.click()");await delay(100);
        for(const session of guestSessions){const joined=await post('/api/join',{roomCode:code,clientId:session.clientId,resumeToken:session.resumeToken});if(joined.view.permissions.canAcknowledge||joined.view.permissions.canAcknowledgeSecret)await post('/api/actions',{roomCode:code,playerId:session.clientId,resumeToken:session.resumeToken,actionId:'ack-'+session.clientId,action:{type:'acknowledgeSecret'}});}
        await delay(400);
      }
      await evaluate('window.__layoutName='+JSON.stringify(name));
      const entry={name,capacity,errors:[],measurements:[],phase:await evaluate('document.querySelector("#phaseBadge,#phaseText")?.textContent'),startDisabled:await evaluate('document.getElementById("startGameButton").disabled')};
      for(const [width,height] of [[1440,900],[1366,768],[1024,768],[940,700],[900,700],[860,700],[820,700],[768,1024],[390,844],[844,390]]){
        await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});await evaluate('window.scrollTo(0,0)');await delay(100);
        const measured=await evaluate(`(${measure.toString()})()`);measured.requestedViewport={width,height};
        measured.blockedSeats=await evaluate(`(${checkSeatAccess.toString()})()`);
        entry.measurements.push(measured);
        if([1440,860,390,844].includes(width)){const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(outputDir,`layout-${name}-${width}.png`),Buffer.from(shot.data,'base64'));}
      }

      if(await evaluate("!!document.querySelector('[data-play-workspace]')")){
        const readingSizes = name === 'game22' ? [[390,844],[844,390],[768,1024],[1024,768]] : [[390,844],[844,390]];
        for(const [width,height] of readingSizes){
          await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});
          await evaluate("(()=>{document.querySelector('[data-play-reference]').open=true;for(const e of document.querySelectorAll('[data-play-controls] details'))e.open=true;const dock=document.querySelector('#controlDock');if(dock?.hasAttribute('data-expanded'))dock.dataset.expanded='true';const console=document.querySelector('#turnConsole');if(console)console.dataset.handExpanded='true';})()");
          await delay(100);
          if (name === 'game22') {
            // The volume replaces the decision pane. Check the reader, then its return path.
            const reader = await evaluate(`(()=>{
              const rect = selector => document.querySelector(selector).getBoundingClientRect();
              const page = rect('.archive-grid'), map = rect('#roundTable'), toggle = rect('[data-play-reference] > summary');
              const hit = document.elementFromPoint(page.x + page.width / 2, page.y + 12);
              return {readable: page.height > 100 && !!hit?.closest('.archive-grid'), clearMap: map.right <= page.left + 1,
                returnVisible: toggle.bottom <= innerHeight && toggle.top >= page.bottom};
            })()`);
            assert.ok(reader.readable && reader.returnVisible, 'Avalon volume and return control must be reachable');
            if (width > height) assert.ok(reader.clearMap, 'Landscape volume must leave the map clear');
            await evaluate("document.querySelector('[data-play-reference] > summary').click()");
            if (width <= 600) {
              // On phones the open identity card follows the map in one scrollable column.
              await evaluate("document.querySelector('#controlDock').scrollIntoView({block:'end',behavior:'instant'})");
            }
          }
          const m=await evaluate('('+measure.toString()+')()');m.scenario='expanded-panels';m.requestedViewport={width,height};m.blockedSeats=await evaluate('('+checkSeatAccess.toString()+')()');entry.measurements.push(m);
        }
        await evaluate('localStorage.clear()');await send('Page.navigate',{url:base});await delay(400);
        await evaluate('(()=>{document.getElementById("guestModeButton").click();document.getElementById("roomCodeInput").value='+JSON.stringify(code)+';const radio=document.querySelector("input[name=joinIntent][value=spectate]");if(radio)radio.click();document.getElementById("joinRoomButton").click();})()');await delay(450);await evaluate('window.__layoutName='+JSON.stringify(name));
        for(const [width,height] of [[390,844],[844,390]]){
          await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});await delay(100);
          const m=await evaluate('('+measure.toString()+')()');m.scenario='spectator';m.requestedViewport={width,height};
          m.privateVisible=await evaluate('(()=>{const ids={game4:"myHoleCards",game5:"handPanel",game8:"trainerBoard",game14:"handZone",game15:"handZone",game16:"privateZone",game17:"privateZone",game20:"secretPanel",game22:"secretPanel",game23:"handPanel"};const e=document.getElementById(ids['+JSON.stringify(name)+']);return !!e&&e.checkVisibility({checkVisibilityCSS:true});})()');
          m.blockedSeats=await evaluate('('+checkSeatAccess.toString()+')()');entry.measurements.push(m);
        }
      }

      entry.errors=[...errors];results.push(entry);console.log(JSON.stringify({name,capacity,errors:entry.errors,issues:entry.measurements.filter(x=>x.documentWidth>x.width+2||x.clipped.length||x.overlaps.length||x.centerOverlaps.length).map(x=>({width:x.width,docWidth:x.documentWidth,clipped:x.clipped,overlaps:x.overlaps,centerOverlaps:x.centerOverlaps}))}));
      await send('Page.navigate',{url:'about:blank'});streams.splice(0).forEach(s=>s.destroy());await delay(50);await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});server=null;
    }
    const resultName=process.env.LAYOUT_GAMES?`results-${process.env.LAYOUT_GAMES.replace(/[^a-z0-9,]/gi,'').replaceAll(',','-')}.json`:'results.json';
    fs.writeFileSync(path.join(outputDir,resultName),JSON.stringify(results,null,2));
    await send('Browser.close');

    const failures=[];
    for(const entry of results){
      if(entry.errors.length)failures.push({name:entry.name,errors:entry.errors});
      for(const m of entry.measurements){
        const reasons=[];
        if(!m.inRoom)reasons.push('room not visible');
        if(m.documentWidth>m.clientWidth+2)reasons.push('horizontal document overflow');
        if(m.clipped.length)reasons.push('clipped seats');
        if(m.scenario==='expanded-panels'&&m.seatCount!==entry.capacity)reasons.push('missing seats');
        if(m.overlaps.length||m.centerOverlaps.length)reasons.push('seat overlap');
        if(m.blockedSeats.length)reasons.push('inaccessible controls/seats');
        if(m.privateVisible)reasons.push('spectator private panel visible');
        if(m.play.length){
          if(m.documentHeight>m.height+2)reasons.push('viewport shell overflow');
          if(m.dockOverBoard)reasons.push('controls cover board');
          if(m.play[2].rect.h<40)reasons.push('board too short');
          if(m.dock?.bottom>m.height+2)reasons.push('controls outside viewport');
        }
        if(reasons.length)failures.push({name:entry.name,viewport:m.requestedViewport,scenario:m.scenario,reasons,blocked:m.blockedSeats,clipped:m.clipped});
      }
    }
    fs.writeFileSync(path.join(outputDir,'failures.json'),JSON.stringify(failures,null,2));
    assert.equal(failures.length,0,JSON.stringify(failures.slice(0,8)));
    console.log('Play layout checks passed: '+results.length+' games, '+results.reduce((n,r)=>n+r.measurements.length,0)+' scenarios.');
  }finally{
    streams.forEach(s=>s.destroy());if(server){server.close();server.closeAllConnections();}ws?.close();
    if(chrome.exitCode==null)chrome.kill();await delay(400);
    const resolvedProfile=path.resolve(profile);
    assert.equal(path.dirname(resolvedProfile),path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolvedProfile).startsWith('tablegame-layout-review-'));
    try{fs.rmSync(resolvedProfile,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
    catch{console.log('Temporary browser profile retained: '+resolvedProfile);}
  }
}
module.exports = { measure, checkSeatAccess };
if (require.main === module) run().catch(e=>{console.error(e);process.exitCode=1;});
