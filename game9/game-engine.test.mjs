import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION_SECONDS,
  SUPPORTS_SPECTATORS,
  GameRuleError,
  addPlayer,
  applyAction,
  buildSpectatorView,
  buildView,
  canChangeSeats,
  createLobby,
  handleTimeout,
  removePlayer,
  setPresence,
  vacateSeat
} from "./server/game-engine.mjs";

const host = { id: "host", name: "房主" };
const makeLobby = (capacity = 3) => createLobby({ capacity, host });

function readyState() {
  const state = makeLobby();
  addPlayer(state, { id: "p2", name: "二号" }, { now: 1 });
  addPlayer(state, { id: "p3", name: "三号" }, { now: 2 });
  for (const player of state.players) setPresence(state, player.id, true, { announce: false });
  return state;
}

test("lobby admission, capacity and host permissions are server rules", () => {
  const state = makeLobby(4);
  addPlayer(state, { id: "p2", name: "二号" }, { now: 10 });
  applyAction(state, "host", { type: "setCapacity", capacity: 3 });
  assert.equal(state.capacity, 3);
  assert.throws(
    () => applyAction(state, "p2", { type: "setCapacity", capacity: 4 }),
    (error) => error instanceof GameRuleError && error.code === "host_required"
  );
  removePlayer(state, "host", "p2", { now: 11 });
  assert.equal(state.players.length, 1);
});

test("the server starts a deterministic game and owns the deadline", () => {
  const state = readyState();
  applyAction(state, "host", { type: "start" }, { now: 1000, random: () => 0 });
  assert.equal(state.phase, "playing");
  assert.equal(state.removed.length, 9);
  assert.equal(state.deck.length, 23);
  assert.equal(state.activeCard != null, true);
  assert.equal(state.deadline, 1000 + ACTION_SECONDS * 1000);
  assert.equal(state.players.every((player) => player.chips === 11), true);
});

test("only the current player can pass or take", () => {
  const state = readyState();
  applyAction(state, "host", { type: "start" }, { now: 1000, random: () => 0 });
  const current = state.players[state.currentIndex];
  const other = state.players.find((player) => player.id !== current.id);
  assert.throws(
    () => applyAction(state, other.id, { type: "pass" }, { now: 2000 }),
    (error) => error.code === "not_your_turn"
  );
  applyAction(state, current.id, { type: "pass" }, { now: 2000 });
  assert.equal(current.chips, 10);
  assert.equal(state.pot, 1);
  assert.equal(state.deadline, 2000 + ACTION_SECONDS * 1000);
});

test("timeout is decided by the server clock and takes the card once", () => {
  const state = readyState();
  applyAction(state, "host", { type: "start" }, { now: 1000, random: () => 0 });
  const current = state.players[state.currentIndex];
  const card = state.activeCard;
  assert.equal(handleTimeout(state, { now: state.deadline - 1 }), false);
  assert.equal(handleTimeout(state, { now: state.deadline }), true);
  assert.deepEqual(current.cards, [card]);
  assert.equal(state.logs.some((entry) => entry.text.includes("超时")), true);
});

test("views hide removed cards and other players' chips until settlement", () => {
  const state = readyState();
  applyAction(state, "host", { type: "start" }, { now: 1000, random: () => 0 });
  const hostView = buildView(state, "host");
  assert.deepEqual(hostView.removed, []);
  assert.equal(hostView.players.find((player) => player.id === "host").chips, 11);
  assert.equal(hostView.players.find((player) => player.id === "p2").chips, null);
  assert.equal(hostView.permissions.canEnd, true);
});

test("a complete server-owned game settles and reveals final information", () => {
  const state = readyState();
  applyAction(state, "host", { type: "start" }, { now: 1000, random: () => 0 });
  let now = 2000;
  while (state.phase === "playing") {
    const current = state.players[state.currentIndex];
    applyAction(state, current.id, { type: "take" }, { now: now += 1 });
  }
  const view = buildView(state, "p2");
  assert.equal(state.phase, "ended");
  assert.equal(state.deck.length, 0);
  assert.equal(view.removed.length, 9);
  assert.equal(view.players.every((player) => player.finalScore != null && player.chips != null), true);
  assert.equal(view.winners.length > 0, true);
  applyAction(state, "host", { type: "restart" }, { now: now + 1 });
  assert.equal(state.phase, "lobby");
  assert.equal(state.players.every((player) => player.cards.length === 0 && player.chips === 0), true);
});

test("presence belongs to server state", () => {
  const state = readyState();
  assert.equal(setPresence(state, "p2", false, { now: 20 }), true);
  assert.equal(state.players.find((player) => player.id === "p2").connected, false);
  assert.match(state.logs[0].text, /暂时离线/);
});

test("spectator view exposes public table data without borrowing any player's private chips", () => {
  const state = readyState();
  applyAction(state, "host", { type: "start" }, { now: 1000, random: () => 0 });
  const current = state.players[state.currentIndex];
  applyAction(state, current.id, { type: "take" }, { now: 2000 });
  const view = buildSpectatorView(state);
  assert.equal(SUPPORTS_SPECTATORS, true);
  assert.equal(view.selfId, null);
  assert.equal(view.activeCard, state.activeCard);
  assert.equal(view.pot, state.pot);
  assert.equal(view.deckCount, state.deck.length);
  assert.deepEqual(view.players.map((player) => player.cards), state.players.map((player) => player.cards));
  assert.equal(view.players.every((player) => player.chips === null), true);
  assert.deepEqual(view.removed, []);
  assert.deepEqual(view.permissions, {
    canManage: false, canKick: false, canStart: false, canEnd: false, canRestart: false
  });
});

test("game9 seats can change only in the real lobby and never vacate the host", () => {
  const state = readyState();
  assert.equal(canChangeSeats(state), true);
  const removed = vacateSeat(state, "p2", { now: 20 });
  assert.equal(removed.id, "p2");
  assert.equal(state.players.some((player) => player.id === "p2"), false);
  assert.throws(
    () => vacateSeat(state, "host", { now: 21 }),
    (error) => error.code === "invalid_seat_target"
  );
  addPlayer(state, { id: "p2", name: "二号" }, { now: 22 });
  setPresence(state, "p2", true, { announce: false });
  applyAction(state, "host", { type: "start" }, { now: 1000, random: () => 0 });
  assert.equal(canChangeSeats(state), false);
  assert.throws(
    () => vacateSeat(state, "p2", { now: 23 }),
    (error) => error.code === "seat_change_unavailable"
  );
});
