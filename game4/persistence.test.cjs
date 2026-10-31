"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createSqliteRoomStore } = require("../shared/server/sqlite-room-store");

test("SQLite快照保存完整权威牌局并能恢复而不公开牌库", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tablegame-game4-"));
  const filename = path.join(directory, "game4.sqlite");
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const engine = await import("./server/game-engine.mjs");
  const state = engine.createLobby({ capacity: 2, host: { id: "host", name: "房主", connected: true } });
  engine.addPlayer(state, { id: "p2", name: "玩家2", connected: true });
  engine.applyAction(state, "host", { type: "start" }, { now: 1000, random: () => 0.35 });
  const store = createSqliteRoomStore({ filename });
  store.saveRoom("HOLD", {
    schemaVersion: 1, protocolVersion: 3, hostId: "host",
    members: state.players.map((player) => ({
      id: player.id, name: player.name, resumeToken: `token-${player.id}`, connected: false,
      everConnected: true, kicked: false, actionIds: []
    })),
    state: engine.serializeState(state), version: 3, createdAt: 1000, updatedAt: 1000,
    lastPlayerActivityAt: 1000, allowSpectators: true
  });
  store.close();

  const reopened = createSqliteRoomStore({ filename });
  const snapshot = reopened.loadRooms().find((room) => room.roomCode === "HOLD")?.snapshot;
  reopened.close();
  assert.ok(snapshot);
  const restored = engine.restoreState(snapshot.state);
  assert.equal(restored.phase, "playing");
  assert.deepEqual(restored.deck, state.deck);
  const view = engine.buildView(restored, "host");
  assert.equal("deck" in view, false);
  assert.equal(view.players.find((player) => player.id === "p2").hole.every((card) => card === null), true);
});
