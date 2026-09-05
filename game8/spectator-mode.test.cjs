"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const startAuthoritativeGameServer = require("../shared/server/start-authoritative-game-server");
const { createMemoryRoomStore } = require("../shared/server/memory-room-store");
const { createSqliteRoomStore } = require("../shared/server/sqlite-room-store");

async function post(base, pathname, body) {
  const response = await fetch(`${base}${pathname}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  return { response, payload: await response.json() };
}

function openEvents(base, session) {
  return new Promise((resolve, reject) => {
    const url = new URL("/api/events", base);
    url.searchParams.set("clientId", session.clientId);
    url.searchParams.set("roomCode", session.roomCode);
    url.searchParams.set("resumeToken", session.resumeToken);
    const request = http.get(url, (response) => {
      if (response.statusCode !== 200) return reject(new Error(`SSE returned ${response.statusCode}`));
      response.once("data", () => resolve({ request, response }));
    });
    request.on("error", reject);
  });
}

async function launch(options = {}) {
  const engine = await import("./server/game-engine.mjs");
  const store = options.roomStore || createMemoryRoomStore();
  const server = startAuthoritativeGameServer({
    gameRoot: __dirname,
    sharedRoot: path.resolve(__dirname, "../shared"),
    engine,
    protocolVersion: 3,
    defaultPort: 0,
    spectatorsEnabled: true,
    spectatorLimit: 10,
    roomStore: store,
    ...options
  });
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, store, base: `http://127.0.0.1:${server.address().port}` };
}

async function close(running, streams = []) {
  for (const stream of streams) stream.request.destroy();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => {
    running.server.close(resolve);
    running.server.closeAllConnections?.();
  });
}

const auth = (session, extras = {}) => ({
  roomCode: session.roomCode,
  playerId: session.clientId,
  resumeToken: session.resumeToken,
  ...extras
});

test("game8 supports voluntary spectators and lobby-only seat changes", async (context) => {
  const running = await launch();
  context.after(() => close(running));
  const config = await fetch(`${running.base}/api/config`).then((response) => response.json());
  assert.equal(config.spectatorsSupported, true);
  assert.equal(config.spectatorsEnabled, true);

  const host = (await post(running.base, "/api/rooms", { hostId: "host", name: "房主", capacity: 3 })).payload;
  const player = (await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: "p2", name: "二号", intent: "play"
  })).payload;
  const observer = (await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: "watch", name: "旁观者", intent: "spectate"
  })).payload;
  assert.equal(observer.memberRole, "spectator");
  assert.equal(observer.view.selfId, null);
  assert.equal(observer.view.canChangeSeats, true);

  const hostAttempt = await post(running.base, "/api/seat", auth(host, { intent: "spectate" }));
  assert.equal(hostAttempt.response.status, 403);
  assert.equal(hostAttempt.payload.code, "host_must_remain_player");
  const playerLeaves = await post(running.base, "/api/seat", auth(player, { intent: "spectate" }));
  assert.equal(playerLeaves.response.status, 200);
  assert.equal(playerLeaves.payload.memberRole, "spectator");
  const observerPlays = await post(running.base, "/api/seat", auth(observer, { intent: "play" }));
  assert.equal(observerPlays.response.status, 200);
  assert.equal(observerPlays.payload.memberRole, "player");
});

test("game8 active-room spectators cannot recover blind reserves or perform actions", async (context) => {
  const running = await launch();
  const streams = [];
  context.after(() => close(running, streams));
  const host = (await post(running.base, "/api/rooms", { hostId: "host", name: "房主", capacity: 2 })).payload;
  const guest = (await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: "p2", name: "二号", intent: "play"
  })).payload;
  const fullObserver = (await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: "watch-full", name: "满房旁观", intent: "play"
  })).payload;
  assert.equal(fullObserver.memberRole, "spectator");
  assert.equal(fullObserver.autoSpectated, true);
  assert.equal(fullObserver.assignmentReason, "player_seats_full");

  streams.push(await openEvents(running.base, host), await openEvents(running.base, guest));
  assert.equal((await post(running.base, "/api/actions", auth(host, {
    actionId: "start", action: { type: "start" }
  }))).response.status, 200);
  const current = (await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: host.clientId, resumeToken: host.resumeToken
  })).payload.view;
  const actorId = current.players[current.game.turn].id;
  const actor = actorId === host.clientId ? host : guest;
  assert.equal((await post(running.base, "/api/actions", auth(actor, {
    actionId: "blind-reserve", action: { type: "reserve", target: { fromDeck: "stage1" } }
  }))).response.status, 200);

  const snapshot = running.store.loadRooms().find((room) => room.roomCode === host.roomCode).snapshot;
  const actorSeat = snapshot.state.players.findIndex((player) => player.id === actorId);
  const secretId = snapshot.state.game.players[actorSeat].reserve[0];
  const late = await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: "watch-late", name: "开局后旁观", intent: "play"
  });
  assert.equal(late.payload.memberRole, "spectator");
  assert.equal(late.payload.assignmentReason, "game_in_progress");
  assert.equal(late.payload.view.selfId, null);
  assert.equal(late.payload.view.game.viewerId, null);
  assert.equal(late.payload.view.canChangeSeats, false);
  assert.equal("seed" in late.payload.view.game, false);
  assert.ok(late.payload.view.game.decks.stage1.every((card) => card === null));
  assert.deepEqual(late.payload.view.game.players[actorSeat].reserve[0], { hidden: true, tier: "stage1" });
  assert.equal(JSON.stringify(late.payload.view).includes(secretId), false);
  assert.ok(Object.values(late.payload.view.permissions).every((allowed) => allowed === false));

  const forged = await post(running.base, "/api/actions", auth(late.payload, {
    actionId: "forged", action: { type: "endTurn" }
  }));
  assert.equal(forged.response.status, 403);
  assert.equal(forged.payload.code, "spectator_cannot_act");
  const seatAttempt = await post(running.base, "/api/seat", auth(late.payload, { intent: "play" }));
  assert.equal(seatAttempt.response.status, 409);
  assert.equal(seatAttempt.payload.code, "seat_change_unavailable");
});

test("game8 SQLite restart restores spectator identity, settings and redacted view", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tablegame-game8-spectator-"));
  const filename = path.join(directory, "game8.sqlite");
  let running = null;
  context.after(async () => {
    if (running?.server.listening) await close(running);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  running = await launch({ roomStore: createSqliteRoomStore({ filename }) });
  const host = (await post(running.base, "/api/rooms", { hostId: "host", name: "房主", capacity: 2 })).payload;
  const observer = (await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: "watch", name: "旁观者", intent: "spectate"
  })).payload;
  await post(running.base, "/api/room-settings", {
    roomCode: host.roomCode,
    hostId: host.clientId,
    resumeToken: host.resumeToken,
    allowSpectators: false
  });
  await close(running);
  running = await launch({ roomStore: createSqliteRoomStore({ filename }) });
  const resumed = await post(running.base, "/api/join", {
    roomCode: host.roomCode,
    clientId: observer.clientId,
    resumeToken: observer.resumeToken
  });
  assert.equal(resumed.response.status, 200);
  assert.equal(resumed.payload.resumed, true);
  assert.equal(resumed.payload.memberRole, "spectator");
  assert.equal(resumed.payload.view.allowSpectators, false);
  assert.equal(resumed.payload.view.selfId, null);
  assert.equal(resumed.payload.view.game, null);
});

test("game8 page consumes the shared spectator UI and hides its private trainer board", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  assert.match(html, /name="joinIntent" value="play"/);
  assert.match(html, /name="joinIntent" value="spectate"/);
  assert.match(html, /id="roomHeaderTools"/);
  assert.match(html, /id="seatActionButton"/);
  assert.doesNotMatch(html, /id="roomRoleBanner"/);
  assert.match(html, /id="spectatorList"/);
  assert.match(html, /id="trainerBoard"/);
  assert.match(html, /shared\/styles\/spectator\.css/);
  assert.match(script, /createSpectatorUi/);
  assert.match(script, /spectatorUi\.render\(v\)/);
  assert.match(script, /setHidden\(E\.trainerBoard,isSpectator\)/);
  assert.match(script, /spectator-action-note/);
  assert.match(styles, /spectator-action-note/);
});
