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
  const response = await fetch(`${baseUrl}${pathname}`,{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)
  });
  return {response,payload:await response.json()};
}

function openEvents(baseUrl,session) {
  return new Promise((resolve,reject) => {
    const url = new URL("/api/events",baseUrl);
    url.searchParams.set("clientId",session.clientId);
    url.searchParams.set("roomCode",session.roomCode);
    url.searchParams.set("resumeToken",session.resumeToken);
    const request = http.get(url,(response) => {
      if (response.statusCode !== 200) return reject(new Error(`SSE returned ${response.statusCode}`));
      response.once("data",() => resolve({request,response}));
    });
    request.on("error",reject);
  });
}

async function startServer(engine,filename) {
  const server = startAuthoritativeGameServer({
    gameRoot:path.resolve(__dirname),sharedRoot:path.resolve(__dirname,"../shared"),
    engine,protocolVersion:3,defaultPort:0,roomStore:createSqliteRoomStore({filename})
  });
  await new Promise((resolve) => server.once("listening",resolve));
  return {server,baseUrl:`http://127.0.0.1:${server.address().port}`};
}

async function closeServer(server) {
  await new Promise((resolve) => {server.close(resolve);server.closeAllConnections?.();});
}

async function action(baseUrl,session,actionId,value) {
  return post(baseUrl,"/api/actions",{
    roomCode:session.roomCode,playerId:session.clientId,resumeToken:session.resumeToken,actionId,action:value
  });
}

async function resume(baseUrl,session) {
  return post(baseUrl,"/api/join",{
    roomCode:session.roomCode,clientId:session.clientId,resumeToken:session.resumeToken
  });
}

test("game2 restores a secret idiom, description and deduplication from SQLite",async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),"tablegame-game2-restart-"));
  const filename = path.join(directory,"game2.sqlite");
  const engine = await import("./server/game-engine.mjs");
  let running = null;
  context.after(async () => {
    if (running?.server.listening) await closeServer(running.server);
    fs.rmSync(directory,{recursive:true,force:true});
  });

  running = await startServer(engine,filename);
  const host = (await post(running.baseUrl,"/api/rooms",{hostId:"p1",name:"甲",capacity:4})).payload;
  const sessions = [host];
  await openEvents(running.baseUrl,host);
  for (const [clientId,name] of [["p2","乙"],["p3","丙"],["p4","丁"]]) {
    const joined = (await post(running.baseUrl,"/api/join",{roomCode:host.roomCode,clientId,name})).payload;
    sessions.push(joined);
    await openEvents(running.baseUrl,joined);
  }
  for (const [seatIndex,sessionIndex] of [1,0,2,3].entries()) {
    assert.equal((await action(running.baseUrl,sessions[sessionIndex],`persist-sit-${sessionIndex}`,{type:"sit",seatIndex})).response.status,200);
  }
  assert.equal((await action(running.baseUrl,host,"persist-start",{type:"start"})).response.status,200);
  const captainView = (await resume(running.baseUrl,sessions[1])).payload.view;
  const answer = captainView.idiom;
  assert.ok(answer);
  assert.equal((await action(running.baseUrl,sessions[1],"persist-description",{type:"describe",text:"持久化描述"})).response.status,200);
  await closeServer(running.server);

  running = await startServer(engine,filename);
  const config = await fetch(`${running.baseUrl}/api/config`).then((response) => response.json());
  assert.equal(config.persistence,"sqlite");
  assert.equal(config.durable,true);
  const views = [];
  for (const session of sessions) views.push((await resume(running.baseUrl,session)).payload.view);
  assert.ok(views.every((current) => current.phase === "playing" && current.turnPhase === "guess"));
  assert.ok(views.every((current) => current.currentDescription === "持久化描述"));
  assert.ok(views.every((current) => current.players.every((player) => !player.connected)));
  assert.equal(views[0].idiom,"");
  assert.equal(views[1].idiom,answer);
  assert.equal(views[2].idiom,answer);
  assert.equal(views[3].idiom,"");
  assert.ok(views.every((current) => !("idiomDeck" in current)));

  const duplicate = await action(running.baseUrl,sessions[1],"persist-description",{type:"describe",text:"篡改描述"});
  assert.equal(duplicate.response.status,200);
  assert.equal(duplicate.payload.duplicate,true);
  // Reconnect the non-current team first: recovery must not discard the
  // persisted description or silently rotate the question.
  for (const index of [2,3,0,1]) await openEvents(running.baseUrl,sessions[index]);
  const resumedCurrent = (await resume(running.baseUrl,sessions[0])).payload.view;
  assert.equal(resumedCurrent.turnTeamIndex,0);
  assert.equal(resumedCurrent.turnPhase,"guess");
  assert.equal(resumedCurrent.currentDescription,"持久化描述");
  assert.equal((await action(running.baseUrl,sessions[0],"post-restart-guess",{type:"guess",text:answer})).response.status,200);
  const scored = (await resume(running.baseUrl,sessions[3])).payload.view;
  assert.deepEqual(scored.scores,[1,0]);
  assert.equal(scored.wordNumber,2);
  assert.equal(JSON.stringify(scored).includes("篡改描述"),false);
});
