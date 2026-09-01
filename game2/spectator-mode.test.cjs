"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const startServer = require("../shared/server/start-authoritative-game-server");
const { createMemoryRoomStore } = require("../shared/server/memory-room-store");
const { createSqliteRoomStore } = require("../shared/server/sqlite-room-store");

async function post(base, pathname, body) {
  const response = await fetch(`${base}${pathname}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  return {response,payload:await response.json()};
}
const auth = (session, extras = {}) => ({roomCode:session.roomCode,playerId:session.clientId,resumeToken:session.resumeToken,...extras});
function openEvents(base,session) {
  return new Promise((resolve,reject) => {
    const url = new URL("/api/events",base);
    for (const key of ["clientId","roomCode","resumeToken"]) url.searchParams.set(key,session[key]);
    const request = http.get(url,(response) => response.statusCode === 200 ? response.once("data",() => resolve(request)) : reject(new Error(`SSE ${response.statusCode}`)));
    request.on("error",reject);
  });
}
async function launch(options = {}) {
  const engine = await import("./server/game-engine.mjs");
  const store = options.roomStore || createMemoryRoomStore();
  const server = startServer({gameRoot:__dirname,sharedRoot:path.resolve(__dirname,"../shared"),engine,protocolVersion:3,defaultPort:0,spectatorsEnabled:true,spectatorLimit:10,roomStore:store});
  await new Promise((resolve) => server.once("listening",resolve));
  return {server,store,base:`http://127.0.0.1:${server.address().port}`};
}
async function close(running,streams = []) {
  streams.forEach((stream) => stream.destroy());
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => {running.server.close(resolve);running.server.closeAllConnections?.();});
}
async function createRoom(running,capacity = 2) {
  return (await post(running.base,"/api/rooms",{hostId:"host",name:"房主",capacity})).payload;
}
async function action(running,session,id,value) {
  return post(running.base,"/api/actions",auth(session,{actionId:id,action:value}));
}

test("game2 lobby role changes release team seats and the spectator view keeps answers secret",async (context) => {
  const running = await launch(); const streams = [];
  context.after(() => running.server.listening && close(running,streams));
  const host = await createRoom(running,2); streams.push(await openEvents(running.base,host));
  const guest = (await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:"p2",name:"队长",intent:"play"})).payload;
  streams.push(await openEvents(running.base,guest));
  await action(running,host,"sit-host",{type:"sit",seatIndex:1});
  await action(running,guest,"sit-guest",{type:"sit",seatIndex:0});
  const left = (await post(running.base,"/api/seat",auth(guest,{intent:"spectate"}))).payload;
  assert.equal(left.memberRole,"spectator");
  assert.equal(left.view.seats[0].playerId,null);
  const returned = (await post(running.base,"/api/seat",auth(guest,{intent:"play"}))).payload;
  assert.equal(returned.memberRole,"player");
  await action(running,guest,"sit-again",{type:"sit",seatIndex:0});
  const observer = (await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:"watch",name:"旁观",intent:"spectate"})).payload;
  assert.equal((await action(running,host,"start",{type:"start"})).response.status,200);
  const captainView = (await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:guest.clientId,resumeToken:guest.resumeToken})).payload.view;
  const spectatorView = (await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:observer.clientId,resumeToken:observer.resumeToken})).payload.view;
  assert.ok(captainView.idiom);
  assert.equal(spectatorView.idiom,"");
  assert.equal(spectatorView.idiomHidden,true);
  assert.equal(spectatorView.myRole,null);
  assert.equal((await action(running,guest,"describe",{type:"describe",text:"已经公开的描述"})).response.status,200);
  const afterDescription = (await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:observer.clientId,resumeToken:observer.resumeToken})).payload.view;
  assert.equal(afterDescription.currentDescription,"已经公开的描述");
  assert.equal(afterDescription.idiom,"");
  const forged = await action(running,observer,"forged",{type:"guess",text:captainView.idiom});
  assert.equal(forged.response.status,403);
  assert.equal(forged.payload.code,"spectator_cannot_act");
});

test("game2 full and active rooms auto-assign spectators and lock seat changes",async (context) => {
  const running = await launch(); const streams = [];
  context.after(() => running.server.listening && close(running,streams));
  const host = await createRoom(running,2); streams.push(await openEvents(running.base,host));
  const guest = (await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:"p2",name:"二号",intent:"play"})).payload;
  streams.push(await openEvents(running.base,guest));
  const full = (await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:"full",name:"满房",intent:"play"})).payload;
  assert.equal(full.autoSpectated,true);
  await action(running,host,"sit-host",{type:"sit",seatIndex:1});
  await action(running,guest,"sit-guest",{type:"sit",seatIndex:0});
  await action(running,host,"start",{type:"start"});
  const late = (await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:"late",name:"晚到",intent:"play"})).payload;
  assert.equal(late.assignmentReason,"game_in_progress");
  assert.equal(late.view.idiom,"");
  const seat = await post(running.base,"/api/seat",auth(late,{intent:"play"}));
  assert.equal(seat.response.status,409);
  assert.equal(seat.payload.code,"seat_change_unavailable");
});

test("game2 serializes the last player seat and persists spectator identity in SQLite",async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),"tablegame-game2-spectator-")); let running = null;
  context.after(async () => {if (running?.server.listening) await close(running);fs.rmSync(directory,{recursive:true,force:true});});
  const filename = path.join(directory,"game2.sqlite");
  running = await launch({roomStore:createSqliteRoomStore({filename})});
  const host = await createRoom(running,2);
  const observers = [];
  for (const id of ["a","b"]) observers.push((await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:id,name:id,intent:"spectate"})).payload);
  const results = await Promise.all(observers.map((observer) => post(running.base,"/api/seat",auth(observer,{intent:"play"}))));
  assert.deepEqual(results.map(({response}) => response.status).sort(),[200,409]);
  const stillSpectator = results.find(({response}) => response.status === 409) ? observers[results.findIndex(({response}) => response.status === 409)] : null;
  await post(running.base,"/api/room-settings",{roomCode:host.roomCode,hostId:host.clientId,resumeToken:host.resumeToken,allowSpectators:false});
  await close(running);running = await launch({roomStore:createSqliteRoomStore({filename})});
  const resumed = (await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:stillSpectator.clientId,resumeToken:stillSpectator.resumeToken})).payload;
  assert.equal(resumed.memberRole,"spectator");
  assert.equal(resumed.view.allowSpectators,false);
});

test("game2 page uses shared spectator UI and distinguishes room role from team seat",() => {
  const html = fs.readFileSync(path.join(__dirname,"index.html"),"utf8");
  const script = fs.readFileSync(path.join(__dirname,"app.js"),"utf8");
  assert.match(html,/name="joinIntent" value="spectate"/);
  assert.match(html,/shared\/styles\/spectator\.css/);
  assert.match(html,/id="roomRoleBanner"/);
  assert.match(html,/id="spectatorList"/);
  assert.match(script,/createSpectatorUi/);
  assert.match(script,/view\.roomRole !== "spectator"/);
  assert.match(script,/旁观者不可见/);
  assert.match(script,/spectator-action-note/);
});
