"use strict";

import test from "node:test";
import assert from "node:assert/strict";
import { createSessionStore } from "../client/session-store.js";
import { assertProtocolVersion, ProtocolVersionError } from "../client/protocol.js";
import { cleanPlayerName, escapeHtml, normalizeRoomCode } from "../client/utils.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}

test("room code and player input are normalized", () => {
  assert.equal(normalizeRoomCode(" a-b_c12 "), "ABC1");
  assert.equal(cleanPlayerName("  Alice  ", "玩家"), "Alice");
  assert.equal(escapeHtml('<b class="x">&</b>'), "&lt;b class=&quot;x&quot;&gt;&amp;&lt;/b&gt;");
});

test("sessions are isolated by game and room", () => {
  const storage = memoryStorage();
  const game9 = createSessionStore({ gameId: "game9", storage });
  const another = createSessionStore({ gameId: "another", storage });
  const session = { playerId: "guest_1", resumeToken: "secret", name: "Alice" };

  game9.save("ab12", session);
  assert.deepEqual(game9.load("AB12"), session);
  assert.equal(another.load("AB12"), null);
  game9.clear("AB12");
  assert.equal(game9.load("AB12"), null);
});

test("protocol mismatch is rejected", () => {
  assert.equal(assertProtocolVersion({ protocolVersion: 2 }, 2).protocolVersion, 2);
  assert.throws(
    () => assertProtocolVersion({ protocolVersion: 1 }, 2),
    ProtocolVersionError
  );
});
