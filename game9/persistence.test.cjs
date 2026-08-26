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

async function closeServer(server, streams = []) {
  for (const stream of streams) stream.request.destroy();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  });
}

test("game9 restores an active room and action deduplication after restart", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tablegame-game9-restart-"));
  const filename = path.join(directory, "game9.sqlite");
  const engine = await import("./server/game-engine.mjs");

  let running = null;
  context.after(async () => {
    if (running?.server.listening) await closeServer(running.server);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  running = await startServer(engine, filename);
  const created = await post(running.baseUrl, "/api/rooms", {
    hostId: "host", name: "Host", capacity: 3
  });
  const sessions = [created.payload];
  for (const id of ["p2", "p3"]) {
    const joined = await post(running.baseUrl, "/api/join", {
      roomCode: created.payload.roomCode,
      clientId: id,
      name: id
    });
    assert.equal(joined.response.status, 200);
    sessions.push(joined.payload);
  }
  const streams = [];
  for (const session of sessions) streams.push(await openEvents(running.baseUrl, session));

  const started = await post(running.baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode,
    playerId: created.payload.clientId,
    resumeToken: created.payload.resumeToken,
    actionId: "persisted-start",
    action: { type: "start" }
  });
  assert.equal(started.response.status, 200);

  const beforeRestart = await post(running.baseUrl, "/api/join", {
    roomCode: created.payload.roomCode,
    clientId: created.payload.clientId,
    resumeToken: created.payload.resumeToken
  });
  assert.equal(beforeRestart.payload.view.phase, "playing");
  await closeServer(running.server, streams);

  running = await startServer(engine, filename);

  const config = await fetch(`${running.baseUrl}/api/config`).then((response) => response.json());
  assert.equal(config.persistence, "sqlite");
  assert.equal(config.durable, true);
  const ready = await fetch(`${running.baseUrl}/api/ready`);
  assert.equal(ready.status, 200);

  const resumed = await post(running.baseUrl, "/api/join", {
    roomCode: created.payload.roomCode,
    clientId: created.payload.clientId,
    resumeToken: created.payload.resumeToken
  });
  assert.equal(resumed.response.status, 200);
  assert.equal(resumed.payload.resumed, true);
  assert.equal(resumed.payload.view.phase, "playing");
  assert.equal(resumed.payload.view.activeCard, beforeRestart.payload.view.activeCard);
  assert.equal(resumed.payload.view.deckCount, beforeRestart.payload.view.deckCount);
  assert.equal(resumed.payload.view.pot, beforeRestart.payload.view.pot);
  assert.ok(resumed.payload.view.players.every((player) => !player.connected));

  const duplicate = await post(running.baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode,
    playerId: created.payload.clientId,
    resumeToken: created.payload.resumeToken,
    actionId: "persisted-start",
    action: { type: "start" }
  });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.payload.duplicate, true);
});

test("game9 settles one overdue turn on recovery and gives the next turn a fresh deadline", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tablegame-game9-timeout-"));
  const filename = path.join(directory, "game9.sqlite");
  const engine = await import("./server/game-engine.mjs");
  const now = Date.now();
  const state = engine.createLobby({
    capacity: 3,
    host: { id: "host", name: "Host", connected: true }
  });
  engine.addPlayer(state, { id: "p2", name: "p2", connected: true }, { now });
  engine.addPlayer(state, { id: "p3", name: "p3", connected: true }, { now });
  engine.applyAction(state, "host", { type: "start" }, { now, random: () => 0.5 });
  const expiredCard = state.activeCard;
  const deckCount = state.deck.length;
  state.deadline = now - 1;
  for (const player of state.players) player.connected = false;

  const store = createSqliteRoomStore({ filename });
  store.saveRoom("TIME", {
    schemaVersion: 1,
    protocolVersion: 3,
    hostId: "host",
    members: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      resumeToken: `token-${player.id}`,
      connected: false,
      everConnected: true,
      kicked: false,
      actionIds: []
    })),
    state,
    version: 10,
    createdAt: now,
    updatedAt: now
  });
  store.close();

  let running = null;
  context.after(async () => {
    if (running?.server.listening) await closeServer(running.server);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  running = await startServer(engine, filename);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const resumed = await post(running.baseUrl, "/api/join", {
    roomCode: "TIME",
    clientId: "host",
    resumeToken: "token-host"
  });
  assert.equal(resumed.response.status, 200);
  assert.equal(resumed.payload.view.deckCount, deckCount - 1);
  assert.notEqual(resumed.payload.view.activeCard, expiredCard);
  assert.ok(resumed.payload.view.deadline > Date.now());
  assert.equal(
    resumed.payload.view.players.reduce((total, player) => total + player.cards.length, 0),
    1
  );

  await new Promise((resolve) => setTimeout(resolve, 100));
  const checkedAgain = await post(running.baseUrl, "/api/join", {
    roomCode: "TIME",
    clientId: "host",
    resumeToken: "token-host"
  });
  assert.equal(checkedAgain.payload.view.deckCount, deckCount - 1);
});
