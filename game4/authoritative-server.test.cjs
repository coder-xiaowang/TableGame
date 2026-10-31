"use strict";

const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const startAuthoritativeGameServer = require("../shared/server/start-authoritative-game-server");

async function post(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
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
      response.setEncoding("utf8");
      const messages = [];
      let buffer = "";
      response.on("data", (chunk) => {
        buffer += chunk;
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = block.split("\n").find((line) => line.startsWith("data: "));
          if (data) messages.push(JSON.parse(data.slice(6)));
          boundary = buffer.indexOf("\n\n");
        }
      });
      response.once("data", () => resolve({ request, response, messages, session }));
    });
    request.on("error", reject);
  });
}

async function waitFor(predicate, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for server event");
}

test("HTTP权威服务掌握牌局动作并为玩家与旁观者生成不同底牌视图", async (context) => {
  const previousPort = process.env.PORT;
  process.env.PORT = "0";
  const engine = await import("./server/game-engine.mjs");
  const server = startAuthoritativeGameServer({
    gameRoot: path.resolve(__dirname), sharedRoot: path.resolve(__dirname, "../shared"),
    engine, protocolVersion: 3, defaultPort: 0, spectatorsEnabled: true
  });
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const streams = [];
  context.after(async () => {
    for (const stream of streams) stream.request.destroy();
    await new Promise((resolve) => server.close(resolve));
    if (previousPort == null) delete process.env.PORT; else process.env.PORT = previousPort;
  });

  const config = await fetch(`${baseUrl}/api/config`).then((response) => response.json());
  assert.equal(config.authorityMode, "server");
  assert.equal(config.protocolVersion, 3);

  const created = await post(baseUrl, "/api/rooms", { hostId: "host", name: "房主", capacity: 2 });
  assert.equal(created.response.status, 200);
  streams.push(await openEvents(baseUrl, created.payload));
  const joined = await post(baseUrl, "/api/join", { roomCode: created.payload.roomCode, clientId: "p2", name: "玩家2" });
  assert.equal(joined.response.status, 200);
  streams.push(await openEvents(baseUrl, joined.payload));

  const started = await post(baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode, playerId: created.payload.clientId,
    resumeToken: created.payload.resumeToken, actionId: "start-1", action: { type: "start" }
  });
  assert.equal(started.response.status, 200);

  await waitFor(() => streams.every((stream) => stream.messages.at(-1)?.payload?.view?.phase === "playing"));
  const hostView = streams[0].messages.at(-1).payload.view;
  const guestView = streams[1].messages.at(-1).payload.view;
  assert.equal(hostView.players.find((player) => player.id === "host").hole.every(Boolean), true);
  assert.equal(hostView.players.find((player) => player.id === "p2").hole.every((card) => card === null), true);
  assert.equal(guestView.players.find((player) => player.id === "p2").hole.every(Boolean), true);
  assert.equal("deck" in hostView, false);

  const spectator = await post(baseUrl, "/api/join", {
    roomCode: created.payload.roomCode, clientId: "watcher", name: "旁观者", intent: "spectate"
  });
  assert.equal(spectator.response.status, 200);
  assert.equal(spectator.payload.memberRole, "spectator");
  assert.equal(spectator.payload.view.players.every((player) => player.hole.every((card) => card === null)), true);

  const current = hostView.players[hostView.currentIndex];
  const session = current.id === "host" ? created.payload : joined.payload;
  const acted = await post(baseUrl, "/api/actions", {
    roomCode: session.roomCode, playerId: session.clientId, resumeToken: session.resumeToken,
    actionId: "first-action", action: { type: "fold" }
  });
  assert.equal(acted.response.status, 200);

  const forbidden = await post(baseUrl, "/api/actions", {
    roomCode: spectator.payload.roomCode, playerId: spectator.payload.clientId,
    resumeToken: spectator.payload.resumeToken, actionId: "spectator-action", action: { type: "fold" }
  });
  assert.equal(forbidden.response.status, 403);
  assert.equal(forbidden.payload.code, "spectator_cannot_act");
});
