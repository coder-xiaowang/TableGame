"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const path = require("node:path");
const startServer = require("../shared/server/start-authoritative-game-server");

async function post(base, pathname, body) {
  const response = await fetch(`${base}${pathname}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { response, payload: await response.json() };
}
const action = (session, actionId, body) => ({ roomCode: session.roomCode, playerId: session.clientId, resumeToken: session.resumeToken, actionId, action: body });
function events(base, session) { return new Promise((resolve, reject) => { const url = new URL("/api/events", base); url.searchParams.set("clientId", session.clientId); url.searchParams.set("roomCode", session.roomCode); url.searchParams.set("resumeToken", session.resumeToken); const request = http.get(url, (response) => response.statusCode === 200 ? response.once("data", () => resolve(request)) : reject(new Error(String(response.statusCode)))); request.on("error", reject); }); }

test("权威服务可创建BANG房间、自动旁观并裁剪秘密信息", async (context) => {
  const engine = await import("./server/game-engine.mjs");
  const server = startServer({ gameRoot: __dirname, sharedRoot: path.resolve(__dirname, "../shared"), engine, protocolVersion: 3, defaultPort: 0, spectatorsEnabled: true });
  await new Promise((resolve) => server.once("listening", resolve));
  const streams=[]; context.after(async () => { for(const stream of streams)stream.destroy(); await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(base).then((response) => response.text());
  assert.match(page, /BANG!/);
  const config = await fetch(`${base}/api/config`).then((response) => response.json());
  assert.equal(config.authorityMode, "server");
  assert.equal(config.spectatorsSupported, true);

  const host = (await post(base, "/api/rooms", { hostId: "p1", name: "甲", capacity: 4 })).payload;
  const sessions = [host];
  for (let index = 2; index <= 4; index += 1) sessions.push((await post(base, "/api/join", { roomCode: host.roomCode, clientId: `p${index}`, name: `玩家${index}`, intent: "play" })).payload);
  const watcher = (await post(base, "/api/join", { roomCode: host.roomCode, clientId: "watch", name: "旁观", intent: "play" })).payload;
  assert.equal(watcher.memberRole, "spectator");
  for(const session of sessions)streams.push(await events(base,session));
  const started = await post(base, "/api/actions", action(host, "start-1", { type: "start" }));
  assert.equal(started.response.status, 200);
  const ownView = (await post(base, "/api/join", { roomCode: host.roomCode, clientId: host.clientId, resumeToken: host.resumeToken })).payload.view;
  const watchView = (await post(base, "/api/join", { roomCode: host.roomCode, clientId: watcher.clientId, resumeToken: watcher.resumeToken })).payload.view;
  assert.ok(ownView.players.find((player) => player.id === host.clientId).hand.every((card) => card.type));
  assert.ok(watchView.players.every((player) => player.hand.every((card) => card.type === null)));
  assert.equal(watchView.players.filter((player) => player.role !== "sheriff").every((player) => player.role === null), true);
  const forged = await post(base, "/api/actions", action(watcher, "watch-act", { type: "endTurn" }));
  assert.equal(forged.response.status, 403);
});
