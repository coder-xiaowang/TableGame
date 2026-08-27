"use strict";

const assert = require("node:assert/strict");
const http = require("http");
const path = require("path");
const test = require("node:test");
const startAuthoritativeGameServer = require("../shared/server/start-authoritative-game-server");

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

async function closeServer(server) {
  await new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); });
}

async function action(baseUrl, session, actionId, value) {
  return post(baseUrl, "/api/actions", {
    roomCode:session.roomCode,
    playerId:session.clientId,
    resumeToken:session.resumeToken,
    actionId,
    action:value
  });
}

async function viewFor(baseUrl, session) {
  return (await post(baseUrl, "/api/join", {
    roomCode:session.roomCode,
    clientId:session.clientId,
    resumeToken:session.resumeToken
  })).payload.view;
}

test("game server owns the rules and sends every player a redacted word view", async (context) => {
  const engine = await import("./server/game-engine.mjs");
  const server = startAuthoritativeGameServer({
    gameRoot:path.resolve(__dirname),
    sharedRoot:path.resolve(__dirname, "../shared"),
    engine,
    protocolVersion:3,
    defaultPort:0
  });
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  context.after(async () => { if (server.listening) await closeServer(server); });

  const config = await fetch(`${baseUrl}/api/config`).then((response) => response.json());
  assert.equal(config.authorityMode, "server");
  assert.equal(config.protocolVersion, 3);
  assert.equal(config.actionSeconds, 0);

  const host = (await post(baseUrl, "/api/rooms", { hostId:"p1", name:"甲", capacity:32 })).payload;
  const sessions = [host];
  await openEvents(baseUrl, host);
  for (const [clientId, name] of [["p2","乙"],["p3","丙"]]) {
    const joined = (await post(baseUrl, "/api/join", { roomCode:host.roomCode, clientId, name })).payload;
    sessions.push(joined);
    await openEvents(baseUrl, joined);
  }
  assert.equal((await action(baseUrl, host, "configure", {
    type:"configure", gameMode:"library", topic:"动物"
  })).response.status, 200);
  assert.equal((await action(baseUrl, host, "start", { type:"start" })).response.status, 200);

  const views = await Promise.all(sessions.map((session) => viewFor(baseUrl, session)));
  for (const [index, current] of views.entries()) {
    assert.equal(current.phase, "playing");
    assert.equal(current.words[index].word, null);
    assert.ok(current.words.filter((_, wordIndex) => wordIndex !== index).every((word) => word.word));
    assert.equal("submittedEntries" in current, false);
  }
  assert.notDeepEqual(views[0], views[1]);

  const illegal = await action(baseUrl, sessions[1], "illegal-question", { type:"question", text:"轮到我了吗？" });
  assert.equal(illegal.response.status, 409);
  assert.equal(illegal.payload.code, "not_your_turn");
  assert.equal((await action(baseUrl, host, "question", { type:"question", text:"我是动物吗？" })).response.status, 200);
  assert.equal((await action(baseUrl, sessions[1], "answer-2", { type:"answer", answer:"yes" })).response.status, 200);
  assert.equal((await action(baseUrl, sessions[2], "answer-3", { type:"answer", answer:"maybe" })).response.status, 200);
  const answered = await viewFor(baseUrl, host);
  assert.equal(answered.currentQuestion, null);
  assert.equal(answered.log[0].answers.p2.answer, "yes");
  assert.equal(answered.log[0].answers.p3.answer, "maybe");
});
