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

async function startServer(engine, filename) {
  const server = startAuthoritativeGameServer({
    gameRoot: path.resolve(__dirname),
    sharedRoot: path.resolve(__dirname, "../shared"),
    engine,
    protocolVersion: 3,
    defaultPort: 0,
    roomStore: createSqliteRoomStore({ filename })
  });
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function closeServer(server) {
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  });
}

test("game3 restores an unfinished roll and action deduplication after restart", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tablegame-game3-restart-"));
  const filename = path.join(directory, "game3.sqlite");
  const engine = await import("./server/game-engine.mjs");
  let running = null;
  context.after(async () => {
    if (running?.server.listening) await closeServer(running.server);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  running = await startServer(engine, filename);
  const created = await post(running.baseUrl, "/api/rooms", {
    hostId: "host", name: "Host", capacity: 2
  });
  const joined = await post(running.baseUrl, "/api/join", {
    roomCode: created.payload.roomCode,
    clientId: "p2",
    name: "Player 2"
  });
  const hostStream = await openEvents(running.baseUrl, created.payload);
  const guestStream = await openEvents(running.baseUrl, joined.payload);

  const actions = [
    ["persisted-game3-start", { type: "start" }],
    ["persisted-game3-roll", { type: "roll" }],
    ["persisted-game3-hold", { type: "hold", index: 0 }]
  ];
  for (const [actionId, action] of actions) {
    const result = await post(running.baseUrl, "/api/actions", {
      roomCode: created.payload.roomCode,
      playerId: created.payload.clientId,
      resumeToken: created.payload.resumeToken,
      actionId,
      action
    });
    assert.equal(result.response.status, 200);
  }
  const beforeRestart = await post(running.baseUrl, "/api/join", {
    roomCode: created.payload.roomCode,
    clientId: created.payload.clientId,
    resumeToken: created.payload.resumeToken
  });
  assert.equal(beforeRestart.payload.view.phase, "playing");
  assert.equal(beforeRestart.payload.view.rolls, 1);
  assert.equal(beforeRestart.payload.view.held[0], true);

  await closeServer(running.server);
  hostStream.request.destroy();
  guestStream.request.destroy();

  running = await startServer(engine, filename);
  const config = await fetch(`${running.baseUrl}/api/config`).then((response) => response.json());
  assert.equal(config.persistence, "sqlite");
  assert.equal(config.durable, true);

  const resumed = await post(running.baseUrl, "/api/join", {
    roomCode: created.payload.roomCode,
    clientId: created.payload.clientId,
    resumeToken: created.payload.resumeToken
  });
  assert.equal(resumed.response.status, 200);
  assert.equal(resumed.payload.resumed, true);
  assert.equal(resumed.payload.view.phase, "playing");
  assert.equal(resumed.payload.view.currentPlayerId, "host");
  assert.deepEqual(resumed.payload.view.dice, beforeRestart.payload.view.dice);
  assert.deepEqual(resumed.payload.view.held, beforeRestart.payload.view.held);
  assert.equal(resumed.payload.view.rolls, beforeRestart.payload.view.rolls);
  assert.ok(resumed.payload.view.players.every((player) => !player.connected));

  const scored = await post(running.baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode,
    playerId: created.payload.clientId,
    resumeToken: created.payload.resumeToken,
    actionId: "post-restart-game3-score",
    action: { type: "score", category: "chance" }
  });
  assert.equal(scored.response.status, 200);

  const afterScore = await post(running.baseUrl, "/api/join", {
    roomCode: created.payload.roomCode,
    clientId: created.payload.clientId,
    resumeToken: created.payload.resumeToken
  });
  assert.equal(afterScore.payload.view.currentPlayerId, "p2");
  assert.equal(afterScore.payload.view.players[0].scorecard.chance,
    beforeRestart.payload.view.dice.reduce((sum, die) => sum + die, 0));

  const duplicate = await post(running.baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode,
    playerId: created.payload.clientId,
    resumeToken: created.payload.resumeToken,
    actionId: "persisted-game3-roll",
    action: { type: "roll" }
  });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.payload.duplicate, true);
});
