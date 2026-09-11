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
const action = (session, actionId, body) => ({ roomCode: session.roomCode, playerId: session.clientId, resumeToken: session.resumeToken, actionId, action: body });
function events(base, session) {
  return new Promise((resolve, reject) => {
    const url = new URL("/api/events", base);
    for (const key of ["clientId", "roomCode", "resumeToken"]) url.searchParams.set(key, session[key]);
    const request = http.get(url, (response) => response.statusCode === 200 ? response.once("data", () => resolve(request)) : reject(new Error(String(response.statusCode))));
    request.on("error", reject);
  });
}

test("权威服务创建局内人房间、满房自动旁观并逐成员裁剪身份和答案", async (context) => {
  const engine = await import("./server/game-engine.mjs");
  const server = startServer({ gameRoot: __dirname, sharedRoot: path.resolve(__dirname, "../shared"), engine, protocolVersion: 3, defaultPort: 0, spectatorsEnabled: true });
  await new Promise((resolve) => server.once("listening", resolve));
  const streams = [];
  context.after(async () => {
    streams.forEach((stream) => stream.destroy());
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.match(await fetch(base).then((response) => response.text()), /局内人/);
  const config = await fetch(`${base}/api/config`).then((response) => response.json());
  assert.equal(config.authorityMode, "server");
  assert.equal(config.spectatorsSupported, true);

  const host = (await post(base, "/api/rooms", { hostId: "p1", name: "甲", capacity: 4 })).payload;
  const players = [host];
  for (let index = 2; index <= 4; index += 1) players.push((await post(base, "/api/join", { roomCode: host.roomCode, clientId: `p${index}`, name: `玩家${index}`, intent: "play" })).payload);
  const watcher = (await post(base, "/api/join", { roomCode: host.roomCode, clientId: "watch", name: "旁观", intent: "play" })).payload;
  assert.equal(watcher.memberRole, "spectator");
  for (const session of players) streams.push(await events(base, session));
  assert.equal((await post(base, "/api/actions", action(host, "start", { type: "start" }))).response.status, 200);

  const views = [];
  for (const session of players) views.push((await post(base, "/api/join", { roomCode: host.roomCode, clientId: session.clientId, resumeToken: session.resumeToken })).payload.view);
  const watchView = (await post(base, "/api/join", { roomCode: host.roomCode, clientId: watcher.clientId, resumeToken: watcher.resumeToken })).payload.view;
  assert.equal(views.filter((view) => view.secretWord).length, 2);
  assert.equal(new Set(views.filter((view) => view.secretWord).map((view) => view.secretWord.text)).size, 1);
  assert.ok(views.filter((view) => !view.secretWord).every((view) => view.privateRole === "common"));
  assert.equal(watchView.secretWord, null);
  assert.ok(watchView.players.every((player) => player.role === "master" || player.role === null));
  assert.equal((await post(base, "/api/actions", action(watcher, "forged", { type: "acknowledgeSecret" }))).response.status, 403);
});

