import assert from "node:assert/strict";
import test from "node:test";
import * as engine from "./server/game-engine.mjs";

const noShuffle = () => 0.999999;

function startedState() {
  const state = engine.createLobby({ capacity: 2, host: { id: "p1", name: "甲", connected: true } });
  engine.addPlayer(state, { id: "p2", name: "乙", connected: true });
  engine.applyAction(state, "p1", { type: "start" }, { now: 1000, random: noShuffle });
  state.currentIndex = 0;
  return state;
}

function startedStateFor(playerCount) {
  const state = engine.createLobby({ capacity: playerCount, host: { id: "p1", name: "玩家1", connected: true } });
  for (let index = 2; index <= playerCount; index += 1) {
    engine.addPlayer(state, { id: `p${index}`, name: `玩家${index}`, connected: true });
  }
  engine.applyAction(state, "p1", { type: "start" }, { now: 1000, random: noShuffle });
  return state;
}

function giveFromDeck(state, player, type, handIndex = 0) {
  const index = state.deck.findIndex((card) => card.type === type);
  assert.notEqual(index, -1, `deck should contain ${type}`);
  [state.deck[index], player.hand[handIndex]] = [player.hand[handIndex], state.deck[index]];
  return player.hand[handIndex];
}

function play(state, playerId, card, targetPlayerId, targetPigId, now = 2000) {
  engine.applyAction(state, playerId, {
    type: "playCard",
    cardId: card.id,
    targetPlayerId,
    targetPigId
  }, { now, random: noShuffle });
}

test("server owns all action cards and sends each player only their own hand", () => {
  const state = startedState();
  engine.validateState(state);
  const hostView = engine.buildView(state, "p1");
  const guestView = engine.buildView(state, "p2");
  assert.equal(hostView.hand.length, 3);
  assert.equal(guestView.hand.length, 3);
  assert.notDeepEqual(hostView.hand.map((card) => card.id), guestView.hand.map((card) => card.id));
  assert.equal(hostView.players.some((player) => "hand" in player), false);
  assert.equal(hostView.players[1].handCount, 3);
});

test("five and six player games use three pigs each and the 57-card expanded action deck", () => {
  for (const count of [5, 6]) {
    const state = startedStateFor(count);
    assert.equal(state.players.length, count);
    assert.ok(state.players.every((player) => player.pigs.length === 3 && player.hand.length === 3));
    const allCards = state.deck.length + state.discard.length
      + state.players.reduce((total, player) => total + player.hand.length, 0);
    assert.equal(allCards, 57);
    engine.validateState(state);
  }
});

test("mud, rain, barn, farmer, door, rod and lightning obey the original protection chain", () => {
  const state = startedState();
  const host = state.players[0];
  const guest = state.players[1];
  const pig = host.pigs[0];

  const mud = giveFromDeck(state, host, "mud");
  play(state, host.id, mud, host.id, pig.id);
  assert.equal(pig.dirty, true);

  state.currentIndex = 0;
  const barn = giveFromDeck(state, host, "barn");
  play(state, host.id, barn, host.id, pig.id, 3000);
  assert.ok(pig.barn);

  state.currentIndex = 1;
  const rain = giveFromDeck(state, guest, "rain");
  play(state, guest.id, rain, null, null, 4000);
  assert.equal(pig.dirty, true, "barn protects against rain");

  state.currentIndex = 0;
  const door = giveFromDeck(state, host, "door");
  play(state, host.id, door, host.id, pig.id, 5000);
  assert.ok(pig.door);

  state.currentIndex = 1;
  const farmer = giveFromDeck(state, guest, "farmer");
  assert.throws(
    () => play(state, guest.id, farmer, host.id, pig.id, 6000),
    (error) => error.code === "card_not_playable"
  );

  state.currentIndex = 0;
  const rod = giveFromDeck(state, host, "rod");
  play(state, host.id, rod, host.id, pig.id, 7000);
  assert.ok(pig.rod);
  assert.equal(engine.buildView(state, "p1").players[0].pigs[0].completelySafe, true);

  state.currentIndex = 1;
  const lightning = giveFromDeck(state, guest, "lightning");
  assert.throws(
    () => play(state, guest.id, lightning, host.id, pig.id, 8000),
    (error) => error.code === "card_not_playable"
  );
  engine.validateState(state);
});

test("farmer enters an ordinary barn, while lightning removes barn and door without changing the pig", () => {
  const state = startedState();
  const host = state.players[0];
  const guest = state.players[1];
  const pig = host.pigs[0];

  state.currentIndex = 0;
  play(state, host.id, giveFromDeck(state, host, "mud"), host.id, pig.id, 2000);
  state.currentIndex = 0;
  play(state, host.id, giveFromDeck(state, host, "barn"), host.id, pig.id, 3000);
  state.currentIndex = 1;
  play(state, guest.id, giveFromDeck(state, guest, "farmer"), host.id, pig.id, 4000);
  assert.equal(pig.dirty, false, "farmer can enter a barn without a door");

  state.currentIndex = 0;
  play(state, host.id, giveFromDeck(state, host, "mud"), host.id, pig.id, 5000);
  state.currentIndex = 0;
  play(state, host.id, giveFromDeck(state, host, "door"), host.id, pig.id, 6000);
  state.currentIndex = 1;
  play(state, guest.id, giveFromDeck(state, guest, "lightning"), host.id, pig.id, 7000);
  assert.equal(pig.dirty, true);
  assert.equal(pig.barn, null);
  assert.equal(pig.door, null);

  state.currentIndex = 1;
  play(state, guest.id, giveFromDeck(state, guest, "rain"), null, null, 8000);
  assert.equal(pig.dirty, false, "rain washes the now-exposed pig");
  engine.validateState(state);
});

test("the first player whose pigs are all dirty wins immediately before drawing", () => {
  const state = startedState();
  const actor = state.players[0];
  for (const pig of actor.pigs) {
    state.currentIndex = 0;
    play(state, actor.id, giveFromDeck(state, actor, "mud"), actor.id, pig.id, 2000);
  }
  assert.equal(state.phase, "ended");
  assert.equal(state.winnerId, actor.id);
  assert.equal(state.deadline, 0);
  assert.equal(actor.hand.length, 2, "winning action ends the game before replenishing the hand");
  engine.validateState(state);
});

test("any card may be discarded without effect", () => {
  const state = startedState();
  const actor = state.players[0];
  const rain = giveFromDeck(state, actor, "rain");
  const dirtyBefore = state.players.flatMap((player) => player.pigs).filter((pig) => pig.dirty).length;
  engine.applyAction(state, actor.id, { type: "discardCard", cardId: rain.id }, { now: 2000, random: noShuffle });
  assert.equal(state.players.flatMap((player) => player.pigs).filter((pig) => pig.dirty).length, dirtyBefore);
  assert.equal(actor.hand.length, 3);
});

test("three-card exchange is allowed only when every card has no legal effect and is publicly revealed", () => {
  const state = startedState();
  const actor = state.players[0];
  for (let index = 0; index < 3; index += 1) giveFromDeck(state, actor, "rod", index);
  const before = actor.hand.map((card) => card.id);
  const view = engine.buildView(state, actor.id);
  assert.equal(view.permissions.canExchange, true);
  engine.applyAction(state, actor.id, { type: "exchangeHand" }, { now: 2000, random: noShuffle });
  assert.equal(actor.hand.length, 3);
  assert.deepEqual(state.revealedExchange.cards.map((card) => card.id), before);
  assert.deepEqual(engine.buildView(state, "p2").revealedExchange.cards.map((card) => card.id), before);

  state.currentIndex = 1;
  const guest = state.players[1];
  giveFromDeck(state, guest, "rain");
  assert.equal(engine.buildView(state, guest.id).permissions.canExchange, false);
  assert.throws(
    () => engine.applyAction(state, guest.id, { type: "exchangeHand" }, { now: 3000, random: noShuffle }),
    (error) => error.code === "exchange_not_allowed"
  );
});

test("turn timeout discards one card without applying its effect", () => {
  const state = startedState();
  const actor = state.players[0];
  const firstId = actor.hand[0].id;
  const deadline = state.deadline;
  assert.equal(engine.handleTimeout(state, { now: deadline - 1, random: noShuffle }), false);
  assert.equal(engine.handleTimeout(state, { now: deadline, random: noShuffle }), true);
  assert.equal(actor.hand.length, 3);
  assert.equal(state.discard.some((card) => card.id === firstId), true);
  assert.equal(state.currentIndex, 1);
});
