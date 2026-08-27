"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const test = require("node:test");
const startAuthoritativeGameServer = require("../shared/server/start-authoritative-game-server");
const {createSqliteRoomStore} = require("../shared/server/sqlite-room-store");

async function post(baseUrl,pathname,body) {
  const response = await fetch(`${baseUrl}${pathname}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  return {response,payload:await response.json()};
}
function openEvents(baseUrl,session) {
  return new Promise((resolve,reject) => {
    const url = new URL("/api/events",baseUrl);
    url.searchParams.set("clientId",session.clientId); url.searchParams.set("roomCode",session.roomCode); url.searchParams.set("resumeToken",session.resumeToken);
    const request = http.get(url,(response) => {
      if (response.statusCode !== 200) return reject(new Error(`SSE returned ${response.statusCode}`));
      response.once("data",() => resolve({request,response}));
    });
    request.on("error",reject);
  });
}
async function startServer(engine,filename) {
  const server = startAuthoritativeGameServer({gameRoot:path.resolve(__dirname),sharedRoot:path.resolve(__dirname,"../shared"),engine,protocolVersion:3,defaultPort:0,roomStore:createSqliteRoomStore({filename})});
  await new Promise((resolve) => server.once("listening",resolve));
  return {server,baseUrl:`http://127.0.0.1:${server.address().port}`};
}
async function closeServer(server) { await new Promise((resolve) => {server.close(resolve);server.closeAllConnections?.();}); }
async function action(baseUrl,session,actionId,value) {
  return post(baseUrl,"/api/actions",{roomCode:session.roomCode,playerId:session.clientId,resumeToken:session.resumeToken,actionId,action:value});
}
async function resume(baseUrl,session) {
  return post(baseUrl,"/api/join",{roomCode:session.roomCode,clientId:session.clientId,resumeToken:session.resumeToken});
}

test("game6 restores hands, a secret locked card and action deduplication from SQLite",async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),"tablegame-game6-restart-"));
  const filename = path.join(directory,"game6.sqlite");
  const engine = await import("./server/game-engine.mjs");
  let running = null;
  context.after(async () => {
    if (running?.server.listening) await closeServer(running.server);
    fs.rmSync(directory,{recursive:true,force:true});
  });
  running = await startServer(engine,filename);
  const host = (await post(running.baseUrl,"/api/rooms",{hostId:"p1",name:"甲",capacity:2})).payload;
  await openEvents(running.baseUrl,host);
  const guest = (await post(running.baseUrl,"/api/join",{roomCode:host.roomCode,clientId:"p2",name:"乙"})).payload;
  await openEvents(running.baseUrl,guest);
  assert.equal((await action(running.baseUrl,host,"persist-start",{type:"start"})).response.status,200);
  const before = (await resume(running.baseUrl,host)).payload.view;
  const card = before.players[0].hand[0];
  assert.equal((await action(running.baseUrl,host,"persist-select",{type:"selectCard",card})).response.status,200);
  await closeServer(running.server);

  running = await startServer(engine,filename);
  const config = await fetch(`${running.baseUrl}/api/config`).then((response) => response.json());
  assert.equal(config.persistence,"sqlite"); assert.equal(config.durable,true);
  const hostView = (await resume(running.baseUrl,host)).payload.view;
  const guestView = (await resume(running.baseUrl,guest)).payload.view;
  assert.equal(hostView.players[0].selectedCard,card);
  assert.equal(guestView.players[0].selectedCard,null);
  assert.ok(guestView.players[0].hand.every((item) => item === null));
  assert.ok(hostView.players.every((player) => !player.connected));
  const duplicate = await action(running.baseUrl,host,"persist-select",{type:"selectCard",card:hostView.players[0].hand.at(-1)});
  assert.equal(duplicate.response.status,200);
  assert.equal(duplicate.payload.duplicate,true);

  await closeServer(running.server);
  running = null;
  const store = createSqliteRoomStore({filename});
  const entry = store.loadRooms()[0];
  const state = engine.restoreState(entry.snapshot.state);
  state.players.forEach((player) => { player.connected = true; });
  state.players[0].selectedCard = Math.max(...state.players[0].hand);
  const guestCard = Math.max(...state.players[1].hand);
  const lowerEnding = Math.min(state.players[0].selectedCard,guestCard)-1;
  state.rows[0] = [lowerEnding];
  engine.applyAction(state,"p2",{type:"selectCard",card:guestCard},{now:Date.now()});
  assert.equal(state.phase,"revealing");
  engine.handleTimeout(state,{now:state.deadline});
  assert.equal(state.phase,"placing");
  entry.snapshot.state = engine.serializeState(state);
  entry.snapshot.version += 1;
  entry.snapshot.updatedAt = Date.now();
  store.saveRoom(entry.roomCode,entry.snapshot);
  store.close();

  running = await startServer(engine,filename);
  const inFlight = (await resume(running.baseUrl,host)).payload.view;
  assert.equal(inFlight.phase,"placing");
  assert.ok(inFlight.animation?.id);
  const animation = inFlight.animation;
  assert.equal(inFlight.rows.flat().includes(animation.card),false);
  await new Promise((resolve) => setTimeout(resolve,Math.max(0,animation.endsAt-Date.now()+120)));
  const committed = (await resume(running.baseUrl,host)).payload.view;
  assert.equal(committed.rows.flat().filter((item) => item === animation.card).length,1);
  assert.equal(committed.revealedPlays.find((play) => play.card === animation.card)?.status,"done");
});
