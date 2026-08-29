"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const startServer = require("../shared/server/start-authoritative-game-server");
const { createSqliteRoomStore } = require("../shared/server/sqlite-room-store");

async function post(base, pathname, body) {
  const response = await fetch(`${base}${pathname}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
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
      response.once("data", () => resolve(request));
    });
    request.on("error", reject);
  });
}

async function launch(engine, filename) {
  const server = startServer({
    gameRoot: path.resolve(__dirname), sharedRoot: path.resolve(__dirname, "../shared"), engine,
    protocolVersion: 3, defaultPort: 0, roomStore: createSqliteRoomStore({ filename })
  });
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function close(server) {
  await new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); });
}

async function action(running, session, id, value) {
  return post(running.base, "/api/actions", {
    roomCode: session.roomCode, playerId: session.clientId, resumeToken: session.resumeToken, actionId: id, action: value
  });
}

async function resume(running, session) {
  return post(running.base, "/api/join", { roomCode: session.roomCode, clientId: session.clientId, resumeToken: session.resumeToken });
}

test("SQLite restart restores private racks, edit penalty state, deadline and deduplication", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tablegame-rummikub-"));
  const filename = path.join(directory, "game15.sqlite");
  const engine = await import("./server/game-engine.mjs");
  let running;
  const streams = [];
  context.after(async () => {
    for (const stream of streams) stream.destroy();
    if (running?.server.listening) await close(running.server);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  running = await launch(engine, filename);
  const host = (await post(running.base, "/api/rooms", { hostId: "p1", name: "甲", capacity: 2 })).payload;
  streams.push(await events(running.base, host));
  const guest = (await post(running.base, "/api/join", { roomCode: host.roomCode, clientId: "p2", name: "乙" })).payload;
  streams.push(await events(running.base, guest));
  await action(running, host, "start-once", { type: "start" });
  await action(running, host, "edit-once", { type: "beginEdit" });
  const before = (await resume(running, host)).payload.view;

  for (const stream of streams.splice(0)) stream.destroy();
  await close(running.server);
  running = await launch(engine, filename);
  const hostAfter = (await resume(running, host)).payload.view;
  const guestAfter = (await resume(running, guest)).payload.view;
  assert.deepEqual(hostAfter.hand.map((tile) => tile.id), before.hand.map((tile) => tile.id));
  assert.notDeepEqual(hostAfter.hand.map((tile) => tile.id), guestAfter.hand.map((tile) => tile.id));
  assert.equal(hostAfter.deadline, before.deadline);
  assert.equal(hostAfter.turnEdited, true);
  assert.ok(hostAfter.players.every((player) => !player.connected));

  const duplicate = await action(running, host, "edit-once", { type: "draw" });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.payload.duplicate, true);
});
