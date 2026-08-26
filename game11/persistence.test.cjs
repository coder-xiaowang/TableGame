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
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(body)
  });
  return { response, payload:await response.json() };
}

function openEvents(baseUrl, session) {
  return new Promise((resolve, reject) => {
    const url = new URL("/api/events", baseUrl);
    url.searchParams.set("clientId", session.clientId);
    url.searchParams.set("roomCode", session.roomCode);
    url.searchParams.set("resumeToken", session.resumeToken);
    const request = http.get(url, (response) => {
      if (response.statusCode !== 200) return reject(new Error(`SSE returned ${response.statusCode}`));
      response.once("data", () => resolve({ request, response }));
    });
    request.on("error", reject);
  });
}

async function startServer(engine, filename) {
  const server = startAuthoritativeGameServer({
    gameRoot:path.resolve(__dirname),
    sharedRoot:path.resolve(__dirname,"../shared"),
    engine,
    protocolVersion:3,
    defaultPort:0,
    roomStore:createSqliteRoomStore({filename})
  });
  await new Promise((resolve) => server.once("listening",resolve));
  return {server,baseUrl:`http://127.0.0.1:${server.address().port}`};
}

async function closeServer(server) {
  await new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); });
}

async function action(baseUrl, session, actionId, value) {
  return post(baseUrl,"/api/actions",{
    roomCode:session.roomCode,
    playerId:session.clientId,
    resumeToken:session.resumeToken,
    actionId,
    action:value
  });
}

async function resume(baseUrl, session) {
  return post(baseUrl,"/api/join",{
    roomCode:session.roomCode,
    clientId:session.clientId,
    resumeToken:session.resumeToken
  });
}

test("game11 restores secret state without leaking another player's draft", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),"tablegame-game11-restart-"));
  const filename = path.join(directory,"game11.sqlite");
  const engine = await import("./server/game-engine.mjs");
  let running = null;
  context.after(async () => {
    if (running?.server.listening) await closeServer(running.server);
    fs.rmSync(directory,{recursive:true,force:true});
  });

  running = await startServer(engine,filename);
  const host = (await post(running.baseUrl,"/api/rooms",{hostId:"w1",name:"White One",capacity:4})).payload;
  const sessions = [host];
  await openEvents(running.baseUrl,host);
  for (const [clientId,name] of [["w2","White Two"],["b1","Black One"],["b2","Black Two"]]) {
    const joined = (await post(running.baseUrl,"/api/join",{roomCode:host.roomCode,clientId,name})).payload;
    sessions.push(joined);
    await openEvents(running.baseUrl,joined);
  }
  for (const [index,team] of ["white","white","black","black"].entries()) {
    assert.equal((await action(running.baseUrl,sessions[index],`persist-sit-${index}`,{type:"sit",team})).response.status,200);
  }
  assert.equal((await action(running.baseUrl,host,"persist-game11-start",{type:"start"})).response.status,200);
  assert.equal((await action(running.baseUrl,host,"persist-game11-clues",{type:"clues",clues:["alpha","bravo","charlie"]})).response.status,200);
  assert.equal((await action(running.baseUrl,sessions[1],"persist-game11-draft",{type:"guessDraft",code:[1,2,3]})).response.status,200);

  const before = await resume(running.baseUrl,sessions[1]);
  assert.equal(before.payload.view.phase,"guess");
  assert.deepEqual(before.payload.view.guessDraft,[1,2,3]);
  await closeServer(running.server);

  running = await startServer(engine,filename);
  const config = await fetch(`${running.baseUrl}/api/config`).then((response) => response.json());
  assert.equal(config.persistence,"sqlite");
  assert.equal(config.durable,true);

  const views = [];
  for (const session of sessions) views.push((await resume(running.baseUrl,session)).payload.view);
  assert.ok(views.every((current) => current.phase === "guess"));
  assert.ok(views.every((current) => current.players.every((player) => !player.connected)));
  assert.deepEqual(views[1].guessDraft,[1,2,3]);
  assert.equal(views[0].guessDraft,null);
  assert.equal(views[2].guessDraft,null);
  assert.equal(views[3].guessDraft,null);
  assert.ok(views[0].teams.white.keywords.length === 4);
  assert.deepEqual(views[0].teams.black.keywords,[]);
  assert.ok(views[2].teams.black.keywords.length === 4);
  assert.deepEqual(views[2].teams.white.keywords,[]);
  assert.equal(views[0].code,null);

  const duplicate = await action(running.baseUrl,sessions[1],"persist-game11-draft",{type:"guessDraft",code:[4,3,2]});
  assert.equal(duplicate.response.status,200);
  assert.equal(duplicate.payload.duplicate,true);

  const submitted = await action(running.baseUrl,sessions[1],"post-restart-game11-guess",{type:"guess",code:[1,2,3]});
  assert.equal(submitted.response.status,200);
  const revealed = (await resume(running.baseUrl,sessions[2])).payload.view;
  assert.equal(revealed.phase,"reveal");
  assert.ok(revealed.code?.length === 3);
  assert.deepEqual(revealed.records[0].decodeGuess,[1,2,3]);
});
