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

async function closeServer(server, streams) {
  for (const stream of streams) stream.request.destroy();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  });
}

test("game8 authoritative server owns actions and sends private views", async (context) => {
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
  const streams = [];
  context.after(async () => {
    if (server.listening) await closeServer(server, streams);
  });

  const config = await fetch(`${baseUrl}/api/config`).then((response) => response.json());
  assert.equal(config.authorityMode, "server");
  assert.equal(config.protocolVersion, 3);
  const page = await fetch(`${baseUrl}/`);
  assert.equal(page.status, 200);
  const cardImage = await fetch(`${baseUrl}/assets/cards/s1_01.webp`);
  assert.equal(cardImage.status, 200);
  assert.equal(cardImage.headers.get("content-type"), "image/webp");

  const created = await post(baseUrl, "/api/rooms", {
    hostId: "host", name: "Host", capacity: 2
  });
  assert.equal(created.response.status, 200);
  streams.push(await openEvents(baseUrl, created.payload));
  const joined = await post(baseUrl, "/api/join", {
    roomCode: created.payload.roomCode,
    clientId: "p2",
    name: "Player 2"
  });
  assert.equal(joined.response.status, 200);
  streams.push(await openEvents(baseUrl, joined.payload));

  const started = await post(baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode,
    playerId: created.payload.clientId,
    resumeToken: created.payload.resumeToken,
    actionId: "start-game8",
    action: { type: "start" }
  });
  assert.equal(started.response.status, 200);

  const latest = await post(baseUrl, "/api/join", {
    roomCode: created.payload.roomCode,
    clientId: created.payload.clientId,
    resumeToken: created.payload.resumeToken
  });
  const actorId = latest.payload.view.players[latest.payload.view.game.turn].id;
  const actor = actorId === "host" ? created.payload : joined.payload;
  const nonActor = actorId === "host" ? joined.payload : created.payload;
  const cardId = latest.payload.view.game.field.stage1.find(Boolean);
  const reserved = await post(baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode,
    playerId: actor.clientId,
    resumeToken: actor.resumeToken,
    actionId: "reserve-game8",
    action: { type: "reserve", target: { fromField: cardId } }
  });
  assert.equal(reserved.response.status, 200);

  const own = await post(baseUrl, "/api/join", {
    roomCode: created.payload.roomCode,
    clientId: actor.clientId,
    resumeToken: actor.resumeToken
  });
  const other = await post(baseUrl, "/api/join", {
    roomCode: created.payload.roomCode,
    clientId: nonActor.clientId,
    resumeToken: nonActor.resumeToken
  });
  const actorSeat = own.payload.view.game.turn;
  assert.equal(own.payload.view.game.players[actorSeat].reserve[0], cardId);
  assert.equal(other.payload.view.game.players[actorSeat].reserve[0].hidden, true);
  assert.ok(other.payload.view.game.decks.stage1.every((card) => card === null));

  const unauthorized = await post(baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode,
    playerId: nonActor.clientId,
    resumeToken: nonActor.resumeToken,
    actionId: "wrong-turn-game8",
    action: { type: "endTurn" }
  });
  assert.equal(unauthorized.response.status, 409);
});
