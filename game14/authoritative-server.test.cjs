"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const startServer = require("../shared/server/start-authoritative-game-server");

async function post(base, pathname, body) {
  const response = await fetch(`${base}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { response, payload: await response.json() };
}

function events(base, session) {
  return new Promise((resolve, reject) => {
    const url = new URL("/api/events", base);
    url.searchParams.set("clientId", session.clientId);
    url.searchParams.set("roomCode", session.roomCode);
    url.searchParams.set("resumeToken", session.resumeToken);
    const request = http.get(url, (response) => {
      if (response.statusCode !== 200) return reject(new Error(String(response.statusCode)));
      response.once("data", () => resolve({ request, response }));
    });
    request.on("error", reject);
  });
}

async function close(server) {
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  });
}

async function action(base, session, id, value) {
  return post(base, "/api/actions", {
    roomCode: session.roomCode,
    playerId: session.clientId,
    resumeToken: session.resumeToken,
    actionId: id,
    action: value
  });
}

async function view(base, session) {
  return (await post(base, "/api/join", {
    roomCode: session.roomCode,
    clientId: session.clientId,
    resumeToken: session.resumeToken
  })).payload.view;
}

test("game14 HTTP server supports six players, owns turns and keeps hands private", async (context) => {
  const engine = await import("./server/game-engine.mjs");
  const server = startServer({
    gameRoot: path.resolve(__dirname),
    sharedRoot: path.resolve(__dirname, "../shared"),
    engine,
    protocolVersion: 3,
    defaultPort: 0
  });
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  context.after(async () => { if (server.listening) await close(server); });

  const page = await fetch(base).then((response) => response.text());
  assert.match(page, /脏小猪/);
  assert.match(page, /id="players"/);
  const config = await fetch(`${base}/api/config`).then((response) => response.json());
  assert.equal(config.authorityMode, "server");
  assert.equal(config.actionSeconds, 30);

  const host = (await post(base, "/api/rooms", { hostId: "p1", name: "玩家1", capacity: 6 })).payload;
  await events(base, host);
  const sessions = [host];
  for (let index = 2; index <= 6; index += 1) {
    const guest = (await post(base, "/api/join", {
      roomCode: host.roomCode,
      clientId: `p${index}`,
      name: `玩家${index}`
    })).payload;
    await events(base, guest);
    sessions.push(guest);
  }
  assert.equal((await action(base, host, "start", { type: "start" })).response.status, 200);

  const hostView = await view(base, host);
  const guestView = await view(base, sessions[1]);
  assert.equal(hostView.players.length, 6);
  assert.ok(hostView.players.every((player) => player.pigs.length === 3));
  assert.equal(hostView.deckCount, 39);
  assert.equal(hostView.hand.length, 3);
  assert.equal(guestView.hand.length, 3);
  assert.notDeepEqual(hostView.hand.map((card) => card.id), guestView.hand.map((card) => card.id));
  assert.equal(JSON.stringify(hostView.players).includes("mud_"), false);

  const nonCurrent = sessions.find((session) => session.clientId !== hostView.currentPlayerId);
  const forged = await action(base, nonCurrent, "forged", { type: "discardCard", cardId: "mud_1" });
  assert.equal(forged.response.status, 409);
});
