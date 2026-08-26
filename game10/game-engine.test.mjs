import assert from "node:assert/strict";
import test from "node:test";
import { simulateDiceRollReady } from "./dice-physics.js";
import { COLUMN_LENGTHS } from "./rules.js";
import * as engine from "./server/game-engine.mjs";

await engine.initialize();

function readyLobby() {
  const state = engine.createLobby({
    capacity: 2,
    host: { id: "host", name: "Host", connected: true }
  });
  engine.addPlayer(state, { id: "p2", name: "Player 2", connected: true }, { now: 1 });
  return state;
}

function startWithHost(state, now = 100) {
  engine.applyAction(state, "host", { type: "start" }, { now, random: () => 0 });
}

test("game10 lobby membership and management are server rules", () => {
  const state = engine.createLobby({
    capacity: 3,
    host: { id: "host", name: "Host", connected: true }
  });
  engine.addPlayer(state, { id: "p2", name: "Player 2", connected: true });
  assert.throws(
    () => engine.applyAction(state, "p2", { type: "setCapacity", capacity: 2 }),
    (error) => error.code === "host_required" && error.status === 403
  );
  engine.applyAction(state, "host", { type: "setCapacity", capacity: 2 });
  engine.removePlayer(state, "host", "p2");
  assert.equal(state.players.length, 1);
});

test("game10 server selects the first player and owns the action deadline", () => {
  const state = readyLobby();
  startWithHost(state, 1000);
  assert.equal(state.phase, "playing");
  assert.equal(state.currentIndex, 0);
  assert.equal(state.turnStage, "roll");
  assert.equal(state.deadline, 31_000);
  assert.equal(engine.getDeadline(state), 31_000);
  assert.throws(
    () => engine.applyAction(state, "p2", { type: "roll" }, { now: 2000 }),
    (error) => error.code === "not_your_turn"
  );
});

test("game10 server physics produces dice and legal public options", () => {
  const state = readyLobby();
  startWithHost(state);
  engine.applyAction(state, "host", { type: "roll" }, { now: 200, random: () => 0.5 });
  assert.equal(state.turnStage, "rolling");
  assert.equal(state.pendingDice.length, 4);
  assert.equal(state.dice.length, 0);
  assert.ok(state.physicsSeed > 0);
  assert.ok(state.revealAt > 200);
  assert.deepEqual(state.pendingDice, simulateDiceRollReady(state.physicsSeed).results);

  const publicRolling = engine.buildView(state, "p2");
  assert.equal("pendingDice" in publicRolling, false);
  assert.deepEqual(publicRolling.dice, []);
  assert.equal(engine.handleTimeout(state, { now: state.revealAt }), true);
  assert.equal(state.turnStage, "settled");
  assert.equal(state.dice.length, 4);
  assert.ok(state.options.length > 0);
  const settledRevealAt = state.revealAt;
  assert.equal(engine.handleTimeout(state, { now: settledRevealAt }), true);
  assert.equal(state.turnStage, "choose");
  assert.equal(state.deadline, settledRevealAt + engine.ACTION_SECONDS * 1000);
});

test("game10 choice and camp are validated and committed by the server", () => {
  const state = readyLobby();
  startWithHost(state);
  state.turnStage = "choose";
  state.options = [{ key: "6-8", pair: [6, 8], moves: [6, 8] }];
  engine.applyAction(state, "host", { type: "choose", key: "6-8" }, { now: 500 });
  assert.deepEqual(state.turnProgress, { 6: 1, 8: 1 });
  assert.equal(state.turnStage, "decision");
  engine.applyAction(state, "host", { type: "stop" }, { now: 600 });
  assert.deepEqual(state.players[0].progress, { 6: 1, 8: 1 });
  assert.equal(state.currentIndex, 1);
  assert.equal(state.turnStage, "roll");
});

test("game10 timeout chooses, camps and rolls without a connected player", () => {
  const state = readyLobby();
  startWithHost(state);
  engine.setPresence(state, "host", false, { now: 200 });
  state.turnStage = "choose";
  state.options = [{ key: "7-7", pair: [7, 7], moves: [7, 7] }];
  state.deadline = 300;
  assert.equal(engine.handleTimeout(state, { now: 300 }), true);
  assert.equal(state.turnProgress[7], 2);
  assert.equal(state.turnStage, "decision");
  assert.equal(engine.handleTimeout(state, { now: state.deadline }), true);
  assert.equal(state.players[0].progress[7], 2);
  assert.equal(state.currentIndex, 1);
  state.deadline = 1000;
  assert.equal(engine.handleTimeout(state, { now: 1000, random: () => 0.25 }), true);
  assert.equal(state.turnStage, "rolling");
});

test("game10 bust discards temporary progress", () => {
  const state = readyLobby();
  startWithHost(state);
  state.turnProgress = { 7: 5 };
  state.turnStage = "settled";
  state.options = [];
  state.revealAt = 500;
  assert.equal(engine.handleTimeout(state, { now: 500 }), true);
  assert.deepEqual(state.players[0].progress, {});
  assert.deepEqual(state.turnProgress, {});
  assert.equal(state.currentIndex, 1);
});

test("game10 claiming three columns ends the game", () => {
  const state = readyLobby();
  startWithHost(state);
  state.turnStage = "decision";
  state.turnProgress = {
    2: COLUMN_LENGTHS[2],
    3: COLUMN_LENGTHS[3],
    4: COLUMN_LENGTHS[4]
  };
  engine.applyAction(state, "host", { type: "stop" }, { now: 500 });
  assert.equal(state.phase, "ended");
  assert.equal(state.winnerId, "host");
  assert.deepEqual(state.players[0].claimed, [2, 3, 4]);
  assert.deepEqual(state.closed, { 2: "host", 3: "host", 4: "host" });
});

test("game10 persisted state is cloned and version checked", () => {
  const state = readyLobby();
  const serialized = engine.serializeState(state);
  serialized.players[0].name = "Snapshot only";
  assert.equal(state.players[0].name, "Host");
  assert.deepEqual(engine.restoreState(engine.serializeState(state)), state);
  assert.throws(
    () => engine.restoreState({ ...serialized, stateVersion: 999 }),
    /Unsupported game10 state version/
  );
});
