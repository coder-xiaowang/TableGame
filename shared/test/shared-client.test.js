"use strict";

import test from "node:test";
import assert from "node:assert/strict";
import { createAuthoritativeRoomClient } from "../client/authoritative-room-client.js";
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

test("authoritative client sends every role action to the server with a state version", async () => {
  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      queueMicrotask(() => this.listeners.get("open")?.({ type: "open" }));
    }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    close() {}
  }

  const requests = [];
  const initialView = {
    selfId: "host_1",
    phase: "lobby",
    capacity: 3,
    players: []
  };
  async function fetchImpl(path, options = {}) {
    if (path === "/api/config") {
      return new Response(JSON.stringify({ authorityMode: "server", protocolVersion: 3 }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }
    const data = JSON.parse(options.body);
    requests.push({ path, data });
    if (path === "/api/rooms") {
      return new Response(JSON.stringify({
        roomCode: "ABCD",
        hostId: "host_1",
        clientId: "host_1",
        resumeToken: "secure-token",
        role: "host",
        version: 4,
        view: initialView,
        protocolVersion: 3
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true, version: 5, protocolVersion: 3 }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  }

  const views = [];
  const client = createAuthoritativeRoomClient({
    protocolVersion: 3,
    sessionStore: createSessionStore({ gameId: "test-authority", storage: memoryStorage() }),
    fetchImpl,
    EventSourceImpl: FakeEventSource,
    handlers: { onView: (view, version) => views.push({ view, version }) }
  });
  await client.createRoom({ name: "房主", capacity: 3, id: "host_1" });
  await client.submitAction({ type: "start" });

  assert.deepEqual(views, [{ view: initialView, version: 4 }]);
  assert.equal(requests[1].path, "/api/actions");
  assert.equal(requests[1].data.playerId, "host_1");
  assert.equal(requests[1].data.expectedVersion, 4);
  assert.deepEqual(requests[1].data.action, { type: "start" });
});
