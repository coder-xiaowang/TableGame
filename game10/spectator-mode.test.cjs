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
  const response = await fetch(`${base}${pathname}`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
  return { response, payload:await response.json() };
}
const auth = (session, extras = {}) => ({ roomCode:session.roomCode, playerId:session.clientId, resumeToken:session.resumeToken, ...extras });
function openEvents(base, session) {
  return new Promise((resolve,reject) => {
    const url = new URL("/api/events",base);
    for (const key of ["clientId","roomCode","resumeToken"]) url.searchParams.set(key,session[key]);
    const request = http.get(url,(response) => response.statusCode === 200 ? response.once("data",() => resolve(request)) : reject(new Error(`SSE ${response.statusCode}`)));
    request.on("error",reject);
  });
}
async function launch(options = {}) {
  const engine = await import("./server/game-engine.mjs");
  await engine.initialize();
  const store = options.roomStore || createMemoryRoomStore();
  const server = startServer({ gameRoot:__dirname, sharedRoot:path.resolve(__dirname,"../shared"), engine, protocolVersion:3, defaultPort:0, spectatorsEnabled:true, spectatorLimit:10, roomStore:store });
  await new Promise((resolve) => server.once("listening",resolve));
  return { server, store, base:`http://127.0.0.1:${server.address().port}` };
}
async function close(running, streams = []) {
  streams.forEach((stream) => stream.destroy());
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => { running.server.close(resolve); running.server.closeAllConnections?.(); });
}
async function createRoom(running, capacity = 2) {
  return (await post(running.base,"/api/rooms",{hostId:"host",name:"房主",capacity})).payload;
}

test("game10 admits voluntary, full-room and active-game spectators with public board state", async (context) => {
  const running = await launch(); const streams = [];
  context.after(() => running.server.listening && close(running,streams));
  const config = await fetch(`${running.base}/api/config`).then((response) => response.json());
  assert.equal(config.spectatorsSupported,true);
  const host = await createRoom(running,2); streams.push(await openEvents(running.base,host));
  const voluntary = (await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:"watch",name:"旁观",intent:"spectate"})).payload;
  assert.equal(voluntary.memberRole,"spectator");
  const guest = (await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:"p2",name:"二号",intent:"play"})).payload;
  streams.push(await openEvents(running.base,guest));
  const full = (await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:"full",name:"满房",intent:"play"})).payload;
  assert.equal(full.autoSpectated,true);
  assert.equal((await post(running.base,"/api/actions",auth(host,{actionId:"start",action:{type:"start"}}))).response.status,200);
  const playerView = (await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:guest.clientId,resumeToken:guest.resumeToken})).payload.view;
  const late = (await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:"late",name:"晚到",intent:"play"})).payload;
  assert.equal(late.assignmentReason,"game_in_progress");
  assert.equal(late.view.selfId,null);
  assert.deepEqual(late.view.players,playerView.players);
  assert.deepEqual(late.view.closed,playerView.closed);
  const forged = await post(running.base,"/api/actions",auth(late,{actionId:"forged",action:{type:"roll"}}));
  assert.equal(forged.response.status,403);
  assert.equal(forged.payload.code,"spectator_cannot_act");
  const seat = await post(running.base,"/api/seat",auth(late,{intent:"play"}));
  assert.equal(seat.payload.code,"seat_change_unavailable");
});

test("game10 safely changes lobby roles and serializes competition for the final player seat", async (context) => {
  const running = await launch(); context.after(() => running.server.listening && close(running));
  const host = await createRoom(running,2);
  const observers = [];
  for (const id of ["a","b"]) observers.push((await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:id,name:id,intent:"spectate"})).payload);
  assert.equal((await post(running.base,"/api/seat",auth(host,{intent:"spectate"}))).payload.code,"host_must_remain_player");
  const results = await Promise.all(observers.map((observer) => post(running.base,"/api/seat",auth(observer,{intent:"play"}))));
  assert.deepEqual(results.map(({response}) => response.status).sort(),[200,409]);
  const winner = observers[results.findIndex(({response}) => response.status === 200)];
  assert.equal((await post(running.base,"/api/seat",auth(winner,{intent:"spectate"}))).payload.memberRole,"spectator");
});

test("game10 SQLite restart restores spectator identity and room setting", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),"tablegame-game10-spectator-"));
  let running = null;
  context.after(async () => { if (running?.server.listening) await close(running); fs.rmSync(directory,{recursive:true,force:true}); });
  const filename = path.join(directory,"game10.sqlite");
  running = await launch({roomStore:createSqliteRoomStore({filename})});
  const host = await createRoom(running,2);
  const observer = (await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:"watch",name:"旁观",intent:"spectate"})).payload;
  await post(running.base,"/api/room-settings",{roomCode:host.roomCode,hostId:host.clientId,resumeToken:host.resumeToken,allowSpectators:false});
  await close(running); running = await launch({roomStore:createSqliteRoomStore({filename})});
  const resumed = (await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:observer.clientId,resumeToken:observer.resumeToken})).payload;
  assert.equal(resumed.memberRole,"spectator");
  assert.equal(resumed.view.allowSpectators,false);
});

test("game10 page consumes the shared spectator UI", () => {
  const html = fs.readFileSync(path.join(__dirname,"index.html"),"utf8");
  const script = fs.readFileSync(path.join(__dirname,"app.js"),"utf8");
  assert.match(html,/name="joinIntent" value="spectate"/);
  assert.match(html,/shared\/styles\/spectator\.css/);
  assert.match(html,/id="roomRoleBanner"/);
  assert.match(html,/id="spectatorList"/);
  assert.match(script,/createSpectatorUi/);
  assert.match(script,/spectatorUi\.render\(view\)/);
  assert.match(script,/spectator-action-note/);
});
