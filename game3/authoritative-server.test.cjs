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

test("game3 authoritative server owns dice, turns and scoring", async (context) => {
  const engine = await import("./server/game-engine.mjs");
  const originalRandom = Math.random;
  Math.random = () => 0;
  const server = startAuthoritativeGameServer({
    gameRoot: path.resolve(__dirname),
    sharedRoot: path.resolve(__dirname, "../shared"),
    engine,
    protocolVersion: 3,
    defaultPort: 0
  });
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  context.after(async () => {
    Math.random = originalRandom;
    if (server.listening) await closeServer(server);
  });

  const config = await fetch(`${baseUrl}/api/config`).then((response) => response.json());
  assert.equal(config.authorityMode, "server");
  assert.equal(config.protocolVersion, 3);
  assert.equal((await fetch(`${baseUrl}/`)).status, 200);

  const created = await post(baseUrl, "/api/rooms", {
    hostId: "host", name: "Host", capacity: 2
  });
  const hostStream = await openEvents(baseUrl, created.payload);
  const joined = await post(baseUrl, "/api/join", {
    roomCode: created.payload.roomCode,
    clientId: "p2",
    name: "Player 2"
  });
  const guestStream = await openEvents(baseUrl, joined.payload);
  assert.equal(created.response.status, 200);
  assert.equal(joined.response.status, 200);

  const started = await post(baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode,
    playerId: created.payload.clientId,
    resumeToken: created.payload.resumeToken,
    actionId: "game3-start",
    action: { type: "start" }
  });
  assert.equal(started.response.status, 200);

  const wrongTurn = await post(baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode,
    playerId: joined.payload.clientId,
    resumeToken: joined.payload.resumeToken,
    actionId: "game3-wrong-turn",
    action: { type: "roll" }
  });
  assert.equal(wrongTurn.response.status, 409);

  const rolled = await post(baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode,
    playerId: created.payload.clientId,
    resumeToken: created.payload.resumeToken,
    actionId: "game3-roll",
    action: { type: "roll" }
  });
  assert.equal(rolled.response.status, 200);

  const held = await post(baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode,
    playerId: created.payload.clientId,
    resumeToken: created.payload.resumeToken,
    actionId: "game3-hold",
    action: { type: "hold", index: 0 }
  });
  assert.equal(held.response.status, 200);

  const hostView = await post(baseUrl, "/api/join", {
    roomCode: created.payload.roomCode,
    clientId: created.payload.clientId,
    resumeToken: created.payload.resumeToken
  });
  const guestView = await post(baseUrl, "/api/join", {
    roomCode: created.payload.roomCode,
    clientId: joined.payload.clientId,
    resumeToken: joined.payload.resumeToken
  });
  assert.deepEqual(hostView.payload.view.dice, [1, 1, 1, 1, 1]);
  assert.deepEqual(guestView.payload.view.dice, hostView.payload.view.dice);
  assert.equal(hostView.payload.view.held[0], true);
  assert.equal(hostView.payload.view.rolls, 1);

  const scored = await post(baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode,
    playerId: created.payload.clientId,
    resumeToken: created.payload.resumeToken,
    actionId: "game3-score",
    action: { type: "score", category: "chance" }
  });
  assert.equal(scored.response.status, 200);
  const afterScore = await post(baseUrl, "/api/join", {
    roomCode: created.payload.roomCode,
    clientId: created.payload.clientId,
    resumeToken: created.payload.resumeToken
  });
  assert.equal(afterScore.payload.view.players[0].scorecard.chance, 5);
  assert.equal(afterScore.payload.view.currentPlayerId, "p2");

  hostStream.request.destroy();
  guestStream.request.destroy();
});
