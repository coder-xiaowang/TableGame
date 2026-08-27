"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const test = require("node:test");
const startAuthoritativeGameServer = require("../shared/server/start-authoritative-game-server");
const { createSqliteRoomStore } = require("../shared/server/sqlite-room-store");

async function post(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(body)
  });
  return { response, payload:await response.json() };
}

function openEvents(baseUrl, session) {
  return new Promise((resolve, reject) => {
    const url = new URL("/api/events", baseUrl);
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

async function startServer(engine, filename) {
  const server = startAuthoritativeGameServer({
    gameRoot:path.resolve(__dirname), sharedRoot:path.resolve(__dirname,"../shared"),
    engine, protocolVersion:3, defaultPort:0,
    roomStore:createSqliteRoomStore({filename})
  });
  await new Promise((resolve) => server.once("listening",resolve));
  return {server,baseUrl:`http://127.0.0.1:${server.address().port}`};
}

async function closeServer(server) {
  await new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); });
}

async function action(baseUrl,session,actionId,value) {
  return post(baseUrl,"/api/actions",{
    roomCode:session.roomCode, playerId:session.clientId,
    resumeToken:session.resumeToken, actionId, action:value
  });
}

async function resume(baseUrl,session) {
  return post(baseUrl,"/api/join",{
    roomCode:session.roomCode, clientId:session.clientId, resumeToken:session.resumeToken
  });
}

test("game restores private submissions and action deduplication from SQLite", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),"tablegame-game-restart-"));
  const filename = path.join(directory,"game.sqlite");
  const engine = await import("./server/game-engine.mjs");
  let running = null;
  context.after(async () => {
    if (running?.server.listening) await closeServer(running.server);
    fs.rmSync(directory,{recursive:true,force:true});
  });

  running = await startServer(engine,filename);
  const host = (await post(running.baseUrl,"/api/rooms",{hostId:"p1",name:"甲",capacity:32})).payload;
  const sessions = [host];
  await openEvents(running.baseUrl,host);
  for (const [clientId,name] of [["p2","乙"],["p3","丙"]]) {
    const joined = (await post(running.baseUrl,"/api/join",{roomCode:host.roomCode,clientId,name})).payload;
    sessions.push(joined);
    await openEvents(running.baseUrl,joined);
  }
  assert.equal((await action(running.baseUrl,host,"persist-config",{
    type:"configure",gameMode:"playerWords",playerWordMode:"trap",wordExtraMode:"forbidden"
  })).response.status,200);
  assert.equal((await action(running.baseUrl,host,"persist-start",{type:"start"})).response.status,200);
  assert.equal((await action(running.baseUrl,host,"persist-word-1",{
    type:"submitWord",word:"答案甲",trapWord:"陷阱甲",extra:"禁问甲"
  })).response.status,200);
  assert.equal((await action(running.baseUrl,sessions[1],"persist-word-2",{
    type:"submitWord",word:"答案乙",trapWord:"陷阱乙",extra:"禁问乙"
  })).response.status,200);
  await closeServer(running.server);

  running = await startServer(engine,filename);
  const config = await fetch(`${running.baseUrl}/api/config`).then((response) => response.json());
  assert.equal(config.persistence,"sqlite");
  assert.equal(config.durable,true);
  const restoredViews = [];
  for (const session of sessions) restoredViews.push((await resume(running.baseUrl,session)).payload.view);
  for (const current of restoredViews) {
    assert.equal(current.phase,"collectingWords");
    assert.deepEqual(new Set(current.submittedPlayerIds),new Set(["p1","p2"]));
    assert.equal(JSON.stringify(current).includes("答案甲"),false);
    assert.equal(JSON.stringify(current).includes("陷阱乙"),false);
  }

  const duplicate = await action(running.baseUrl,sessions[1],"persist-word-2",{
    type:"submitWord",word:"篡改答案",trapWord:"篡改陷阱",extra:"篡改规则"
  });
  assert.equal(duplicate.response.status,200);
  assert.equal(duplicate.payload.duplicate,true);
  for (const session of sessions) await openEvents(running.baseUrl,session);
  assert.equal((await action(running.baseUrl,sessions[2],"post-restart-word-3",{
    type:"submitWord",word:"答案丙",trapWord:"陷阱丙",extra:"禁问丙"
  })).response.status,200);

  const playingViews = [];
  for (const session of sessions) playingViews.push((await resume(running.baseUrl,session)).payload.view);
  for (const [index,current] of playingViews.entries()) {
    assert.equal(current.phase,"playing");
    assert.equal(current.words[index].word,null);
    assert.equal(current.words[index].trapWord,null);
    assert.ok(current.words.filter((_,wordIndex) => wordIndex !== index).every((word) => word.word && word.trapWord));
    assert.equal(JSON.stringify(current).includes("篡改答案"),false);
  }
});
