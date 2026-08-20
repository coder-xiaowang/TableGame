"use strict";

import { normalizeRoomCode } from "./utils.js";

export function createSessionStore({ gameId, storage = globalThis.localStorage } = {}) {
  if (!gameId || !/^[a-z0-9_-]+$/i.test(gameId)) {
    throw new TypeError("gameId must contain only letters, numbers, dashes or underscores");
  }

  const keyFor = (roomCode) => `tablegame:${gameId}:${normalizeRoomCode(roomCode)}`;

  return Object.freeze({
    load(roomCode) {
      try {
        const value = JSON.parse(storage.getItem(keyFor(roomCode)) || "null");
        if (!value?.playerId || !value?.resumeToken) return null;
        return value;
      } catch {
        return null;
      }
    },

    save(roomCode, session) {
      if (!session?.playerId || !session?.resumeToken) {
        throw new TypeError("session requires playerId and resumeToken");
      }
      const value = {
        playerId: String(session.playerId),
        resumeToken: String(session.resumeToken),
        name: String(session.name ?? "")
      };
      storage.setItem(keyFor(roomCode), JSON.stringify(value));
      return value;
    },

    clear(roomCode) {
      storage.removeItem(keyFor(roomCode));
    },

    keyFor
  });
}
