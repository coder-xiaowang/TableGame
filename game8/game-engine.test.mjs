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
  const actorSeat = state.game.turn;
  const actor = state.players[actorSeat].id;
  const other = state.players.find((player) => player.id !== actor).id;
  assert.throws(
    () => engine.applyAction(state, other, { type: "take", colors: ["red", "blue", "black"] }),
    (error) => error.code === "invalid_game_action" && error.status === 409
  );
  engine.applyAction(state, actor, { type: "take", colors: ["red", "blue", "black"] });
  assert.equal(state.game.players[actorSeat].tokens.red, 1);
  assert.notEqual(state.game.turn, actorSeat);
});

test("game8 waits for mandatory discards, then automatically ends when no evolution remains", () => {
  const state = readyLobby();
  engine.applyAction(state, "host", { type: "start" }, { random: () => 0.33 });
  const actorSeat = state.game.turn;
  const actorId = state.players[actorSeat].id;
  const actor = state.game.players[actorSeat];
  actor.tokens.red = 10;
  const cardId = state.game.field.stage1.find(Boolean);
  engine.applyAction(state, actorId, { type: "reserve", target: { fromField: cardId } });
  assert.equal(state.game.turn, actorSeat);
  assert.equal(state.game.acted, true);
  assert.equal(actor.tokens.purple, 1);
  assert.equal(actor.tokens.red + actor.tokens.purple, 11);
  engine.applyAction(state, actorId, { type: "discard", color: "red" });
  assert.notEqual(state.game.turn, actorSeat);
  assert.equal(state.game.acted, false);
});

test("game8 automatically ends ordinary reserve and capture actions with no follow-up decision", () => {
  const reserveState = readyLobby();
  engine.applyAction(reserveState, "host", { type: "start" }, { random: () => 0.36 });
  const reserveSeat = reserveState.game.turn;
  const reserveActorId = reserveState.players[reserveSeat].id;
  const reserveId = reserveState.game.field.stage1.find(Boolean);
  engine.applyAction(reserveState, reserveActorId, { type: "reserve", target: { fromField: reserveId } });
  assert.notEqual(reserveState.game.turn, reserveSeat);
  assert.equal(reserveState.game.players[reserveSeat].reserve[0], reserveId);

  const captureState = readyLobby();
  engine.applyAction(captureState, "host", { type: "start" }, { random: () => 0.38 });
  const captureSeat = captureState.game.turn;
  const captureActorId = captureState.players[captureSeat].id;
  const targetId = captureState.game.field.stage3.find((id) => {
    const item = engine.cardDatabase.find((candidate) => candidate.id === id);
    return item && !item.evolvesTo && Object.values(item.cost).reduce((sum,value) => sum+value,0) <= 10;
  });
  assert.ok(targetId);
  const target = engine.cardDatabase.find((item) => item.id === targetId);
  for (const color of ["red","blue","black","pink","yellow","purple"]) {
    captureState.game.players[captureSeat].tokens[color] = target.cost[color] || 0;
  }
  engine.applyAction(captureState, captureActorId, { type: "capture", cardId: targetId });
  assert.notEqual(captureState.game.turn, captureSeat);
  assert.ok(captureState.game.players[captureSeat].board.includes(targetId));
});

test("game8 pauses for an available evolution and automatically ends after evolving", () => {
  const state = readyLobby();
  engine.applyAction(state, "host", { type: "start" }, { random: () => 0.41 });
  const actorSeat = state.game.turn;
  const actorId = state.players[actorSeat].id;
  const actor = state.game.players[actorSeat];
  const source = engine.cardDatabase.find((item) => item.evolvesTo && item.evoCost);
  const target = engine.cardDatabase.find((item) => item.name === source.evolvesTo);
  actor.board = [source.id];
  let bonusCount = source.bonus === source.evoCost.color ? (source.bonusCount || 1) : 0;
  const bonusCards = engine.cardDatabase
    .filter((item) => item.id !== source.id && item.id !== target.id && item.bonus === source.evoCost.color)
    .sort((left,right) => left.vp-right.vp);
  for (const item of bonusCards) {
    if (bonusCount >= source.evoCost.count) break;
    actor.board.push(item.id);
    bonusCount += item.bonusCount || 1;
  }
  assert.ok(bonusCount >= source.evoCost.count);
  state.game.field[target.tier][0] = target.id;
  engine.applyAction(state, actorId, { type: "take", colors: ["red", "blue", "black"] });
  assert.equal(state.game.turn, actorSeat);
  assert.equal(state.game.acted, true);
  engine.applyAction(state, actorId, { type: "evolve", fromId: source.id, toId: target.id });
  assert.notEqual(state.game.turn, actorSeat);
  assert.ok(actor.buried.includes(source.id));
  assert.ok(actor.board.includes(target.id));
});

test("game8 views expose market reserves but hide deck reserves and deck order", () => {
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
  assert.equal(otherView.game.players[actorSeat].reserve[0], cardId);

  const secretState = readyLobby();
  engine.applyAction(secretState, "host", { type: "start" }, { random: () => 0.5 });
  const secretSeat = secretState.game.turn;
  const secretActorId = secretState.players[secretSeat].id;
  const secretOtherId = secretState.players[(secretSeat + 1) % secretState.players.length].id;
  engine.applyAction(secretState, secretActorId, { type: "reserve", target: { fromDeck: "stage1" } });
  assert.deepEqual(engine.buildView(secretState, secretOtherId).game.players[secretSeat].reserve[0], {
    hidden: true,
    tier: "stage1"
  });
  assert.ok(ownView.game.decks.stage1.every((card) => card === null));
  assert.equal("seed" in ownView.game, false);
  assert.equal("byId" in ownView.game, false);
  assert.equal("cardDB" in ownView.game, false);
});

test("game8 spectator view is public-only and seats can change only in the lobby", () => {
  const lobby = readyLobby();
  const lobbyView = engine.buildSpectatorView(lobby);
  assert.equal(engine.SUPPORTS_SPECTATORS, true);
  assert.equal(lobbyView.selfId, null);
  assert.equal(lobbyView.viewerId, null);
  assert.equal(lobbyView.permissions.canManage, false);
  assert.equal(engine.canChangeSeats(lobby), true);
  assert.throws(
    () => engine.vacateSeat(lobby, "host"),
    (error) => error.code === "invalid_seat_target" && error.status === 403
  );
  assert.equal(engine.vacateSeat(lobby, "p2").id, "p2");
  assert.equal(lobby.players.length, 1);

  const state = readyLobby();
  engine.applyAction(state, "host", { type: "start" }, { random: () => 0.5 });
  const actorSeat = state.game.turn;
  const actorId = state.players[actorSeat].id;
  engine.applyAction(state, actorId, { type: "reserve", target: { fromDeck: "stage1" } });
  const spectator = engine.buildSpectatorView(state);
  assert.equal(spectator.game.viewerId, null);
  assert.equal("seed" in spectator.game, false);
  assert.ok(spectator.game.decks.stage1.every((card) => card === null));
  assert.deepEqual(spectator.game.players[actorSeat].reserve[0], { hidden: true, tier: "stage1" });
  assert.deepEqual(spectator.game.players[actorSeat].reserveVisibility, {});
  assert.ok(Object.values(spectator.permissions).every((allowed) => allowed === false));
  assert.equal(engine.canChangeSeats(state), false);
  assert.throws(
    () => engine.vacateSeat(state, state.players.find((player) => !player.isHost).id),
    (error) => error.code === "seat_change_unavailable" && error.status === 409
  );

  const publicState = readyLobby();
  engine.applyAction(publicState, "host", { type: "start" }, { random: () => 0.51 });
  const publicSeat = publicState.game.turn;
  const publicActorId = publicState.players[publicSeat].id;
  const publicCardId = publicState.game.field.stage1.find(Boolean);
  engine.applyAction(publicState, publicActorId, { type: "reserve", target: { fromField: publicCardId } });
  assert.equal(engine.buildSpectatorView(publicState).game.players[publicSeat].reserve[0], publicCardId);
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
  const actorSeat = restored.game.turn;
  const actorId = restored.players[actorSeat].id;
  const cardId = restored.game.field.stage1.find(Boolean);
  engine.applyAction(restored, actorId, { type: "reserve", target: { fromField: cardId } });
  assert.equal(restored.game.players[actorSeat].reserve[0], cardId);
  const persistedAgain = engine.restoreState(engine.serializeState(restored));
  const otherId = persistedAgain.players.find((player) => player.id !== actorId).id;
  assert.equal(engine.buildView(persistedAgain, otherId).game.players[actorSeat].reserve[0], cardId);

  const legacy = engine.serializeState(restored);
  delete legacy.game.players[actorSeat].reserveVisibility;
  const restoredLegacy = engine.restoreState(legacy);
  assert.equal(engine.buildView(restoredLegacy, otherId).game.players[actorSeat].reserve[0].hidden,true);
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
