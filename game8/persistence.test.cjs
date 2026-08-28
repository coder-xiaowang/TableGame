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

test("game8 restores a playable room and deduplication after restart", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tablegame-game8-restart-"));
  const filename = path.join(directory, "game8.sqlite");
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
  const sessions = [created.payload, joined.payload];
  const streams = [];
  for (const session of sessions) streams.push(await openEvents(running.baseUrl, session));

  const started = await post(running.baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode,
    playerId: created.payload.clientId,
    resumeToken: created.payload.resumeToken,
    actionId: "persisted-game8-start",
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

  const inspectionStore = createSqliteRoomStore({ filename });
  const persistedGame = inspectionStore.loadRooms()[0].snapshot.state.game;
  assert.equal("cardDB" in persistedGame, false);
  assert.equal("byId" in persistedGame, false);
  inspectionStore.close();

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
  assert.equal(resumed.payload.view.game.seed, beforeRestart.payload.view.game.seed);
  assert.equal(resumed.payload.view.game.turn, beforeRestart.payload.view.game.turn);
  assert.deepEqual(resumed.payload.view.game.field, beforeRestart.payload.view.game.field);
  assert.ok(resumed.payload.view.players.every((player) => !player.connected));

  const actorId = resumed.payload.view.players[resumed.payload.view.game.turn].id;
  const actor = sessions.find((session) => session.clientId === actorId);
  const cardId = resumed.payload.view.game.field.stage1.find(Boolean);
  const acted = await post(running.baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode,
    playerId: actor.clientId,
    resumeToken: actor.resumeToken,
    actionId: "post-restart-reserve",
    action: { type: "reserve", target: { fromField: cardId } }
  });
  assert.equal(acted.response.status, 200);

  const actorView = await post(running.baseUrl, "/api/join", {
    roomCode: created.payload.roomCode,
    clientId: actor.clientId,
    resumeToken: actor.resumeToken
  });
  assert.equal(actorView.payload.view.game.players[resumed.payload.view.game.turn].reserve[0], cardId);

  await closeServer(running.server);
  running = await startServer(engine, filename);
  const observer = sessions.find((session) => session.clientId !== actor.clientId);
  const observerView = await post(running.baseUrl, "/api/join", {
    roomCode: created.payload.roomCode,
    clientId: observer.clientId,
    resumeToken: observer.resumeToken
  });
  assert.equal(observerView.payload.view.game.players[resumed.payload.view.game.turn].reserve[0], cardId);

  const duplicate = await post(running.baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode,
    playerId: created.payload.clientId,
    resumeToken: created.payload.resumeToken,
    actionId: "persisted-game8-start",
    action: { type: "start" }
  });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.payload.duplicate, true);
});
