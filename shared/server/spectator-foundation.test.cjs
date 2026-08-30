"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const startServer = require("./start-authoritative-game-server");
const { createMemoryRoomStore } = require("./memory-room-store");
const { createSqliteRoomStore } = require("./sqlite-room-store");

async function post(base, pathname, body) {
  const response = await fetch(`${base}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { response, payload: await response.json() };
}

function makeEngine({ spectatorCapability = false } = {}) {
  const engine = {
    ACTION_SECONDS: 30,
    createLobby({ capacity, host }) {
      return { phase: "lobby", capacity: Number(capacity), players: [{ ...host, isHost: true }] };
    },
    addPlayer(state, player) {
      if (state.players.length >= state.capacity) {
        const error = new Error("房间人数已满。");
        error.code = "room_full";
        error.status = 409;
        throw error;
      }
      const created = { ...player, isHost: false };
      state.players.push(created);
      return created;
    },
    removePlayer() { throw new Error("not used"); },
    setPresence(state, playerId, connected) {
      const player = state.players.find((item) => item.id === playerId);
      if (!player || player.connected === connected) return false;
      player.connected = connected;
      return true;
    },
    applyAction() {},
    buildView(state, viewerId) {
      return { selfId: viewerId, phase: state.phase, players: structuredClone(state.players) };
    },
    getDeadline() { return 0; },
    handleTimeout() { return false; }
  };
  if (spectatorCapability) {
    engine.SUPPORTS_SPECTATORS = true;
    engine.buildSpectatorView = (state) => ({ phase: state.phase });
    engine.canChangeSeats = () => true;
    engine.vacateSeat = () => {};
  }
  return engine;
}

async function launch(engine, options = {}) {
  const server = startServer({
    gameRoot: path.resolve(__dirname, "../../game9"),
    sharedRoot: path.resolve(__dirname, ".."),
    engine,
    defaultPort: 0,
    ...options
  });
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function close(server) {
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  });
}

test("spectator configuration stays disabled unless the engine declares the complete capability", async (context) => {
  let running = await launch(makeEngine(), { spectatorsEnabled: true, spectatorLimit: 12 });
  context.after(async () => { if (running?.server.listening) await close(running.server); });
  let config = await fetch(`${running.base}/api/config`).then((response) => response.json());
  assert.equal(config.spectatorsSupported, false);
  assert.equal(config.spectatorsEnabled, false);
  assert.equal(config.spectatorLimit, 12);
  await close(running.server);

  running = await launch(makeEngine({ spectatorCapability: true }), { spectatorsEnabled: true, spectatorLimit: 12 });
  config = await fetch(`${running.base}/api/config`).then((response) => response.json());
  assert.equal(config.spectatorsSupported, true);
  assert.equal(config.spectatorsEnabled, true);
  assert.equal(config.spectatorLimit, 12);
});

test("new rooms persist player membership without changing legacy host and guest behavior", async (context) => {
  const store = createMemoryRoomStore();
  const running = await launch(makeEngine(), { roomStore: store });
  context.after(async () => { if (running.server.listening) await close(running.server); });
  const host = await post(running.base, "/api/rooms", { hostId: "host", name: "房主", capacity: 2 });
  assert.equal(host.payload.role, "host");
  assert.equal(host.payload.memberRole, "player");
  const guest = await post(running.base, "/api/join", {
    roomCode: host.payload.roomCode, clientId: "guest", name: "玩家"
  });
  assert.equal(guest.payload.role, "guest");
  assert.equal(guest.payload.memberRole, "player");
  const full = await post(running.base, "/api/join", {
    roomCode: host.payload.roomCode, clientId: "extra", name: "额外玩家"
  });
  assert.equal(full.response.status, 409);
  assert.equal(full.payload.code, "room_full");
  const snapshot = store.loadRooms().find((entry) => entry.roomCode === host.payload.roomCode).snapshot;
  assert.ok(snapshot.members.every((member) => member.role === "player"));
});

test("legacy snapshots infer member roles and are normalized on load", async (context) => {
  const store = createMemoryRoomStore();
  const now = Date.now();
  store.saveRoom("ABCD", {
    schemaVersion: 1,
    protocolVersion: 3,
    hostId: "host",
    members: [
      { id: "host", name: "房主", resumeToken: "host-token", connected: false, kicked: false, actionIds: [] },
      { id: "old-observer", name: "旧成员", resumeToken: "observer-token", connected: false, kicked: false, actionIds: [] }
    ],
    state: {
      phase: "lobby", capacity: 2,
      players: [{ id: "host", name: "房主", isHost: true, connected: false }]
    },
    version: 4,
    createdAt: now,
    updatedAt: now
  });
  const running = await launch(makeEngine(), { roomStore: store });
  context.after(async () => { if (running.server.listening) await close(running.server); });
  const normalized = store.loadRooms()[0].snapshot;
  assert.equal(normalized.members.find((member) => member.id === "host").role, "player");
  assert.equal(normalized.members.find((member) => member.id === "old-observer").role, "spectator");
  const resumed = await post(running.base, "/api/join", {
    roomCode: "ABCD", clientId: "host", resumeToken: "host-token"
  });
  assert.equal(resumed.response.status, 200);
  assert.equal(resumed.payload.role, "host");
  assert.equal(resumed.payload.memberRole, "player");
});

test("SQLite restart preserves the new player member role", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tablegame-spectator-foundation-"));
  const filename = path.join(directory, "rooms.sqlite");
  let running = null;
  context.after(async () => {
    if (running?.server.listening) await close(running.server);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  running = await launch(makeEngine(), { roomStore: createSqliteRoomStore({ filename }) });
  const host = await post(running.base, "/api/rooms", { hostId: "host", name: "房主", capacity: 2 });
  await close(running.server);
  running = await launch(makeEngine(), { roomStore: createSqliteRoomStore({ filename }) });
  const resumed = await post(running.base, "/api/join", {
    roomCode: host.payload.roomCode, clientId: "host", resumeToken: host.payload.resumeToken
  });
  assert.equal(resumed.response.status, 200);
  assert.equal(resumed.payload.memberRole, "player");
});

