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
const outputDir = path.join(root, 'audit', 'layout-after');
fs.mkdirSync(outputDir, {recursive:true});

function measure() {
  const rect = e => { const r = e.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}; };
  const visible = e => e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
  const board = document.querySelector('.western-table,.case-board,.discussion-table,.intelligence-table,.court-panel,.poker-table,.table-panel,.farm-table,.round-table');
  const seats = [...document.querySelectorAll('.player-seat,.player-farm,.seat,[data-player-id].player')].filter(visible);
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
  const dock=document.querySelector('.table-dock')||document.querySelector('#controlDock');
  return {width:innerWidth,clientWidth:document.documentElement.clientWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,board:board&&rect(board),seatCount:seats.length,seats:boxes,clipped,overlaps,center:visible(center)?rect(center):null,centerOverlaps:visible(center)?boxes.map((a,i)=>intersects(a,rect(center))?i:null).filter(x=>x!==null):[],dock:visible(dock)?rect(dock):null,dockOverBoard:!!document.querySelector('.table-workspace')&&visible(board)&&visible(dock)&&intersects(rect(board),rect(dock))};
}

async function checkSeatAccess() {
  const seats=[...document.querySelectorAll('.table-workspace .player-seat')];
  const blocked=[];
  for(const [index,seat] of seats.entries()){
    seat.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    await new Promise(resolve=>requestAnimationFrame(resolve));
    const r=seat.getBoundingClientRect();
    const hit=document.elementFromPoint(r.left+r.width/2,r.top+Math.min(20,r.height/2));
    if(!hit||!seat.contains(hit))blocked.push({index,hit:hit?.id||hit?.className,top:r.top,height:r.height});
  }
  for(const board of document.querySelectorAll('.table-board'))board.scrollTo(0,0);
  window.scrollTo(0,0);
  return blocked;
}

async function run(){
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
    for(const name of (process.env.LAYOUT_GAMES?.split(',')||['game4','game13','game14','game16','game18','game19','game20','game21','game22'])){
      errors=[];const engine=await import(`../${name}/server/game-engine.mjs`);
      server=start({gameRoot:path.join(root,name),engine,protocolVersion:3,defaultPort:0,spectatorsEnabled:true});await once(server,'listening');
      const base=`http://127.0.0.1:${server.address().port}`;
      await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
      await send('Page.navigate',{url:base});await delay(450);
      const capacity=await evaluate(`(()=>{const s=document.getElementById('playerCountSelect');s.selectedIndex=s.options.length-1;document.getElementById('hostNameInput').value='布局测试房主';document.getElementById('createRoomButton').click();return Number(s.value);})()`);
      await delay(350);
      const code=await evaluate(`document.getElementById('roomCodeDisplay').textContent.trim()`);
      const post=async(url,data)=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const p=await r.json();if(!r.ok)throw Error(name+' '+r.status+' '+JSON.stringify(p));return p;};
      for(let i=1;i<capacity;i++){
        const session=await post('/api/join',{roomCode:code,clientId:'layout-'+i,name:'玩家'+i+'测试长昵称',intent:'play'});
        await new Promise((resolve,reject)=>{const url=new URL('/api/events',base);for(const k of ['roomCode','clientId','resumeToken'])url.searchParams.set(k,session[k]);const request=http.get(url,res=>res.once('data',resolve));request.on('error',reject);streams.push(request);});
        await post('/api/lobby-ready',{roomCode:code,playerId:session.clientId,resumeToken:session.resumeToken,ready:true});
      }
      await delay(180);await evaluate(`document.getElementById('startGameButton').click()`);await delay(1500);
      const entry={name,capacity,errors:[],measurements:[]};
      for(const [width,height] of [[1440,900],[1366,768],[1024,768],[940,700],[900,700],[860,700],[820,700],[768,1024],[390,844],[844,390]]){
        await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});await evaluate('window.scrollTo(0,0)');await delay(100);
        const measured=await evaluate(`(${measure.toString()})()`);
        measured.blockedSeats=await evaluate(`(${checkSeatAccess.toString()})()`);
        entry.measurements.push(measured);
        if(['game13','game18','game19','game21'].includes(name)&&[1440,860,768,390,844].includes(width)){const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(outputDir,`layout-${name}-${width}.png`),Buffer.from(shot.data,'base64'));}
      }
      if(['game18','game19'].includes(name)){
        await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
        await evaluate(`(()=>{
          const equipment=document.querySelector('.equipment');
          if(equipment)for(let i=0;i<8;i++){const item=document.createElement('span');item.className='equip';item.textContent='装备测试 '+i;equipment.append(item);}
          const title=document.querySelector('#caseText');if(title)title.textContent='长案件描述：'.repeat(15);
          const reference=document.querySelector('.table-reference');if(reference)reference.open=true;
        })()`);
        await delay(100);
        const stress=await evaluate(`(${measure.toString()})()`);
        stress.blockedSeats=await evaluate(`(${checkSeatAccess.toString()})()`);
        stress.scenario='expanded-reference-and-content';entry.measurements.push(stress);
      }
      if(['game13','game18','game19','game21'].includes(name)){
        await evaluate('localStorage.clear()');
        await send('Page.navigate',{url:base});await delay(400);
        await evaluate(`(()=>{document.getElementById('guestModeButton').click();document.getElementById('roomCodeInput').value=${JSON.stringify(code)};const radio=document.querySelector('input[name="joinIntent"][value="spectate"]');if(radio)radio.click();document.getElementById('joinRoomButton').click();})()`);
        await delay(500);
        for(const [width,height] of [[1440,900],[768,1024],[390,844]]){
          await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});await delay(100);
          const m=await evaluate(`(${measure.toString()})()`);m.scenario='spectator';
          m.blockedSeats=await evaluate(`(${checkSeatAccess.toString()})()`);
          m.privateVisible=await evaluate(`(()=>{const e=document.querySelector('#privateZone,#secretPanel');return !!e&&!!e.getClientRects().length;})()`);
          assert.equal(m.privateVisible,false,`${name}: spectator private panel`);
          entry.measurements.push(m);
        }
      }
      entry.errors=[...errors];results.push(entry);console.log(JSON.stringify({name,capacity,errors:entry.errors,issues:entry.measurements.filter(x=>x.documentWidth>x.width+2||x.clipped.length||x.overlaps.length||x.centerOverlaps.length).map(x=>({width:x.width,docWidth:x.documentWidth,clipped:x.clipped,overlaps:x.overlaps,centerOverlaps:x.centerOverlaps}))}));
      await send('Page.navigate',{url:'about:blank'});streams.splice(0).forEach(s=>s.destroy());await delay(50);await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});server=null;
    }
    const resultName=process.env.LAYOUT_GAMES?`results-${process.env.LAYOUT_GAMES.replace(/[^a-z0-9,]/gi,'').replaceAll(',','-')}.json`:'results.json';
    fs.writeFileSync(path.join(outputDir,resultName),JSON.stringify(results,null,2));
    await send('Browser.close');
    for(const entry of results){
      assert.deepEqual(entry.errors,[],`${entry.name}: browser exceptions`);
      for(const m of entry.measurements){
        const context=`${entry.name} ${m.width}x${m.height}`;
        assert.equal(m.seatCount,entry.capacity,`${context}: missing seats`);
        assert.deepEqual(m.clipped,[],`${context}: clipped seats`);
        assert.deepEqual(m.overlaps,[],`${context}: overlapping seats`);
        assert.deepEqual(m.centerOverlaps,[],`${context}: seat over center`);
        assert.deepEqual(m.blockedSeats,[],`${context}: inaccessible seats`);
        assert.equal(m.dockOverBoard,false,`${context}: action dock over board`);
        assert.ok(m.documentWidth<=m.clientWidth+2,`${context}: horizontal document overflow (${m.documentWidth}/${m.clientWidth})`);
      }
    }
    console.log(`Layout checks passed: ${results.length} games, ${results.reduce((n,r)=>n+r.measurements.length,0)} scenarios; initialization: game, game2.`);
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
run().catch(e=>{console.error(e);process.exitCode=1;});
