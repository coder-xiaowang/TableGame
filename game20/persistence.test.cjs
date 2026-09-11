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
async function launch(engine, filename) { const server = startServer({ gameRoot: __dirname, sharedRoot: path.resolve(__dirname, "../shared"), engine, protocolVersion: 3, defaultPort: 0, spectatorsEnabled: true, roomStore: createSqliteRoomStore({ filename }) }); await new Promise((resolve) => server.once("listening", resolve)); return { server, base: `http://127.0.0.1:${server.address().port}` }; }
async function close(running, streams = []) { streams.forEach((stream) => stream.destroy()); await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => { running.server.close(resolve); running.server.closeAllConnections?.(); }); }
const resume = (running, session) => post(running.base, "/api/join", { roomCode: session.roomCode, clientId: session.clientId, resumeToken: session.resumeToken });
function events(base, session) { return new Promise((resolve, reject) => { const url = new URL("/api/events", base); for (const key of ["clientId", "roomCode", "resumeToken"]) url.searchParams.set(key, session[key]); const request = http.get(url, (response) => response.statusCode === 200 ? response.once("data", () => resolve(request)) : reject(new Error(String(response.statusCode)))); request.on("error", reject); }); }

test("SQLite重启恢复秘密身份、答案、阶段、截止时间和旁观边界", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tablegame-game20-"));
  const filename = path.join(directory, "game20.sqlite");
  const engine = await import("./server/game-engine.mjs");
  let running;
  let streams = [];
  context.after(async () => { if (running?.server.listening) await close(running); fs.rmSync(directory, { recursive: true, force: true }); });
  running = await launch(engine, filename);
  const host = (await post(running.base, "/api/rooms", { hostId: "p1", name: "甲", capacity: 4 })).payload;
  const players = [host];
  for (let index = 2; index <= 4; index += 1) players.push((await post(running.base, "/api/join", { roomCode: host.roomCode, clientId: `p${index}`, name: `玩家${index}` })).payload);
  const watcher = (await post(running.base, "/api/join", { roomCode: host.roomCode, clientId: "watch", name: "旁观", intent: "spectate" })).payload;
  for (const session of players) streams.push(await events(running.base, session));
  await post(running.base, "/api/actions", { roomCode: host.roomCode, playerId: host.clientId, resumeToken: host.resumeToken, actionId: "start", action: { type: "start" } });
  const beforeViews = await Promise.all(players.map(async (session) => (await resume(running, session)).payload.view));
  const privilegedBefore = beforeViews.find((view) => view.secretWord);
  await close(running, streams); streams = [];

  running = await launch(engine, filename);
  const after = (await resume(running, players.find((session) => session.clientId === privilegedBefore.selfId))).payload.view;
  const watched = (await resume(running, watcher)).payload.view;
  assert.equal(after.phase, privilegedBefore.phase);
  assert.equal(after.deadline, privilegedBefore.deadline);
  assert.equal(after.privateRole, privilegedBefore.privateRole);
  assert.equal(after.secretWord.text, privilegedBefore.secretWord.text);
  assert.ok(after.players.every((player) => !player.connected));
  assert.equal(watched.roomRole, "spectator");
  assert.equal(watched.secretWord, null);
  assert.ok(watched.players.every((player) => player.role === "master" || player.role === null));
});

