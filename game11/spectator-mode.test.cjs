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
const action=(running,session,actionId,value)=>post(running.base,"/api/actions",auth(session,{actionId,action:value}));
const resume=(running,session)=>post(running.base,"/api/join",{roomCode:session.roomCode,clientId:session.clientId,resumeToken:session.resumeToken});

test("game11 lobby seat changes release team order and returning spectators are unassigned",async(context)=>{
  const running=await launch();context.after(()=>close(running));
  const config=await fetch(`${running.base}/api/config`).then((response)=>response.json());assert.equal(config.spectatorsSupported,true);assert.equal(config.spectatorsEnabled,true);
  const host=(await post(running.base,"/api/rooms",{hostId:"w1",name:"白一",capacity:4})).payload;
  const p2=(await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:"w2",name:"白二",intent:"play"})).payload;
  const p3=(await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:"w3",name:"白三",intent:"play"})).payload;
  await action(running,host,"sit-w1",{type:"sit",team:"white"});await action(running,p2,"sit-w2",{type:"sit",team:"white"});await action(running,p3,"sit-w3",{type:"sit",team:"white"});
  const observer=(await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:"watch",name:"旁观者",intent:"spectate"})).payload;
  assert.equal(observer.memberRole,"spectator");assert.equal(observer.view.selfId,null);assert.equal(observer.view.canChangeSeats,true);
  const hostAttempt=await post(running.base,"/api/seat",auth(host,{intent:"spectate"}));assert.equal(hostAttempt.response.status,403);assert.equal(hostAttempt.payload.code,"host_must_remain_player");
  const leaves=await post(running.base,"/api/seat",auth(p2,{intent:"spectate"}));assert.equal(leaves.response.status,200);assert.equal(leaves.payload.memberRole,"spectator");
  let snapshot=running.store.loadRooms().find((room)=>room.roomCode===host.roomCode).snapshot;
  assert.deepEqual(snapshot.state.players.filter((player)=>player.team==="white").map((player)=>[player.id,player.seat]),[["w1",1],["w3",2]]);
  const enters=await post(running.base,"/api/seat",auth(observer,{intent:"play"}));assert.equal(enters.response.status,200);assert.equal(enters.payload.memberRole,"player");
  snapshot=running.store.loadRooms().find((room)=>room.roomCode===host.roomCode).snapshot;
  const returned=snapshot.state.players.find((player)=>player.id===observer.clientId);assert.equal(returned.team,null);assert.equal(returned.seat,0);
  const closed=await post(running.base,"/api/room-settings",{roomCode:host.roomCode,hostId:host.clientId,resumeToken:host.resumeToken,allowSpectators:false});assert.equal(closed.response.status,200);
  const blocked=await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:"blocked",name:"被拒绝",intent:"spectate"});assert.equal(blocked.response.status,403);assert.equal(blocked.payload.code,"spectators_disabled");
  const kicked=await post(running.base,"/api/kick",{roomCode:host.roomCode,hostId:host.clientId,resumeToken:host.resumeToken,playerId:p2.clientId});assert.equal(kicked.response.status,200);
});

test("game11 active spectators see only public phase information and cannot act",async(context)=>{
  const running=await launch();const streams=[];context.after(()=>close(running,streams));
  const host=(await post(running.base,"/api/rooms",{hostId:"w1",name:"白一",capacity:4})).payload;const sessions=[host];
  for(const [id,name] of [["w2","白二"],["b1","黑一"],["b2","黑二"]])sessions.push((await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:id,name,intent:"play"})).payload);
  for(const [index,team] of ["white","white","black","black"].entries())assert.equal((await action(running,sessions[index],`sit-${index}`,{type:"sit",team})).response.status,200);
  const full=(await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:"watch-full",name:"满房旁观",intent:"play"})).payload;assert.equal(full.autoSpectated,true);assert.equal(full.assignmentReason,"player_seats_full");
  for(const session of sessions)streams.push(await events(running.base,session));
  assert.equal((await action(running,host,"start",{type:"start"})).response.status,200);
  let observed=(await resume(running,full)).payload.view;
  assert.equal(observed.selfId,null);assert.deepEqual(observed.teams.white.keywords,[]);assert.deepEqual(observed.teams.black.keywords,[]);assert.equal(observed.code,null);assert.equal(observed.guessDraft,null);assert.ok(observed.players.every((player)=>!("usedClues" in player)));
  assert.equal((await action(running,host,"clues",{type:"clues",clues:["alpha","bravo","charlie"]})).response.status,200);
  observed=(await resume(running,full)).payload.view;assert.deepEqual(observed.clues,["alpha","bravo","charlie"]);assert.equal(observed.code,null);assert.deepEqual(observed.guessStatus,{decode:false,intercept:false});
  assert.equal((await action(running,sessions[1],"guess",{type:"guess",code:[1,2,3]})).response.status,200);
  observed=(await resume(running,full)).payload.view;assert.equal(observed.phase,"reveal");assert.equal(observed.code.length,3);assert.deepEqual(observed.records[0].decodeGuess,[1,2,3]);
  const late=(await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:"watch-late",name:"晚到旁观",intent:"play"})).payload;assert.equal(late.memberRole,"spectator");assert.equal(late.assignmentReason,"game_in_progress");assert.equal(late.view.canChangeSeats,false);
  const forged=await action(running,late,"forged",{type:"guess",code:[1,2,3]});assert.equal(forged.response.status,403);assert.equal(forged.payload.code,"spectator_cannot_act");
  const seatAttempt=await post(running.base,"/api/seat",auth(late,{intent:"play"}));assert.equal(seatAttempt.response.status,409);assert.equal(seatAttempt.payload.code,"seat_change_unavailable");
});

test("game11 serializes competition for its last player seat",async(context)=>{
  const running=await launch();context.after(()=>close(running));const host=(await post(running.base,"/api/rooms",{hostId:"w1",name:"白一",capacity:4})).payload;
  for(const id of ["p2","p3"])await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:id,name:id,intent:"play"});
  const observers=[];for(const id of ["watch-a","watch-b"])observers.push((await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:id,name:id,intent:"spectate"})).payload);
  const results=await Promise.all(observers.map((observer)=>post(running.base,"/api/seat",auth(observer,{intent:"play"}))));assert.deepEqual(results.map(({response})=>response.status).sort(),[200,409]);assert.equal(results.find(({response})=>response.status===409).payload.code,"room_full");
});

test("game11 SQLite restart restores spectator identity and closed setting",async(context)=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"tablegame-game11-spectator-"));const filename=path.join(directory,"game11.sqlite");let running=null;
  context.after(async()=>{if(running?.server.listening)await close(running);fs.rmSync(directory,{recursive:true,force:true});});running=await launch({roomStore:createSqliteRoomStore({filename})});
  const host=(await post(running.base,"/api/rooms",{hostId:"w1",name:"白一",capacity:4})).payload;const observer=(await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:"watch",name:"旁观者",intent:"spectate"})).payload;
  await post(running.base,"/api/room-settings",{roomCode:host.roomCode,hostId:host.clientId,resumeToken:host.resumeToken,allowSpectators:false});await close(running);running=await launch({roomStore:createSqliteRoomStore({filename})});
  const resumed=await resume(running,observer);assert.equal(resumed.response.status,200);assert.equal(resumed.payload.memberRole,"spectator");assert.equal(resumed.payload.view.allowSpectators,false);assert.equal(resumed.payload.view.selfId,null);assert.deepEqual(resumed.payload.view.teams.white.keywords,[]);assert.deepEqual(resumed.payload.view.teams.black.keywords,[]);
});

test("game11 page consumes shared spectator UI and renders public-only guidance",()=>{
  const html=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");const script=fs.readFileSync(path.join(__dirname,"app.js"),"utf8");const styles=fs.readFileSync(path.join(__dirname,"spectator.css"),"utf8");
  assert.match(html,/name="joinIntent" value="spectate"/);assert.match(html,/id="roomHeaderTools"/);assert.match(html,/id="seatActionButton"/);assert.doesNotMatch(html,/id="roomRoleBanner"/);assert.match(html,/id="spectatorList"/);assert.match(html,/shared\/styles\/spectator\.css/);assert.match(script,/createSpectatorUi/);assert.match(script,/spectatorUi\.render\(current\)/);assert.match(script,/双方关键词在行动结束前均对旁观者保密/);assert.match(script,/猜码草稿与最终裁决答案不会提前显示/);assert.match(styles,/spectator-action-note/);
});
