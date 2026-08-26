import assert from "node:assert/strict";
import test from "node:test";
import * as engine from "./server/game-engine.mjs";

function readyLobby(capacity = 2) {
  const state = engine.createLobby({
    capacity,
    host: { id: "host", name: "Host", connected: true }
  });
  engine.addPlayer(state, { id: "p2", name: "Player 2", connected: true });
  return state;
}

test("game8 lobby capacity, membership and host permissions are server rules", () => {
  const state = engine.createLobby({
    capacity: 3,
    host: { id: "host", name: "Host", connected: false }
  });
  engine.addPlayer(state, { id: "p2", name: "Player 2" });
  assert.throws(
    () => engine.applyAction(state, "p2", { type: "setCapacity", capacity: 2 }),
    (error) => error.code === "host_required" && error.status === 403
  );
  assert.throws(
    () => engine.applyAction(state, "host", { type: "setCapacity", capacity: 1 }),
    (error) => error.code === "invalid_capacity"
  );
  engine.applyAction(state, "host", { type: "setCapacity", capacity: 2 });
  assert.equal(state.capacity, 2);
  engine.removePlayer(state, "host", "p2");
  assert.equal(state.players.length, 1);
});

test("game8 server starts deterministically and owns all player actions", () => {
  const state = readyLobby();
  engine.applyAction(state, "host", { type: "start" }, { random: () => 0.25 });
  assert.equal(state.phase, "playing");
  assert.equal(state.game.seed, Math.floor(0.25 * 2 ** 31));
  const actor = state.players[state.game.turn].id;
  const other = state.players.find((player) => player.id !== actor).id;
  assert.throws(
    () => engine.applyAction(state, other, { type: "take", colors: ["red", "blue", "black"] }),
    (error) => error.code === "invalid_game_action" && error.status === 409
  );
  engine.applyAction(state, actor, { type: "take", colors: ["red", "blue", "black"] });
  assert.equal(state.game.players[state.game.turn].tokens.red, 1);
});

test("game8 views hide deck order and opponents' reserved cards", () => {
  const state = readyLobby();
  engine.applyAction(state, "host", { type: "start" }, { random: () => 0.5 });
  const actorSeat = state.game.turn;
  const actorId = state.players[actorSeat].id;
  const otherId = state.players[(actorSeat + 1) % state.players.length].id;
  const cardId = state.game.field.stage1.find(Boolean);
  engine.applyAction(state, actorId, { type: "reserve", target: { fromField: cardId } });

  const ownView = engine.buildView(state, actorId);
  const otherView = engine.buildView(state, otherId);
  assert.equal(ownView.game.players[actorSeat].reserve[0], cardId);
  assert.deepEqual(otherView.game.players[actorSeat].reserve[0], {
    hidden: true,
    tier: "stage1"
  });
  assert.ok(ownView.game.decks.stage1.every((card) => card === null));
  assert.equal("byId" in ownView.game, false);
  assert.equal("cardDB" in ownView.game, false);
});

test("game8 persistence strips and restores static card data", () => {
  const state = readyLobby();
  engine.applyAction(state, "host", { type: "start" }, { random: () => 0.75 });
  const serialized = engine.serializeState(state);
  assert.equal(serialized.stateVersion, 1);
  assert.equal("byId" in serialized.game, false);
  assert.equal("cardDB" in serialized.game, false);

  const restored = engine.restoreState(serialized);
  assert.equal(restored.game.cardDB.length, 100);
  assert.ok(restored.game.byId[restored.game.field.stage1.find(Boolean)]);
  const actorId = restored.players[restored.game.turn].id;
  const cardId = restored.game.field.stage1.find(Boolean);
  engine.applyAction(restored, actorId, { type: "reserve", target: { fromField: cardId } });
  assert.equal(restored.game.players[restored.game.turn].reserve[0], cardId);
});

test("game8 host can end a game while guests cannot", () => {
  const state = readyLobby();
  engine.applyAction(state, "host", { type: "start" }, { random: () => 0.1 });
  assert.throws(
    () => engine.applyAction(state, "p2", { type: "end" }),
    (error) => error.code === "host_required"
  );
  engine.applyAction(state, "host", { type: "end" });
  assert.equal(state.phase, "lobby");
  assert.equal(state.game, null);
});
