import assert from "node:assert/strict";
import test from "node:test";
import { CATEGORIES } from "./rules.mjs";
import * as engine from "./server/game-engine.mjs";

function readyLobby() {
  const state = engine.createLobby({
    capacity: 2,
    host: { id: "host", name: "Host", connected: true }
  });
  engine.addPlayer(state, { id: "p2", name: "Player 2", connected: true });
  return state;
}

test("game3 lobby and host permissions are server rules", () => {
  const state = engine.createLobby({
    capacity: 3,
    host: { id: "host", name: "Host", connected: false }
  });
  engine.addPlayer(state, { id: "p2", name: "Player 2" });
  assert.throws(
    () => engine.applyAction(state, "p2", { type: "setCapacity", capacity: 2 }),
    (error) => error.code === "host_required" && error.status === 403
  );
  engine.applyAction(state, "host", { type: "setCapacity", capacity: 2 });
  assert.equal(state.capacity, 2);
  engine.removePlayer(state, "host", "p2");
  assert.equal(state.players.length, 1);
});

test("game3 server owns rolls, held dice and turn ownership", () => {
  const state = readyLobby();
  engine.applyAction(state, "host", { type: "start" });
  assert.throws(
    () => engine.applyAction(state, "p2", { type: "roll" }),
    (error) => error.code === "not_your_turn"
  );
  const values = [0, 0.2, 0.4, 0.6, 0.999];
  let index = 0;
  engine.applyAction(state, "host", { type: "roll" }, { random: () => values[index++] });
  assert.deepEqual(state.dice, [1, 2, 3, 4, 6]);
  engine.applyAction(state, "host", { type: "hold", index: 4 });
  engine.applyAction(state, "host", { type: "roll" }, { random: () => 0 });
  assert.deepEqual(state.dice, [1, 1, 1, 1, 6]);
  assert.equal(state.rolls, 2);
});

test("game3 scoring is authoritative and advances the turn", () => {
  const state = readyLobby();
  engine.applyAction(state, "host", { type: "start" });
  engine.applyAction(state, "host", { type: "roll" }, { random: () => 0 });
  engine.applyAction(state, "host", { type: "score", category: "ones" });
  assert.equal(state.players[0].scorecard.ones, 5);
  assert.equal(state.completedTurns, 1);
  assert.equal(state.currentPlayerIndex, 1);
  assert.deepEqual(state.dice, [null, null, null, null, null]);
  assert.throws(
    () => engine.applyAction(state, "p2", { type: "score", category: "ones" }),
    (error) => error.code === "roll_required"
  );
});

test("game3 completes exactly thirteen categories for every player", () => {
  const state = readyLobby();
  engine.applyAction(state, "host", { type: "start" });
  for (const category of CATEGORIES) {
    for (let seat = 0; seat < state.players.length; seat += 1) {
      const actorId = state.players[state.currentPlayerIndex].id;
      engine.applyAction(state, actorId, { type: "roll" }, { random: () => 0.5 });
      engine.applyAction(state, actorId, { type: "score", category: category.id });
    }
  }
  assert.equal(state.phase, "ended");
  assert.equal(state.completedTurns, 26);
  assert.equal(engine.buildView(state, "host").round, 13);
});

test("game3 disconnect skips an unfinished current turn", () => {
  const state = readyLobby();
  engine.applyAction(state, "host", { type: "start" });
  engine.applyAction(state, "host", { type: "roll" }, { random: () => 0.5 });
  assert.equal(engine.setPresence(state, "host", false), true);
  assert.equal(state.currentPlayerIndex, 1);
  assert.equal(state.rolls, 0);
  assert.deepEqual(state.dice, [null, null, null, null, null]);
});

test("game3 views expose public scores but only the current player may act", () => {
  const state = readyLobby();
  engine.applyAction(state, "host", { type: "start" });
  const hostView = engine.buildView(state, "host");
  const guestView = engine.buildView(state, "p2");
  assert.deepEqual(hostView.dice, guestView.dice);
  assert.deepEqual(hostView.players, guestView.players);
  assert.equal(hostView.currentPlayerId, "host");
  assert.equal(guestView.permissions.canEnd, false);
});

test("game3 persisted state is cloned and version checked", () => {
  const state = readyLobby();
  const serialized = engine.serializeState(state);
  serialized.players[0].name = "Changed only in snapshot";
  assert.equal(state.players[0].name, "Host");
  assert.deepEqual(engine.restoreState(engine.serializeState(state)), state);
  assert.throws(
    () => engine.restoreState({ ...serialized, stateVersion: 999 }),
    /Unsupported game3 state version/
  );
});
