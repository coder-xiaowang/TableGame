"use strict";

const http = require("http");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const startAuthoritativeGameServer = require("../shared/server/start-authoritative-game-server");

async function post(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  return { response, payload };
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

async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for server event");
}

test("authoritative server owns room state, actions and private views", async (context) => {
  const previousPort = process.env.PORT;
  process.env.PORT = "0";
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
    for (const stream of streams) stream.request.destroy();
    await new Promise((resolve) => server.close(resolve));
    if (previousPort == null) delete process.env.PORT;
    else process.env.PORT = previousPort;
  });

  const configResponse = await fetch(`${baseUrl}/api/config`);
  const config = await configResponse.json();
  assert.equal(config.authorityMode, "server");
  assert.equal(config.protocolVersion, 3);

  const created = await post(baseUrl, "/api/rooms", {
    hostId: "host", name: "房主", capacity: 3
  });
  assert.equal(created.response.status, 200);
  assert.equal(created.payload.view.phase, "lobby");
  streams.push(await openEvents(baseUrl, created.payload));

  const players = [];
  for (const id of ["p2", "p3"]) {
    const joined = await post(baseUrl, "/api/join", {
      roomCode: created.payload.roomCode,
      clientId: id,
      name: id
    });
    assert.equal(joined.response.status, 200);
    players.push(joined.payload);
    streams.push(await openEvents(baseUrl, joined.payload));
  }

  const started = await post(baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode,
    playerId: created.payload.clientId,
    resumeToken: created.payload.resumeToken,
    actionId: "start-1",
    action: { type: "start" }
  });
  assert.equal(started.response.status, 200);

  const currentStream = await waitFor(() => streams.find((stream) => {
    const view = stream.messages.at(-1)?.payload?.view;
    return view?.phase === "playing" && view.players[view.currentIndex]?.id === stream.session.clientId;
  }));
  const acted = await post(baseUrl, "/api/actions", {
    roomCode: currentStream.session.roomCode,
    playerId: currentStream.session.clientId,
    resumeToken: currentStream.session.resumeToken,
    actionId: "take-1",
    action: { type: "take" }
  });
  assert.equal(acted.response.status, 200);

  const duplicate = await post(baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode,
    playerId: created.payload.clientId,
    resumeToken: created.payload.resumeToken,
    actionId: "start-1",
    action: { type: "start" }
  });
  assert.equal(duplicate.payload.duplicate, true);

  streams[0].request.destroy();
  const resumedHost = await post(baseUrl, "/api/join", {
    roomCode: created.payload.roomCode,
    clientId: created.payload.clientId,
    resumeToken: created.payload.resumeToken
  });
  assert.equal(resumedHost.response.status, 200);
  assert.equal(resumedHost.payload.resumed, true);
  assert.equal(resumedHost.payload.role, "host");
  assert.equal(resumedHost.payload.view.phase, "playing");

  const invalid = await post(baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode,
    playerId: players[0].clientId,
    resumeToken: players[0].resumeToken,
    actionId: "invalid-turn",
    action: { type: "end" }
  });
  assert.equal(invalid.response.status, 403);
  assert.equal(invalid.payload.code, "host_required");
});
