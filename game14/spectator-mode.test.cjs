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

async function close(server, streams = []) {
  for (const stream of streams) stream.request.destroy();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); });
}

const auth = (session, extras = {}) => ({
  roomCode: session.roomCode,
  playerId: session.clientId,
  resumeToken: session.resumeToken,
  ...extras
});

async function createRoom(running, capacity = 2) {
  const result = await post(running.base, "/api/rooms", { hostId: "host", name: "房主", capacity });
  assert.equal(result.response.status, 200);
  return result.payload;
}

test("game14 supports voluntary spectators and safe lobby seat changes", async (context) => {
  const running = await launch();
  context.after(async () => { if (running.server.listening) await close(running.server); });
  const config = await fetch(`${running.base}/api/config`).then((response) => response.json());
  assert.equal(config.spectatorsSupported, true);
  assert.equal(config.spectatorsEnabled, true);
  const host = await createRoom(running, 3);
  const player = (await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: "p2", name: "二号", intent: "play"
  })).payload;
  const observer = (await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: "watch", name: "旁观者", intent: "spectate"
  })).payload;
  assert.equal(observer.memberRole, "spectator");
  assert.equal(observer.view.selfId, null);
  assert.deepEqual(observer.view.hand, []);
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
  const resumed = await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: player.clientId, resumeToken: player.resumeToken
  });
  assert.equal(resumed.payload.resumed, true);
  assert.equal(resumed.payload.memberRole, "spectator");
  const kicked = await post(running.base, "/api/kick", {
    roomCode: host.roomCode,
    hostId: host.clientId,
    resumeToken: host.resumeToken,
    playerId: player.clientId
  });
  assert.equal(kicked.response.status, 200);
});

test("game14 full and active rooms admit only hand-redacted spectators", async (context) => {
  const running = await launch();
  const streams = [];
  context.after(async () => { if (running.server.listening) await close(running.server, streams); });
  const host = await createRoom(running, 2);
  const guest = (await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: "p2", name: "二号", intent: "play"
  })).payload;
  const fullObserver = (await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: "watch-full", name: "满房旁观", intent: "play"
  })).payload;
  assert.equal(fullObserver.autoSpectated, true);
  assert.equal(fullObserver.assignmentReason, "player_seats_full");
  streams.push(await openEvents(running.base, host), await openEvents(running.base, guest));
  const started = await post(running.base, "/api/actions", auth(host, {
    actionId: "start", action: { type: "start" }
  }));
  assert.equal(started.response.status, 200);
  const late = await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: "watch-late", name: "开局后旁观", intent: "play"
  });
  assert.equal(late.response.status, 200);
  assert.equal(late.payload.memberRole, "spectator");
  assert.equal(late.payload.assignmentReason, "game_in_progress");
  assert.equal(late.payload.view.selfId, null);
  assert.deepEqual(late.payload.view.hand, []);
  assert.equal(late.payload.view.canChangeSeats, false);
  assert.ok(late.payload.view.players.every((player) => !("hand" in player) && player.handCount === 3));
  assert.equal(JSON.stringify(late.payload.view).includes("legalTargets"), false);
  const forged = await post(running.base, "/api/actions", auth(late.payload, {
    actionId: "forged", action: { type: "discardCard", cardId: "mud_1" }
  }));
  assert.equal(forged.response.status, 403);
  assert.equal(forged.payload.code, "spectator_cannot_act");
  const seatAttempt = await post(running.base, "/api/seat", auth(late.payload, { intent: "play" }));
  assert.equal(seatAttempt.response.status, 409);
  assert.equal(seatAttempt.payload.code, "seat_change_unavailable");
  const closed = await post(running.base, "/api/room-settings", {
    roomCode: host.roomCode,
    hostId: host.clientId,
    resumeToken: host.resumeToken,
    allowSpectators: false
  });
  assert.equal(closed.response.status, 200);
  const blocked = await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: "blocked", name: "被拒绝", intent: "spectate"
  });
  assert.equal(blocked.response.status, 403);
  assert.equal(blocked.payload.code, "spectators_disabled");
});

test("game14 serializes concurrent competition for the last player seat", async (context) => {
  const running = await launch();
  context.after(async () => { if (running.server.listening) await close(running.server); });
  const host = await createRoom(running, 2);
  const observers = [];
  for (const id of ["watch-a", "watch-b"]) {
    observers.push((await post(running.base, "/api/join", {
      roomCode: host.roomCode, clientId: id, name: id, intent: "spectate"
    })).payload);
  }
  const results = await Promise.all(observers.map((observer) => (
    post(running.base, "/api/seat", auth(observer, { intent: "play" }))
  )));
  assert.deepEqual(results.map(({ response }) => response.status).sort(), [200, 409]);
  assert.equal(results.find(({ response }) => response.status === 409).payload.code, "room_full");
  const snapshot = running.store.loadRooms().find(({ roomCode }) => roomCode === host.roomCode).snapshot;
  assert.equal(snapshot.state.players.length, 2);
});

test("game14 SQLite restart restores spectator identity, settings and empty hand", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tablegame-game14-spectator-"));
  const filename = path.join(directory, "game14.sqlite");
  let running = null;
  context.after(async () => {
    if (running?.server.listening) await close(running.server);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  running = await launch({ roomStore: createSqliteRoomStore({ filename }) });
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
  running = await launch({ roomStore: createSqliteRoomStore({ filename }) });
  const resumed = await post(running.base, "/api/join", {
    roomCode: host.roomCode, clientId: observer.clientId, resumeToken: observer.resumeToken
  });
  assert.equal(resumed.response.status, 200);
  assert.equal(resumed.payload.resumed, true);
  assert.equal(resumed.payload.memberRole, "spectator");
  assert.equal(resumed.payload.view.allowSpectators, false);
  assert.deepEqual(resumed.payload.view.hand, []);
});

test("game14 page consumes shared spectator UI and hides its private hand zone", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  assert.match(html, /name="joinIntent" value="play"/);
  assert.match(html, /name="joinIntent" value="spectate"/);
  assert.match(html, /id="roomHeaderTools"/);
  assert.match(html, /id="seatActionButton"/);
  assert.doesNotMatch(html, /id="roomRoleBanner"/);
  assert.match(html, /id="spectatorList"/);
  assert.match(html, /id="handZone"/);
  assert.match(html, /shared\/styles\/spectator\.css/);
  assert.match(script, /createSpectatorUi/);
  assert.match(script, /spectatorUi\.render\(view\)/);
  assert.match(script, /setHidden\(E\.handZone, memberRole === "spectator"\)/);
  assert.match(script, /spectator-action-note/);
  assert.doesNotMatch(script, /async function changeSeat/);
  assert.match(styles, /control-dock\[data-role="spectator"\]/);
});
