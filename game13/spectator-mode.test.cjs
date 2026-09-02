"use strict";

const assert=require("node:assert/strict");
const fs=require("node:fs");
const http=require("node:http");
const os=require("node:os");
const path=require("node:path");
const test=require("node:test");
const startServer=require("../shared/server/start-authoritative-game-server");
const {createMemoryRoomStore}=require("../shared/server/memory-room-store");
const {createSqliteRoomStore}=require("../shared/server/sqlite-room-store");

async function post(base,pathname,body){const response=await fetch(`${base}${pathname}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});return{response,payload:await response.json()};}
function events(base,session){return new Promise((resolve,reject)=>{const url=new URL("/api/events",base);url.searchParams.set("clientId",session.clientId);url.searchParams.set("roomCode",session.roomCode);url.searchParams.set("resumeToken",session.resumeToken);const request=http.get(url,(response)=>{if(response.statusCode!==200)return reject(new Error(`SSE returned ${response.statusCode}`));response.once("data",()=>resolve({request,response}));});request.on("error",reject);});}
async function launch(options={}){const engine=await import("./server/game-engine.mjs");const store=options.roomStore||createMemoryRoomStore();const server=startServer({gameRoot:__dirname,sharedRoot:path.resolve(__dirname,"../shared"),engine,protocolVersion:3,defaultPort:0,spectatorsEnabled:true,spectatorLimit:10,roomStore:store,...options});await new Promise((resolve)=>server.once("listening",resolve));return{server,store,base:`http://127.0.0.1:${server.address().port}`};}
async function close(running,streams=[]){for(const stream of streams)stream.request.destroy();await new Promise((resolve)=>setImmediate(resolve));await new Promise((resolve)=>{running.server.close(resolve);running.server.closeAllConnections?.();});}
const auth=(session,extras={})=>({roomCode:session.roomCode,playerId:session.clientId,resumeToken:session.resumeToken,...extras});

test("game13 supports voluntary spectators and lobby-only seat changes",async(context)=>{
  const running=await launch();context.after(()=>close(running));
  const config=await fetch(`${running.base}/api/config`).then((response)=>response.json());
  assert.equal(config.spectatorsSupported,true);assert.equal(config.spectatorsEnabled,true);
  const host=(await post(running.base,"/api/rooms",{hostId:"p1",name:"甲",capacity:3})).payload;
  const player=(await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:"p2",name:"乙",intent:"play"})).payload;
  const observer=(await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:"watch",name:"旁观者",intent:"spectate"})).payload;
  assert.equal(observer.memberRole,"spectator");assert.equal(observer.view.selfId,null);assert.equal(observer.view.canChangeSeats,true);
  const hostAttempt=await post(running.base,"/api/seat",auth(host,{intent:"spectate"}));assert.equal(hostAttempt.response.status,403);assert.equal(hostAttempt.payload.code,"host_must_remain_player");
  const playerLeaves=await post(running.base,"/api/seat",auth(player,{intent:"spectate"}));assert.equal(playerLeaves.response.status,200);assert.equal(playerLeaves.payload.memberRole,"spectator");
  const observerPlays=await post(running.base,"/api/seat",auth(observer,{intent:"play"}));assert.equal(observerPlays.response.status,200);assert.equal(observerPlays.payload.memberRole,"player");
  const closed=await post(running.base,"/api/room-settings",{roomCode:host.roomCode,hostId:host.clientId,resumeToken:host.resumeToken,allowSpectators:false});assert.equal(closed.response.status,200);
  const blocked=await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:"blocked",name:"被拒绝",intent:"spectate"});assert.equal(blocked.response.status,403);assert.equal(blocked.payload.code,"spectators_disabled");
  const kicked=await post(running.base,"/api/kick",{roomCode:host.roomCode,hostId:host.clientId,resumeToken:host.resumeToken,playerId:player.clientId});assert.equal(kicked.response.status,200);
});

test("game13 active spectators receive no initial peek, drawn card or private notices",async(context)=>{
  const running=await launch();const streams=[];context.after(()=>close(running,streams));
  const host=(await post(running.base,"/api/rooms",{hostId:"p1",name:"甲",capacity:2})).payload;
  const guest=(await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:"p2",name:"乙",intent:"play"})).payload;
  const full=(await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:"watch-full",name:"满房旁观",intent:"play"})).payload;
  assert.equal(full.memberRole,"spectator");assert.equal(full.autoSpectated,true);assert.equal(full.assignmentReason,"player_seats_full");
  streams.push(await events(running.base,host),await events(running.base,guest));
  assert.equal((await post(running.base,"/api/actions",auth(host,{actionId:"start",action:{type:"start"}}))).response.status,200);
  const hostView=(await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:host.clientId,resumeToken:host.resumeToken})).payload.view;
  const initialIds=hostView.players[0].slots.slice(0,2).map((slot)=>slot.slotId);
  assert.equal((await post(running.base,"/api/actions",auth(host,{actionId:"peek",action:{type:"initialPeek",slotIds:initialIds}}))).response.status,200);
  const observed=(await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:full.clientId,resumeToken:full.resumeToken})).payload.view;
  assert.equal(observed.selfId,null);assert.equal(observed.pendingCard,null);assert.equal(observed.privateReveal,null);assert.equal(observed.targetNotice,null);
  assert.ok(observed.players.flatMap((player)=>player.slots).every((slot)=>slot.value===null&&!("card" in slot)));
  assert.ok(Object.values(observed.permissions).every((allowed)=>allowed===false));
  const late=(await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:"watch-late",name:"开局后旁观",intent:"play"})).payload;
  assert.equal(late.memberRole,"spectator");assert.equal(late.assignmentReason,"game_in_progress");assert.equal(late.view.canChangeSeats,false);
  const forged=await post(running.base,"/api/actions",auth(late,{actionId:"forged",action:{type:"drawDeck"}}));assert.equal(forged.response.status,403);assert.equal(forged.payload.code,"spectator_cannot_act");
  const seatAttempt=await post(running.base,"/api/seat",auth(late,{intent:"play"}));assert.equal(seatAttempt.response.status,409);assert.equal(seatAttempt.payload.code,"seat_change_unavailable");
});

test("game13 SQLite restart restores spectator identity and room setting",async(context)=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"tablegame-game13-spectator-"));const filename=path.join(directory,"game13.sqlite");let running=null;
  context.after(async()=>{if(running?.server.listening)await close(running);fs.rmSync(directory,{recursive:true,force:true});});
  running=await launch({roomStore:createSqliteRoomStore({filename})});
  const host=(await post(running.base,"/api/rooms",{hostId:"p1",name:"甲",capacity:2})).payload;
  const observer=(await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:"watch",name:"旁观者",intent:"spectate"})).payload;
  await post(running.base,"/api/room-settings",{roomCode:host.roomCode,hostId:host.clientId,resumeToken:host.resumeToken,allowSpectators:false});
  await close(running);running=await launch({roomStore:createSqliteRoomStore({filename})});
  const resumed=await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:observer.clientId,resumeToken:observer.resumeToken});
  assert.equal(resumed.response.status,200);assert.equal(resumed.payload.resumed,true);assert.equal(resumed.payload.memberRole,"spectator");assert.equal(resumed.payload.view.allowSpectators,false);assert.equal(resumed.payload.view.selfId,null);
});

test("game13 serializes concurrent competition for the last player seat",async(context)=>{
  const running=await launch();context.after(()=>close(running));
  const host=(await post(running.base,"/api/rooms",{hostId:"p1",name:"甲",capacity:2})).payload;
  const observers=[];
  for(const id of ["watch-a","watch-b"])observers.push((await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:id,name:id,intent:"spectate"})).payload);
  const results=await Promise.all(observers.map((observer)=>post(running.base,"/api/seat",auth(observer,{intent:"play"}))));
  assert.deepEqual(results.map(({response})=>response.status).sort(),[200,409]);
  assert.equal(results.find(({response})=>response.status===409).payload.code,"room_full");
  const snapshot=running.store.loadRooms().find((room)=>room.roomCode===host.roomCode).snapshot;
  assert.equal(snapshot.state.players.length,2);
});

test("game13 page uses the shared spectator UI and a fixed read-only table view",()=>{
  const html=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");const script=fs.readFileSync(path.join(__dirname,"app.js"),"utf8");const styles=fs.readFileSync(path.join(__dirname,"styles.css"),"utf8");
  assert.match(html,/name="joinIntent" value="play"/);assert.match(html,/name="joinIntent" value="spectate"/);assert.match(html,/id="roomRoleBanner"/);assert.match(html,/id="spectatorList"/);assert.match(html,/shared\/styles\/spectator\.css/);
  assert.match(script,/createSpectatorUi/);assert.match(script,/spectatorUi\.render\(view\)/);assert.match(script,/memberRole==="spectator"/);assert.match(script,/aria-disabled/);assert.match(script,/\["self","left","top","right"\]/);assert.match(styles,/spectator-action-note/);
});
