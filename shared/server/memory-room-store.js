"use strict";

const SCHEMA_VERSION = 1;

function clone(value) {
  return structuredClone(value);
}

function createMemoryRoomStore() {
  const rooms = new Map();

  return {
    kind: "memory",
    durable: false,
    schemaVersion: SCHEMA_VERSION,
    loadRooms() {
      return [...rooms.entries()].map(([roomCode, snapshot]) => ({
        roomCode,
        snapshot: clone(snapshot)
      }));
    },
    saveRoom(roomCode, snapshot) {
      rooms.set(String(roomCode), clone(snapshot));
    },
    deleteRoom(roomCode) {
      rooms.delete(String(roomCode));
    },
    check() {
      return true;
    },
    close() {}
  };
}

module.exports = { SCHEMA_VERSION, createMemoryRoomStore };
