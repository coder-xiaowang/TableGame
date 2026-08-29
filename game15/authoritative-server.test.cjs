"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const startServer = require("../shared/server/start-authoritative-game-server");

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
      response.once("data", () => resolve({ request, response }));
    });
    request.on("error", reject);
  });
}

async function close(server) {
  await new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); });
}

async function action(base, session, id, value) {
  return post(base, "/api/actions", {
    roomCode: session.roomCode, playerId: session.clientId, resumeToken: session.resumeToken, actionId: id, action: value
  });
}

async function resume(base, session) {
  return post(base, "/api/join", { roomCode: session.roomCode, clientId: session.clientId, resumeToken: session.resumeToken });
}

test("game15 HTTP server owns turns, hides racks and serves the transactional editor", async (context) => {
  const engine = await import("./server/game-engine.mjs");
  const server = startServer({
    gameRoot: path.resolve(__dirname), sharedRoot: path.resolve(__dirname, "../shared"),
    engine, protocolVersion: 3, defaultPort: 0
  });
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const streams = [];
  context.after(async () => {
    for (const stream of streams) stream.request.destroy();
    if (server.listening) await close(server);
  });

  const page = await fetch(base).then((response) => response.text());
  assert.match(page, /拉密/);
  assert.match(page, /id="controlDock"/);
  assert.match(page, /data-new-kind="group"/);
  const css = await fetch(`${base}/styles.css`).then((response) => response.text());
  assert.match(css, /\.control-dock\s*\{[^}]*position:\s*sticky/s);
  assert.match(css, /data-expanded="false"/);
  const app = await fetch(`${base}/app.js`).then((response) => response.text());
  assert.match(app, /type:\s*"beginEdit"/);
  assert.match(app, /type:\s*"commitLayout"/);
  const config = await fetch(`${base}/api/config`).then((response) => response.json());
  assert.equal(config.authorityMode, "server");
  assert.equal(config.actionSeconds, 90);

  const host = (await post(base, "/api/rooms", { hostId: "p1", name: "甲", capacity: 2 })).payload;
  streams.push(await events(base, host));
  const guest = (await post(base, "/api/join", { roomCode: host.roomCode, clientId: "p2", name: "乙" })).payload;
  streams.push(await events(base, guest));
  assert.equal((await action(base, host, "start", { type: "start" })).response.status, 200);

  const hostView = (await resume(base, host)).payload.view;
  const guestView = (await resume(base, guest)).payload.view;
  assert.equal(hostView.hand.length, 14);
  assert.equal(guestView.hand.length, 14);
  assert.notDeepEqual(hostView.hand.map((tile) => tile.id), guestView.hand.map((tile) => tile.id));
  assert.equal(hostView.players.some((player) => "hand" in player), false);
  assert.equal(hostView.poolCount, 78);

  const current = hostView.currentPlayerId === host.clientId ? host : guest;
  const waiting = current.clientId === host.clientId ? guest : host;
  assert.equal((await action(base, current, "edit", { type: "beginEdit" })).response.status, 200);
  const waitingView = (await resume(base, waiting)).payload.view;
  assert.equal(waitingView.turnEdited, true);
  assert.equal(waitingView.table.length, 0);
  const forged = await action(base, waiting, "forged", { type: "draw" });
  assert.equal(forged.response.status, 409);
  assert.equal(forged.payload.code, "not_your_turn");
});
