"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { createMemoryRoomStore } = require("./memory-room-store");
const { createSqliteRoomStore } = require("./sqlite-room-store");

const SAMPLE = {
  schemaVersion: 1,
  protocolVersion: 3,
  hostId: "host",
  members: [{ id: "host", resumeToken: "secret", actionIds: ["a1"] }],
  state: { phase: "playing", players: [{ id: "host", connected: false }] },
  version: 4,
  createdAt: 100,
  updatedAt: 200
};

test("memory room store isolates saved and loaded snapshots", () => {
  const store = createMemoryRoomStore();
  const source = structuredClone(SAMPLE);
  store.saveRoom("ABCD", source);
  source.state.phase = "ended";
  const loaded = store.loadRooms();
  assert.deepEqual(loaded, [{ roomCode: "ABCD", snapshot: SAMPLE }]);
  loaded[0].snapshot.state.phase = "lobby";
  assert.equal(store.loadRooms()[0].snapshot.state.phase, "playing");
});

test("SQLite room store survives close, reopen, update and delete", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tablegame-room-store-"));
  const filename = path.join(directory, "rooms.sqlite");
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  let store = createSqliteRoomStore({ filename });
  store.saveRoom("ABCD", SAMPLE);
  assert.equal(store.check(), true);
  store.close();

  store = createSqliteRoomStore({ filename });
  assert.deepEqual(store.loadRooms(), [{ roomCode: "ABCD", snapshot: SAMPLE }]);
  store.saveRoom("ABCD", { ...SAMPLE, version: 5 });
  assert.equal(store.loadRooms()[0].snapshot.version, 5);
  store.deleteRoom("ABCD");
  assert.deepEqual(store.loadRooms(), []);
  store.close();
});
