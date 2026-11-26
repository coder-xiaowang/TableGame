import assert from "node:assert/strict";
import test from "node:test";
import { COLUMN_LENGTHS } from "./rules.js";
import * as engine from "./server/game-engine.mjs";


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

test("server delivers dice and choices together to players and spectators", () => {
  const state = readyLobby();
  startWithHost(state);
  const rolls = [2, 3, 4, 5];
  engine.applyAction(state, "host", { type: "roll", dice: [6,6,6,6] }, {
    now: 200, random: () => (rolls.shift() - 0.5) / 6
  });
  assert.equal(state.turnStage, "choose");
  assert.equal(state.deadline, 200 + engine.ACTION_SECONDS * 1000);
  for (const view of [engine.buildView(state, "p2"), engine.buildSpectatorView(state)]) {
    assert.deepEqual(view.dice, [2,3,4,5]);
    assert.deepEqual(view.options.map(option => option.moves), [[5,9],[6,8],[7,7]]);
    assert.equal("pendingDice" in view, false);
  }
});

test("a double advances only one step from a saved camp near the summit", () => {
  const state = readyLobby();
  startWithHost(state);
  state.players[0].progress = { 4: 6 };
  engine.applyAction(state, "host", { type: "roll" }, { now: 200, random: () => 0.25 });
  assert.deepEqual(state.options.map(option => option.moves), [[4]]);
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
  assert.equal(state.turnStage, "choose");
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
  const legacy = engine.serializeState(state);
  delete legacy.presentationEvents;
  delete legacy.presentationSequence;
  delete legacy.presentationSceneSequence;
  const restoredLegacy = engine.restoreState(legacy);
  assert.deepEqual(restoredLegacy.presentationEvents, []);
  assert.equal(restoredLegacy.presentationSequence, 0);
  assert.equal(restoredLegacy.presentationSceneSequence, 0);
  assert.throws(
    () => engine.restoreState({ ...serialized, stateVersion: 999 }),
    /Unsupported game10 state version/
  );
});

test("game10 spectator view is public and lobby seat changes are safe", () => {
  const state = readyLobby(2);
  const publicView = engine.buildSpectatorView(state);
  assert.equal(publicView.selfId, null);
  assert.equal(publicView.permissions.canManage, false);
  assert.deepEqual(publicView.players, engine.buildView(state, "host").players);
  assert.equal(engine.canChangeSeats(state), true);
  assert.throws(() => engine.vacateSeat(state, "host"), (error) => error.code === "invalid_seat_change");
  const removed = engine.vacateSeat(state, "p2", { now: 500 });
  assert.equal(removed.id, "p2");
  assert.equal(state.players.length, 1);
  engine.addPlayer(state, { id: "p2", name: "乙", connected: true });
  engine.applyAction(state, "host", { type: "start" }, { now: 1_000, random: () => 0 });
  assert.equal(engine.canChangeSeats(state), false);
  assert.throws(() => engine.vacateSeat(state, "p2"), (error) => error.code === "seat_change_unavailable");
});

test("game10 authoritative presentation follows roll, climb, camp and summit state changes", () => {
  const state = readyLobby();
  startWithHost(state, 100);
  assert.equal(state.presentationEvents.at(-1).kind, "game-start");

  engine.applyAction(state, "host", { type: "roll" }, { now: 200, random: () => 0.5 });
  assert.equal(state.presentationEvents.at(-1).kind, "dice-settled");

  state.turnStage = "choose";
  state.options = [{ key: "6-8", pair: [6, 8], moves: [6, 8] }];
  engine.applyAction(state, "host", { type: "choose", key: "6-8" }, { now: 500 });
  const climb = state.presentationEvents.at(-1);
  assert.equal(climb.kind, "route-chosen");
  assert.deepEqual(climb.columns, [6, 8]);

  engine.applyAction(state, "host", { type: "stop" }, { now: 600 });
  assert.equal(state.presentationEvents.at(-2).kind, "turn-stopped");
  assert.equal(state.presentationEvents.at(-1).kind, "turn-start");

  const spectator = engine.buildSpectatorView(state);
  assert.deepEqual(spectator.presentationEvents, engine.buildView(state, "host").presentationEvents);
});

test("game10 presentation prioritizes bust and groups camp with summit claims", () => {
  const state = readyLobby();
  startWithHost(state, 100);
  state.players[0].progress = { 7: 1 };
  state.turnProgress = { 7: 2, 9: 3 };
  state.turnStage = "settled";
  state.options = [];
  state.revealAt = 300;
  engine.handleTimeout(state, { now: 300 });
  const busted = state.presentationEvents.find((event) => event.kind === "turn-busted");
  assert.equal(busted.priority, 4);
  assert.deepEqual(busted.columns, [7, 9]);
  assert.deepEqual(busted.lostTrails, [{column:7,camp:1,top:2},{column:9,camp:0,top:3}]);
  assert.deepEqual(state.players[0].progress, {7:1});

  state.currentIndex = 0;
  state.turnStage = "decision";
  state.turnProgress = { 2: COLUMN_LENGTHS[2] };
  engine.applyAction(state, "host", { type: "stop" }, { now: 500 });
  const camp = state.presentationEvents.findLast((event) => event.kind === "turn-stopped");
  const summit = state.presentationEvents.findLast((event) => event.kind === "summit-claimed");
  assert.equal(camp.sceneId, summit.sceneId);
  assert.equal(summit.priority, 4);
});

test("game10 presentation sequence stays monotonic across returning to the lobby", () => {
  const state = readyLobby();
  startWithHost(state, 100);
  const previousSequence = state.presentationSequence;
  engine.applyAction(state, "host", { type: "end" }, { now: 200 });
  engine.applyAction(state, "host", { type: "start" }, { now: 300, random: () => 0 });
  assert.ok(state.presentationSequence > previousSequence);
  assert.equal(state.presentationEvents.at(-1).kind, "game-start");
});
