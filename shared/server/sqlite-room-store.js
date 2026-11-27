"use strict";

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { SCHEMA_VERSION } = require("./memory-room-store");

function createSqliteRoomStore({ filename }) {
  if (!filename) throw new TypeError("SQLite room store requires a filename");
  const resolvedFilename = path.resolve(filename);
  fs.mkdirSync(path.dirname(resolvedFilename), { recursive: true, mode: 0o700 });

  const database = new DatabaseSync(resolvedFilename);
  fs.chmodSync(resolvedFilename, 0o600);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rooms (
      room_code TEXT PRIMARY KEY,
      snapshot TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  const schemaRow = database.prepare("SELECT value FROM metadata WHERE key = ?").get("schema_version");
  if (schemaRow == null) {
    database.prepare("INSERT INTO metadata (key, value) VALUES (?, ?)")
      .run("schema_version", String(SCHEMA_VERSION));
  } else if (Number(schemaRow.value) !== SCHEMA_VERSION) {
    database.close();
    throw new Error(
      `Unsupported room database schema ${schemaRow.value}; expected ${SCHEMA_VERSION}`
    );
  }

  const selectRooms = database.prepare("SELECT room_code, snapshot FROM rooms ORDER BY room_code");
  const saveRoom = database.prepare(`
    INSERT INTO rooms (room_code, snapshot, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(room_code) DO UPDATE SET
      snapshot = excluded.snapshot,
      updated_at = excluded.updated_at
  `);
  const deleteRoom = database.prepare("DELETE FROM rooms WHERE room_code = ?");
  const healthCheck = database.prepare("SELECT 1 AS ok");
  let analytics;

  function atomic(operation) {
    database.exec("BEGIN IMMEDIATE");
    try {
      operation();
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    kind: "sqlite",
    durable: true,
    schemaVersion: SCHEMA_VERSION,
    filename: resolvedFilename,
    loadRooms() {
      return selectRooms.all().map((row) => ({
        roomCode: row.room_code,
        snapshot: JSON.parse(row.snapshot)
      }));
    },
    enableAnalytics(game) {
      analytics = require("./match-analytics.cjs").matchAnalytics(database, game);
    },
    saveRoom(roomCode, snapshot, cause) {
      const save = () => saveRoom.run(String(roomCode), JSON.stringify(snapshot), Date.now());
      if (!analytics) return void save();
      atomic(() => { save(); analytics.save(String(roomCode), snapshot, cause); });
    },
    deleteRoom(roomCode) {
      if (!analytics) return void deleteRoom.run(String(roomCode));
      atomic(() => {
        analytics.expire(String(roomCode), Date.now());
        deleteRoom.run(String(roomCode));
      });
    },
    check() {
      return healthCheck.get().ok === 1;
    },
    close() {
      database.close();
    }
  };
}

module.exports = { createSqliteRoomStore };
