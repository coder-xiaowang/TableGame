"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const startServer = require("../shared/server/start-authoritative-game-server");

async function post(base, pathname, body) {
  const response = await fetch(`${base}${pathname}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { response, payload: await response.json() };
}

function events(base, session) {
  return new Promise((resolve, reject) => {
    const url = new URL("/api/events", base);
    url.searchParams.set("clientId", session.clientId);
    url.searchParams.set("roomCode", session.roomCode);
    url.searchParams.set("resumeToken", session.resumeToken);
    const request = http.get(url, (response) => response.statusCode === 200
      ? response.once("data", () => resolve({ request, response }))
      : reject(new Error(String(response.statusCode))));
    request.on("error", reject);
  });
}

async function close(server, streams) {
  for (const stream of streams) stream.request.destroy();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); });
}

const action = (session, actionId, body) => ({
  roomCode: session.roomCode,
  playerId: session.clientId,
  resumeToken: session.resumeToken,
  actionId,
  action: body
});

test("权威服务支持3人开局、满房自动旁观和秘密手牌裁剪", async (context) => {
  const engine = await import("./server/game-engine.mjs");
  const server = startServer({ gameRoot: __dirname, sharedRoot: path.resolve(__dirname, "../shared"), engine, protocolVersion: 3, defaultPort: 0, spectatorsEnabled: true });
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const streams = [];
  context.after(async () => { if (server.listening) await close(server, streams); });

  const page = await fetch(base).then((response) => response.text());
  assert.match(page, /犯人在跳舞/);
  assert.match(page, /id="controlDock" class="center-action"/);
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  assert.equal((await fetch(`${base}/api/ready`)).status, 200);
  const config = await fetch(`${base}/api/config`).then((response) => response.json());
  assert.equal(config.authorityMode, "server");
  assert.equal(config.actionSeconds, 45);
  assert.equal(config.spectatorsSupported, true);

  const host = (await post(base, "/api/rooms", { hostId: "p1", name: "甲", capacity: 3 })).payload;
  const p2 = (await post(base, "/api/join", { roomCode: host.roomCode, clientId: "p2", name: "乙" })).payload;
  const p3 = (await post(base, "/api/join", { roomCode: host.roomCode, clientId: "p3", name: "丙" })).payload;
  const watcher = (await post(base, "/api/join", { roomCode: host.roomCode, clientId: "watch", name: "旁观", intent: "play" })).payload;
  assert.equal(watcher.memberRole, "spectator");
  assert.equal(watcher.autoSpectated, true);

  streams.push(await events(base, host), await events(base, p2), await events(base, p3));
  const started = await post(base, "/api/actions", action(host, "start", { type: "start" }));
  assert.equal(started.response.status, 200);
  const duplicate = await post(base, "/api/actions", action(host, "start", { type: "start" }));
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.payload.duplicate, true);

  const hostView = (await post(base, "/api/join", { roomCode: host.roomCode, clientId: host.clientId, resumeToken: host.resumeToken })).payload.view;
  const watched = (await post(base, "/api/join", { roomCode: host.roomCode, clientId: watcher.clientId, resumeToken: watcher.resumeToken })).payload.view;
  assert.equal(hostView.players.find((player) => player.id === host.clientId).hand.length, 4);
  assert.ok(hostView.players.find((player) => player.id === host.clientId).hand.every((card) => card.type));
  assert.ok(hostView.players.filter((player) => player.id !== host.clientId).every((player) => player.hand.every((card) => card.type === null)));
  assert.equal(watched.selfId, null);
  assert.ok(watched.players.every((player) => player.hand.every((card) => card.type === null)));
  assert.equal(watched.pending.actorId, hostView.pending.actorId);

  const forged = await post(base, "/api/actions", action(watcher, "forged", { type: "playCard", cardId: "anything" }));
  assert.equal(forged.response.status, 403);
  assert.equal(forged.payload.code, "spectator_cannot_act");
});
