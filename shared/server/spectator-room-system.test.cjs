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

function makeSpectatorEngine() {
  const metrics = { actions: 0, removals: 0, vacates: 0, playerViews: 0, spectatorViews: 0 };
  const ruleError = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
  const engine = {
    SUPPORTS_SPECTATORS: true,
    ACTION_SECONDS: 30,
    metrics,
    createLobby({ capacity, host }) {
      return {
        phase: "lobby",
        capacity: Number(capacity),
        publicCounter: 0,
        players: [{ ...host, isHost: true, secret: `secret-${host.id}` }]
      };
    },
    addPlayer(state, player) {
      if (state.phase !== "lobby") throw ruleError("game_started", "游戏已经开始");
      if (state.players.length >= state.capacity) throw ruleError("room_full", "玩家席已满");
      const created = { ...player, isHost: false, secret: `secret-${player.id}` };
      state.players.push(created);
      return created;
    },
    removePlayer(state, actorId, playerId) {
      metrics.removals += 1;
      if (state.phase !== "lobby") throw ruleError("game_started", "游戏已经开始");
      const index = state.players.findIndex((player) => player.id === playerId && !player.isHost);
      if (index < 0) throw ruleError("invalid_player", "无法移出玩家", 400);
      state.players.splice(index, 1);
    },
    vacateSeat(state, playerId) {
      metrics.vacates += 1;
      if (state.phase !== "lobby") throw ruleError("seat_change_unavailable", "当前不能换席");
      const index = state.players.findIndex((player) => player.id === playerId && !player.isHost);
      if (index < 0) throw ruleError("invalid_player", "无法离开玩家席", 400);
      state.players.splice(index, 1);
    },
    canChangeSeats(state) { return state.phase === "lobby"; },
    setPresence(state, playerId, connected) {
      const player = state.players.find((item) => item.id === playerId);
      if (!player || player.connected === connected) return false;
      player.connected = connected;
      return true;
    },
    applyAction(state, actorId, action) {
      metrics.actions += 1;
      if (action?.type === "start") state.phase = "playing";
      else state.publicCounter += 1;
    },
    buildView(state, viewerId) {
      metrics.playerViews += 1;
      const viewer = state.players.find((player) => player.id === viewerId);
      return {
        selfId: viewerId,
        phase: state.phase,
        publicCounter: state.publicCounter,
        privateSecret: viewer?.secret,
        players: state.players.map(({ id, connected }) => ({ id, connected }))
      };
    },
    buildSpectatorView(state) {
      metrics.spectatorViews += 1;
      return {
        phase: state.phase,
        publicCounter: state.publicCounter,
        players: state.players.map(({ id, connected }) => ({ id, connected }))
      };
    },
    getDeadline() { return 0; },
    handleTimeout() { return false; }
  };
  return engine;
}

async function launch({ engine = makeSpectatorEngine(), store = createMemoryRoomStore(), ...options } = {}) {
  const server = startServer({
    gameRoot: path.resolve(__dirname, "../../game9"),
    sharedRoot: path.resolve(__dirname, ".."),
    engine,
    defaultPort: 0,
    spectatorsEnabled: true,
    spectatorLimit: 10,
    roomStore: store,
    ...options
  });
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, store, engine, base: `http://127.0.0.1:${server.address().port}` };
}

async function close(server) {
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  });
}

async function createRoom(running, capacity = 2) {
  const created = await post(running.base, "/api/rooms", {
    hostId: "host", name: "房主", capacity
  });
  assert.equal(created.response.status, 200);
  return created.payload;
}

function auth(session, extras = {}) {
  return {
    roomCode: session.roomCode,
    playerId: session.clientId,
    resumeToken: session.resumeToken,
    ...extras
  };
}

test("active spectator admission supports explicit choice, full-room fallback and a hard limit", async (context) => {
  const running = await launch({ spectatorLimit: 2 });
  context.after(async () => { if (running.server.listening) await close(running.server); });
  const host = await createRoom(running, 2);
  const guest = await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: "guest", name: "玩家", intent: "play"
  });
  assert.equal(guest.payload.memberRole, "player");

  const fallback = await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: "watch-1", name: "旁观甲", intent: "play"
  });
  assert.equal(fallback.response.status, 200);
  assert.equal(fallback.payload.memberRole, "spectator");
  assert.equal(fallback.payload.autoSpectated, true);
  assert.equal(fallback.payload.assignmentReason, "player_seats_full");
  assert.equal(fallback.payload.view.roomRole, "spectator");
  assert.equal("privateSecret" in fallback.payload.view, false);

  const explicit = await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: "watch-2", name: "旁观乙", intent: "spectate"
  });
  assert.equal(explicit.payload.memberRole, "spectator");
  assert.equal(explicit.payload.assignmentReason, "requested_spectator");
  assert.equal(explicit.payload.view.spectatorCount, 2);
  assert.deepEqual(explicit.payload.view.spectators.map(({ id }) => id), ["watch-1", "watch-2"]);

  const overflow = await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: "watch-3", name: "旁观丙", intent: "spectate"
  });
  assert.equal(overflow.response.status, 409);
  assert.equal(overflow.payload.code, "spectator_limit_reached");
});

test("new members automatically spectate after the game starts and receive only public views", async (context) => {
  const running = await launch();
  context.after(async () => { if (running.server.listening) await close(running.server); });
  const host = await createRoom(running, 3);
  const started = await post(running.base, "/api/actions", auth(host, {
    actionId: "start-1", expectedVersion: host.version, action: { type: "start" }
  }));
  assert.equal(started.response.status, 200);
  const observer = await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: "late", name: "迟到成员", intent: "play"
  });
  assert.equal(observer.payload.memberRole, "spectator");
  assert.equal(observer.payload.assignmentReason, "game_in_progress");
  assert.equal(observer.payload.view.phase, "playing");
  assert.equal("privateSecret" in observer.payload.view, false);
});

test("the shared action endpoint rejects spectators before invoking game rules", async (context) => {
  const running = await launch();
  context.after(async () => { if (running.server.listening) await close(running.server); });
  const host = await createRoom(running, 2);
  const observer = await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: "watch", name: "旁观者", intent: "spectate"
  });
  const result = await post(running.base, "/api/actions", auth(observer.payload, {
    actionId: "forged-action", expectedVersion: observer.payload.version, action: { type: "increment" }
  }));
  assert.equal(result.response.status, 403);
  assert.equal(result.payload.code, "spectator_cannot_act");
  assert.equal(running.engine.metrics.actions, 0);
});

test("spectators receive subsequent broadcasts through their dedicated public view", async (context) => {
  const running = await launch();
  context.after(async () => { if (running.server.listening) await close(running.server); });
  const host = await createRoom(running, 2);
  const observer = (await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: "watch", name: "旁观者", intent: "spectate"
  })).payload;
  const events = await fetch(`${running.base}/api/events?${new URLSearchParams({
    clientId: observer.clientId,
    roomCode: observer.roomCode,
    resumeToken: observer.resumeToken
  })}`);
  assert.equal(events.status, 200);
  const reader = events.body.getReader();
  const action = await post(running.base, "/api/actions", auth(host, {
    actionId: "public-change", action: { type: "increment" }
  }));
  assert.equal(action.response.status, 200);
  const decoder = new TextDecoder();
  let streamText = "";
  const deadline = Date.now() + 1500;
  while (!streamText.includes('"publicCounter":1') && Date.now() < deadline) {
    const result = await Promise.race([
      reader.read(),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 250))
    ]);
    if (result.timeout) continue;
    if (result.done) break;
    streamText += decoder.decode(result.value, { stream: true });
  }
  assert.match(streamText, /"publicCounter":1/);
  assert.doesNotMatch(streamText, /privateSecret|secret-host/);
  await reader.cancel();
});

test("hosts can close admission and kick spectators without touching player removal rules", async (context) => {
  const running = await launch();
  context.after(async () => { if (running.server.listening) await close(running.server); });
  const host = await createRoom(running, 3);
  const observer = await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: "watch", name: "旁观者", intent: "spectate"
  });
  const unauthorized = await post(running.base, "/api/room-settings", {
    roomCode: host.roomCode,
    hostId: observer.payload.clientId,
    resumeToken: observer.payload.resumeToken,
    allowSpectators: false
  });
  assert.equal(unauthorized.response.status, 403);
  assert.equal(unauthorized.payload.code, "host_required");
  const settings = await post(running.base, "/api/room-settings", {
    roomCode: host.roomCode,
    hostId: host.clientId,
    resumeToken: host.resumeToken,
    allowSpectators: false
  });
  assert.equal(settings.response.status, 200);
  assert.equal(settings.payload.allowSpectators, false);

  const rejected = await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: "late", name: "新旁观者", intent: "spectate"
  });
  assert.equal(rejected.response.status, 403);
  assert.equal(rejected.payload.code, "spectators_disabled");

  const resumed = await post(running.base, "/api/join", {
    roomCode: host.roomCode,
    clientId: observer.payload.clientId,
    resumeToken: observer.payload.resumeToken,
    intent: "play"
  });
  assert.equal(resumed.response.status, 200);
  assert.equal(resumed.payload.resumed, true);
  assert.equal(resumed.payload.memberRole, "spectator");

  const kicked = await post(running.base, "/api/kick", {
    roomCode: host.roomCode,
    hostId: host.clientId,
    resumeToken: host.resumeToken,
    playerId: observer.payload.clientId
  });
  assert.equal(kicked.response.status, 200);
  assert.equal(running.engine.metrics.removals, 0);
  const kickedResume = await post(running.base, "/api/join", {
    roomCode: host.roomCode,
    clientId: observer.payload.clientId,
    resumeToken: observer.payload.resumeToken
  });
  assert.equal(kickedResume.response.status, 403);
  assert.equal(kickedResume.payload.code, "kicked");
});

test("seat changes are lobby-only, keep the host seated and update game membership atomically", async (context) => {
  const running = await launch();
  context.after(async () => { if (running.server.listening) await close(running.server); });
  const host = await createRoom(running, 3);
  const guest = (await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: "guest", name: "玩家", intent: "play"
  })).payload;
  const observer = (await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: "watch", name: "旁观者", intent: "spectate"
  })).payload;

  const hostLeaves = await post(running.base, "/api/seat", auth(host, { intent: "spectate" }));
  assert.equal(hostLeaves.response.status, 403);
  assert.equal(hostLeaves.payload.code, "host_must_remain_player");

  const guestLeaves = await post(running.base, "/api/seat", auth(guest, { intent: "spectate" }));
  assert.equal(guestLeaves.response.status, 200);
  assert.equal(guestLeaves.payload.memberRole, "spectator");
  assert.equal(running.engine.metrics.vacates, 1);
  assert.deepEqual(guestLeaves.payload.view.players.map(({ id }) => id), ["host"]);

  const observerPlays = await post(running.base, "/api/seat", auth(observer, { intent: "play" }));
  assert.equal(observerPlays.response.status, 200);
  assert.equal(observerPlays.payload.memberRole, "player");
  assert.deepEqual(observerPlays.payload.view.players.map(({ id }) => id), ["host", "watch"]);

  const started = await post(running.base, "/api/actions", auth(host, {
    actionId: "start-after-seats",
    expectedVersion: observerPlays.payload.version,
    action: { type: "start" }
  }));
  assert.equal(started.response.status, 200);
  const lateChange = await post(running.base, "/api/seat", auth(guest, { intent: "play" }));
  assert.equal(lateChange.response.status, 409);
  assert.equal(lateChange.payload.code, "seat_change_unavailable");
});

test("two spectators competing for the final seat cannot exceed capacity", async (context) => {
  const running = await launch();
  context.after(async () => { if (running.server.listening) await close(running.server); });
  const host = await createRoom(running, 2);
  const first = (await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: "watch-a", name: "甲", intent: "spectate"
  })).payload;
  const second = (await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: "watch-b", name: "乙", intent: "spectate"
  })).payload;
  const results = await Promise.all([
    post(running.base, "/api/seat", auth(first, { intent: "play" })),
    post(running.base, "/api/seat", auth(second, { intent: "play" }))
  ]);
  assert.deepEqual(results.map(({ response }) => response.status).sort(), [200, 409]);
  const failure = results.find(({ response }) => response.status === 409);
  assert.equal(failure.payload.code, "room_full");
  const snapshot = running.store.loadRooms().find(({ roomCode }) => roomCode === host.roomCode).snapshot;
  assert.equal(snapshot.state.players.length, 2);
  assert.equal(snapshot.members.filter(({ role, kicked }) => role === "player" && !kicked).length, 2);
});

test("SQLite restart preserves spectator identity and room admission settings", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tablegame-spectator-system-"));
  const filename = path.join(directory, "rooms.sqlite");
  let running = null;
  context.after(async () => {
    if (running?.server.listening) await close(running.server);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  running = await launch({ store: createSqliteRoomStore({ filename }) });
  const host = await createRoom(running, 2);
  const observer = (await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: "watch", name: "旁观者", intent: "spectate"
  })).payload;
  await post(running.base, "/api/room-settings", {
    roomCode: host.roomCode,
    hostId: host.clientId,
    resumeToken: host.resumeToken,
    allowSpectators: false
  });
  await close(running.server);

  running = await launch({ store: createSqliteRoomStore({ filename }) });
  const resumed = await post(running.base, "/api/join", {
    roomCode: host.roomCode,
    clientId: observer.clientId,
    resumeToken: observer.resumeToken
  });
  assert.equal(resumed.response.status, 200);
  assert.equal(resumed.payload.resumed, true);
  assert.equal(resumed.payload.memberRole, "spectator");
  assert.equal(resumed.payload.view.allowSpectators, false);
  assert.equal("privateSecret" in resumed.payload.view, false);
});

test("an online spectator cannot keep a room alive without online players", async (context) => {
  const running = await launch({ roomIdleMs: 100 });
  context.after(async () => { if (running.server.listening) await close(running.server); });
  const host = await createRoom(running, 2);
  const observer = (await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: "watch", name: "旁观者", intent: "spectate"
  })).payload;
  const events = await fetch(`${running.base}/api/events?${new URLSearchParams({
    clientId: observer.clientId,
    roomCode: observer.roomCode,
    resumeToken: observer.resumeToken
  })}`);
  assert.equal(events.status, 200);
  const reader = events.body.getReader();
  const decoder = new TextDecoder();
  let streamText = "";
  const deadline = Date.now() + 1500;
  while (!streamText.includes('"kind":"room_expired"') && Date.now() < deadline) {
    const result = await Promise.race([
      reader.read(),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 250))
    ]);
    if (result.timeout) continue;
    if (result.done) break;
    streamText += decoder.decode(result.value, { stream: true });
  }
  assert.match(streamText, /"kind":"room_expired"/);
  const missing = await post(running.base, "/api/join", {
    roomCode: host.roomCode,
    clientId: host.clientId,
    resumeToken: host.resumeToken
  });
  assert.equal(missing.response.status, 404);
  assert.equal(running.store.loadRooms().length, 0);
});
