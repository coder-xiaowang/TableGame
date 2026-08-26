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

test("game10 authoritative server owns physical dice and turn permissions", async (context) => {
  const engine = await import("./server/game-engine.mjs");
  await engine.initialize();
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
    if (server.listening) await closeServer(server);
  });

  const config = await fetch(`${baseUrl}/api/config`).then((response) => response.json());
  assert.equal(config.authorityMode, "server");
  assert.equal(config.protocolVersion, 3);
  assert.equal(config.actionSeconds, 30);
  assert.equal((await fetch(`${baseUrl}/vendor/rapier3d-compat.mjs`)).status, 200);

  const created = await post(baseUrl, "/api/rooms", {
    hostId: "host", name: "Host", capacity: 2
  });
  await openEvents(baseUrl, created.payload);
  const joined = await post(baseUrl, "/api/join", {
    roomCode: created.payload.roomCode,
    clientId: "p2",
    name: "Player 2"
  });
  await openEvents(baseUrl, joined.payload);
  assert.equal(created.response.status, 200);
  assert.equal(joined.response.status, 200);

  const started = await post(baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode,
    playerId: created.payload.clientId,
    resumeToken: created.payload.resumeToken,
    actionId: "game10-start",
    action: { type: "start" }
  });
  assert.equal(started.response.status, 200);

  const latest = await post(baseUrl, "/api/join", {
    roomCode: created.payload.roomCode,
    clientId: created.payload.clientId,
    resumeToken: created.payload.resumeToken
  });
  const sessions = [created.payload, joined.payload];
  const actor = sessions.find((session) => session.clientId === latest.payload.view.players[latest.payload.view.currentIndex].id);
  const nonActor = sessions.find((session) => session.clientId !== actor.clientId);

  const unauthorized = await post(baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode,
    playerId: nonActor.clientId,
    resumeToken: nonActor.resumeToken,
    actionId: "game10-wrong-turn",
    action: { type: "roll" }
  });
  assert.equal(unauthorized.response.status, 409);

  const rolled = await post(baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode,
    playerId: actor.clientId,
    resumeToken: actor.resumeToken,
    actionId: "game10-roll",
    action: { type: "roll" }
  });
  assert.equal(rolled.response.status, 200);

  const actorView = await post(baseUrl, "/api/join", {
    roomCode: created.payload.roomCode,
    clientId: actor.clientId,
    resumeToken: actor.resumeToken
  });
  const otherView = await post(baseUrl, "/api/join", {
    roomCode: created.payload.roomCode,
    clientId: nonActor.clientId,
    resumeToken: nonActor.resumeToken
  });
  assert.equal(actorView.payload.view.turnStage, "rolling");
  assert.ok(actorView.payload.view.physicsSeed > 0);
  assert.ok(actorView.payload.view.revealAt > Date.now());
  assert.equal("pendingDice" in actorView.payload.view, false);
  assert.equal(otherView.payload.view.physicsSeed, actorView.payload.view.physicsSeed);
  assert.equal(otherView.payload.view.revealAt, actorView.payload.view.revealAt);
  assert.deepEqual(otherView.payload.view.players, actorView.payload.view.players);
  assert.deepEqual(otherView.payload.view.turnProgress, actorView.payload.view.turnProgress);
  assert.equal(otherView.payload.view.permissions.canManage, nonActor.clientId === "host");
});
