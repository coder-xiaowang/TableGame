"use strict";

const assert = require("node:assert/strict");
const http = require("http");
const path = require("path");
const test = require("node:test");
const startAuthoritativeGameServer = require("../shared/server/start-authoritative-game-server");

async function post(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { response, payload: await response.json() };
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

async function closeServer(server) {
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  });
}

async function action(baseUrl, session, actionId, value) {
  return post(baseUrl, "/api/actions", {
    roomCode: session.roomCode,
    playerId: session.clientId,
    resumeToken: session.resumeToken,
    actionId,
    action: value
  });
}

async function viewFor(baseUrl, session) {
  const result = await post(baseUrl, "/api/join", {
    roomCode: session.roomCode,
    clientId: session.clientId,
    resumeToken: session.resumeToken
  });
  return result.payload.view;
}

async function createFourPlayerRoom(baseUrl) {
  const host = (await post(baseUrl, "/api/rooms", { hostId:"w1", name:"White One", capacity:4 })).payload;
  const sessions = [host];
  await openEvents(baseUrl, host);
  for (const [clientId, name] of [["w2","White Two"],["b1","Black One"],["b2","Black Two"]]) {
    const joined = (await post(baseUrl, "/api/join", { roomCode:host.roomCode, clientId, name })).payload;
    sessions.push(joined);
    await openEvents(baseUrl, joined);
  }
  for (const [index, team] of ["white","white","black","black"].entries()) {
    const seated = await action(baseUrl, sessions[index], `sit-${sessions[index].clientId}`, { type:"sit", team });
    assert.equal(seated.response.status, 200);
  }
  return sessions;
}

test("game11 server sends a separately redacted view to every player", async (context) => {
  const engine = await import("./server/game-engine.mjs");
  const server = startAuthoritativeGameServer({
    gameRoot: path.resolve(__dirname),
    sharedRoot: path.resolve(__dirname, "../shared"),
    engine,
    protocolVersion: 3,
    defaultPort: 0
  });
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  context.after(async () => { if (server.listening) await closeServer(server); });

  const config = await fetch(`${baseUrl}/api/config`).then((response) => response.json());
  assert.equal(config.authorityMode, "server");
  assert.equal(config.protocolVersion, 3);
  assert.equal(config.actionSeconds, 150);

  const sessions = await createFourPlayerRoom(baseUrl);
  const started = await action(baseUrl, sessions[0], "game11-start", { type:"start" });
  assert.equal(started.response.status, 200);
  const [w1View,w2View,b1View,b2View] = await Promise.all(sessions.map((session) => viewFor(baseUrl, session)));

  assert.equal(w1View.encryptorId, "w1");
  assert.ok(w1View.code?.length === 3);
  assert.equal(w2View.code, null);
  assert.equal(b1View.code, null);
  assert.equal(b2View.code, null);
  assert.ok(w1View.teams.white.keywords.length === 4);
  assert.ok(w2View.teams.white.keywords.length === 4);
  assert.deepEqual(w1View.teams.black.keywords, []);
  assert.ok(b1View.teams.black.keywords.length === 4);
  assert.ok(b2View.teams.black.keywords.length === 4);
  assert.deepEqual(b1View.teams.white.keywords, []);
  assert.notDeepEqual(w1View, w2View);
  assert.notDeepEqual(w2View, b1View);
  assert.notDeepEqual(b1View, b2View);
  for (const current of [w1View,w2View,b1View,b2View]) {
    for (const secret of ["codeDeck","guesses","guessDrafts","tiebreakGuesses"]) {
      assert.equal(secret in current, false);
    }
  }

  const forbiddenClues = await action(baseUrl, sessions[2], "wrong-clues", { type:"clues", clues:["alpha","bravo","charlie"] });
  assert.equal(forbiddenClues.response.status, 409);
  const clues = await action(baseUrl, sessions[0], "game11-clues", { type:"clues", clues:["alpha","bravo","charlie"] });
  assert.equal(clues.response.status, 200);
  const draft = await action(baseUrl, sessions[1], "game11-draft", { type:"guessDraft", code:[1,2,3] });
  assert.equal(draft.response.status, 200);

  const draftViews = await Promise.all(sessions.map((session) => viewFor(baseUrl, session)));
  assert.deepEqual(draftViews[1].guessDraft, [1,2,3]);
  assert.equal(draftViews[0].guessDraft, null);
  assert.equal(draftViews[2].guessDraft, null);
  assert.equal(draftViews[3].guessDraft, null);
  assert.equal(draftViews[1].permissions.guessRole, "decode");
  assert.equal(draftViews[0].permissions.guessRole, null);
});
