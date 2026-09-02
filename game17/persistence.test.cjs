"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const startServer = require("../shared/server/start-authoritative-game-server");
const { createSqliteRoomStore } = require("../shared/server/sqlite-room-store");

async function post(base, pathname, body) { const response = await fetch(`${base}${pathname}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { response, payload: await response.json() }; }
function events(base, session) { return new Promise((resolve, reject) => { const url = new URL("/api/events", base); url.searchParams.set("clientId", session.clientId); url.searchParams.set("roomCode", session.roomCode); url.searchParams.set("resumeToken", session.resumeToken); const request = http.get(url, (response) => response.statusCode === 200 ? response.once("data", () => resolve({ request, response })) : reject(new Error(String(response.statusCode)))); request.on("error", reject); }); }
async function launch(engine, filename) { const server = startServer({ gameRoot: __dirname, sharedRoot: path.resolve(__dirname, "../shared"), engine, protocolVersion: 3, defaultPort: 0, spectatorsEnabled: true, roomStore: createSqliteRoomStore({ filename }) }); await new Promise((resolve) => server.once("listening", resolve)); return { server, base: `http://127.0.0.1:${server.address().port}` }; }
async function close(running, streams = []) { for (const stream of streams) stream.request.destroy(); await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => { running.server.close(resolve); running.server.closeAllConnections?.(); }); }
const resume = (running, session) => post(running.base, "/api/join", { roomCode: session.roomCode, clientId: session.clientId, resumeToken: session.resumeToken });

test("SQLite重启恢复内幕、供给手牌、期限和旁观视图", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tablegame-game17-")); const filename = path.join(directory, "game17.sqlite");
  const engine = await import("./server/game-engine.mjs"); let running = null; let streams = [];
  context.after(async () => { if (running?.server.listening) await close(running, streams); fs.rmSync(directory, { recursive: true, force: true }); });
  running = await launch(engine, filename);
  const host = (await post(running.base, "/api/rooms", { hostId: "p1", name: "甲", capacity: 2 })).payload;
  const p2 = (await post(running.base, "/api/join", { roomCode: host.roomCode, clientId: "p2", name: "乙" })).payload;
  const watcher = (await post(running.base, "/api/join", { roomCode: host.roomCode, clientId: "watch", name: "旁观", intent: "spectate" })).payload;
  streams = [await events(running.base, host), await events(running.base, p2)];
  await post(running.base, "/api/actions", { roomCode: host.roomCode, playerId: host.clientId, resumeToken: host.resumeToken, actionId: "start", action: { type: "start" } });
  const before = (await resume(running, host)).payload.view; await close(running, streams); streams = [];
  running = await launch(engine, filename); const after = (await resume(running, host)).payload.view; const watched = (await resume(running, watcher)).payload.view;
  assert.deepEqual(after.players.find((player) => player.id === host.clientId).privateInformation, before.players.find((player) => player.id === host.clientId).privateInformation);
  assert.deepEqual(after.supplyHand, before.supplyHand); assert.equal(after.deadline, before.deadline); assert.ok(after.players.every((player) => !player.connected));
  assert.equal(watched.roomRole, "spectator"); assert.ok(watched.players.every((player) => player.portfolio.length === 0 && player.privateInformation.length === 0));
});
