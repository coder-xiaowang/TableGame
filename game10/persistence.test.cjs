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

async function waitForStage(baseUrl, session, stage, timeoutMs = 7000) {
  const expiresAt = Date.now() + timeoutMs;
  while (Date.now() < expiresAt) {
    const result = await post(baseUrl, "/api/join", {
      roomCode: session.roomCode,
      clientId: session.clientId,
      resumeToken: session.resumeToken
    });
    if (result.payload.view?.turnStage === stage) return result.payload.view;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Timed out waiting for stage ${stage}`);
}

test("game10 restores a chosen climb and action deduplication after restart", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tablegame-game10-restart-"));
  const filename = path.join(directory, "game10.sqlite");
  const engine = await import("./server/game-engine.mjs");
  await engine.initialize();
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
  await openEvents(running.baseUrl, created.payload);
  await openEvents(running.baseUrl, joined.payload);

  const started = await post(running.baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode,
    playerId: created.payload.clientId,
    resumeToken: created.payload.resumeToken,
    actionId: "persisted-game10-start",
    action: { type: "start" }
  });
  assert.equal(started.response.status, 200);
  const startView = await post(running.baseUrl, "/api/join", {
    roomCode: created.payload.roomCode,
    clientId: created.payload.clientId,
    resumeToken: created.payload.resumeToken
  });
  const sessions = [created.payload, joined.payload];
  const actorId = startView.payload.view.players[startView.payload.view.currentIndex].id;
  const actor = sessions.find((session) => session.clientId === actorId);

  const rolled = await post(running.baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode,
    playerId: actor.clientId,
    resumeToken: actor.resumeToken,
    actionId: "persisted-game10-roll",
    action: { type: "roll" }
  });
  assert.equal(rolled.response.status, 200);
  const chooseView = await waitForStage(running.baseUrl, actor, "choose");
  assert.ok(chooseView.options.length > 0);
  const option = chooseView.options[0];

  const chosen = await post(running.baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode,
    playerId: actor.clientId,
    resumeToken: actor.resumeToken,
    actionId: "persisted-game10-choose",
    action: { type: "choose", key: option.key }
  });
  assert.equal(chosen.response.status, 200);
  const beforeRestart = await post(running.baseUrl, "/api/join", {
    roomCode: created.payload.roomCode,
    clientId: actor.clientId,
    resumeToken: actor.resumeToken
  });
  assert.equal(beforeRestart.payload.view.turnStage, "decision");
  assert.ok(Object.keys(beforeRestart.payload.view.turnProgress).length > 0);
  await closeServer(running.server);

  running = await startServer(engine, filename);
  const config = await fetch(`${running.baseUrl}/api/config`).then((response) => response.json());
  assert.equal(config.persistence, "sqlite");
  assert.equal(config.durable, true);

  const resumed = await post(running.baseUrl, "/api/join", {
    roomCode: created.payload.roomCode,
    clientId: actor.clientId,
    resumeToken: actor.resumeToken
  });
  assert.equal(resumed.response.status, 200);
  assert.equal(resumed.payload.resumed, true);
  assert.equal(resumed.payload.view.phase, "playing");
  assert.equal(resumed.payload.view.turnStage, "decision");
  assert.equal(resumed.payload.view.players[resumed.payload.view.currentIndex].id, actorId);
  assert.deepEqual(resumed.payload.view.turnProgress, beforeRestart.payload.view.turnProgress);
  assert.ok(resumed.payload.view.players.every((player) => !player.connected));

  const camped = await post(running.baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode,
    playerId: actor.clientId,
    resumeToken: actor.resumeToken,
    actionId: "post-restart-game10-stop",
    action: { type: "stop" }
  });
  assert.equal(camped.response.status, 200);
  const afterCamp = await post(running.baseUrl, "/api/join", {
    roomCode: created.payload.roomCode,
    clientId: actor.clientId,
    resumeToken: actor.resumeToken
  });
  const actorPlayer = afterCamp.payload.view.players.find((player) => player.id === actorId);
  assert.deepEqual(actorPlayer.progress, beforeRestart.payload.view.turnProgress);
  assert.notEqual(afterCamp.payload.view.players[afterCamp.payload.view.currentIndex].id, actorId);

  const duplicate = await post(running.baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode,
    playerId: actor.clientId,
    resumeToken: actor.resumeToken,
    actionId: "persisted-game10-choose",
    action: { type: "choose", key: option.key }
  });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.payload.duplicate, true);
});
