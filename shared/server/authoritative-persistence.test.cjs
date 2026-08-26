"use strict";

const assert = require("node:assert/strict");
const path = require("path");
const test = require("node:test");
const startAuthoritativeGameServer = require("./start-authoritative-game-server");
const { createMemoryRoomStore } = require("./memory-room-store");

async function post(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { response, payload: await response.json() };
}

test("a failed durable write does not acknowledge or commit an action", async (context) => {
  const backing = createMemoryRoomStore();
  let rejectWrites = false;
  const store = {
    ...backing,
    kind: "test-durable",
    durable: true,
    saveRoom(roomCode, snapshot) {
      if (rejectWrites) throw new Error("simulated storage failure");
      backing.saveRoom(roomCode, snapshot);
    }
  };
  const engine = {
    ACTION_SECONDS: 30,
    createLobby({ host }) {
      return { phase: "lobby", count: 0, players: [{ ...host, isHost: true }] };
    },
    addPlayer() {
      throw new Error("not used");
    },
    removePlayer() {
      throw new Error("not used");
    },
    setPresence() {
      return false;
    },
    applyAction(state, actorId, action) {
      assert.equal(actorId, "host");
      assert.equal(action.type, "increment");
      state.count += 1;
    },
    buildView(state, viewerId) {
      return { selfId: viewerId, phase: state.phase, count: state.count };
    },
    getDeadline() {
      return 0;
    },
    handleTimeout() {
      return false;
    }
  };
  const server = startAuthoritativeGameServer({
    gameRoot: path.resolve(__dirname, "../../game9"),
    sharedRoot: path.resolve(__dirname, ".."),
    engine,
    defaultPort: 0,
    roomStore: store
  });
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(async () => {
    if (!server.listening) return;
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const created = await post(baseUrl, "/api/rooms", {
    hostId: "host", name: "Host", capacity: 3
  });
  assert.equal(created.response.status, 200);

  rejectWrites = true;
  const failed = await post(baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode,
    playerId: "host",
    resumeToken: created.payload.resumeToken,
    actionId: "increment-once",
    action: { type: "increment" }
  });
  assert.equal(failed.response.status, 500);

  rejectWrites = false;
  const retried = await post(baseUrl, "/api/actions", {
    roomCode: created.payload.roomCode,
    playerId: "host",
    resumeToken: created.payload.resumeToken,
    actionId: "increment-once",
    action: { type: "increment" }
  });
  assert.equal(retried.response.status, 200);

  const resumed = await post(baseUrl, "/api/join", {
    roomCode: created.payload.roomCode,
    clientId: "host",
    resumeToken: created.payload.resumeToken
  });
  assert.equal(resumed.payload.view.count, 1);
});
