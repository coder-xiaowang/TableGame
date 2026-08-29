import assert from "node:assert/strict";
import test from "node:test";
import * as engine from "./server/game-engine.mjs";

const noShuffle = () => 0.999999;

function startedState(count = 2) {
  const state = engine.createLobby({ capacity: count, host: { id: "p1", name: "甲", connected: true } });
  for (let index = 2; index <= count; index += 1) engine.addPlayer(state, { id: `p${index}`, name: `玩家${index}`, connected: true });
  engine.applyAction(state, "p1", { type: "start" }, { now: 1000, random: noShuffle });
  return state;
}

function give(state, player, color, number, handIndex) {
  let source = state.pool;
  let sourceIndex = source.findIndex((tile) => !tile.joker && tile.color === color && tile.number === number);
  if (sourceIndex < 0) {
    const owner = state.players.find((candidate) => candidate.id !== player.id
      && candidate.hand.some((tile) => !tile.joker && tile.color === color && tile.number === number));
    assert.ok(owner, `${color} ${number} should exist outside the target rack slot`);
    source = owner.hand;
    sourceIndex = source.findIndex((tile) => !tile.joker && tile.color === color && tile.number === number);
  }
  [source[sourceIndex], player.hand[handIndex]] = [player.hand[handIndex], source[sourceIndex]];
  return player.hand[handIndex];
}

function tableLayout(state, additions = []) {
  return [
    ...state.table.map((meld) => ({ id: meld.id, kind: meld.kind, tileIds: meld.tiles.map((tile) => tile.id) })),
    ...additions
  ];
}

test("server deals fourteen private tiles and rotates fixed starters", () => {
  const state = startedState(3);
  assert.ok(state.players.every((player) => player.hand.length === 14));
  assert.equal(state.pool.length, 64);
  assert.equal(state.currentIndex, 0);
  state.phase = "gameEnd";
  engine.applyAction(state, "p1", { type: "nextGame" }, { now: 2000, random: noShuffle });
  assert.equal(state.gameNumber, 2);
  assert.equal(state.currentIndex, 1);
  state.phase = "gameEnd";
  engine.applyAction(state, "p1", { type: "nextGame" }, { now: 3000, random: noShuffle });
  assert.equal(state.gameNumber, 3);
  assert.equal(state.currentIndex, 2);
  engine.validateState(state);
});

test("initial meld uses only rack tiles and totals at least thirty", () => {
  const state = startedState();
  const actor = state.players[0];
  const cards = [give(state, actor, "red", 10, 0), give(state, actor, "blue", 10, 1), give(state, actor, "black", 10, 2)];
  engine.applyAction(state, actor.id, {
    type: "commitLayout",
    layout: [{ kind: "group", tileIds: cards.map((tile) => tile.id) }]
  }, { now: 2000 });
  assert.equal(actor.opened, true);
  assert.equal(actor.hand.length, 11);
  assert.equal(state.table.length, 1);
  assert.equal(state.currentIndex, 1);
  engine.validateState(state);
});

test("initial meld below thirty is rejected without changing authoritative state", () => {
  const state = startedState();
  const actor = state.players[0];
  const cards = [give(state, actor, "red", 7, 0), give(state, actor, "blue", 7, 1), give(state, actor, "black", 7, 2)];
  assert.throws(() => engine.applyAction(state, actor.id, {
    type: "commitLayout", layout: [{ kind: "group", tileIds: cards.map((tile) => tile.id) }]
  }, { now: 2000 }), (error) => error.code === "initial_score_low");
  assert.equal(actor.opened, false);
  assert.equal(state.table.length, 0);
});

test("unopened player cannot extend or reorganize the existing public table", () => {
  const state = startedState();
  const host = state.players[0];
  const opening = [give(state, host, "red", 10, 0), give(state, host, "blue", 10, 1), give(state, host, "black", 10, 2)];
  engine.applyAction(state, host.id, {
    type: "commitLayout", layout: [{ kind: "group", tileIds: opening.map((tile) => tile.id) }]
  }, { now: 2000 });
  const guest = state.players[1];
  const orange = give(state, guest, "orange", 10, 0);
  assert.equal(guest.opened, false);
  assert.throws(() => engine.applyAction(state, guest.id, {
    type: "commitLayout",
    layout: [{ kind: "group", tileIds: [...state.table[0].tiles.map((tile) => tile.id), orange.id] }]
  }, { now: 3000 }), (error) => error.code === "initial_table_locked");
  assert.equal(guest.hand.some((tile) => tile.id === orange.id), true);
});

test("opened player may reorganize table but may never return a table tile to hand", () => {
  const state = startedState();
  const actor = state.players[0];
  actor.opened = true;
  const base = [give(state, actor, "red", 5, 0), give(state, actor, "red", 6, 1), give(state, actor, "red", 7, 2)];
  engine.applyAction(state, actor.id, { type: "commitLayout", layout: [{ kind: "run", tileIds: base.map((tile) => tile.id) }] }, { now: 2000 });
  state.currentIndex = 1;
  state.players[1].opened = true;
  const added = give(state, state.players[1], "red", 8, 0);
  const oldIds = state.table[0].tiles.map((tile) => tile.id);
  engine.applyAction(state, "p2", { type: "commitLayout", layout: [{ kind: "run", tileIds: [...oldIds, added.id] }] }, { now: 3000 });
  assert.ok(state.lastChange.tileIds.includes(added.id));
  state.currentIndex = 0;
  assert.throws(() => engine.applyAction(state, "p1", {
    type: "commitLayout", layout: [{ kind: "run", tileIds: state.table[0].tiles.slice(1).map((tile) => tile.id) }]
  }, { now: 4000 }), (error) => error.code === "table_tile_missing");
  engine.validateState(state);
});

test("timeout draws three after editing and one without editing", () => {
  const state = startedState();
  const first = state.players[0];
  const firstPool = state.pool.length;
  engine.applyAction(state, first.id, { type: "beginEdit" }, { now: 2000 });
  assert.equal(engine.handleTimeout(state, { now: state.deadline }), true);
  assert.equal(first.hand.length, 17);
  assert.equal(state.pool.length, firstPool - 3);
  const second = state.players[1];
  engine.handleTimeout(state, { now: state.deadline });
  assert.equal(second.hand.length, 15);
});

test("empty pool ends only after every player consecutively declares no play", () => {
  const state = startedState();
  state.players[0].hand.push(...state.pool.splice(0));
  engine.applyAction(state, "p1", { type: "passEmpty" }, { now: 2000 });
  assert.equal(state.phase, "playing");
  engine.applyAction(state, "p2", { type: "passEmpty" }, { now: 3000 });
  assert.equal(state.phase, "gameEnd");
  assert.equal(state.gameResult.reason, "blocked");
  engine.validateState(state);
});

test("playing the last rack tile ends a game and applies zero-sum scoring", () => {
  const state = startedState();
  const actor = state.players[0];
  actor.opened = true;
  const winning = [give(state, actor, "red", 12, 0), give(state, actor, "blue", 12, 1), give(state, actor, "black", 12, 2)];
  state.pool.push(...actor.hand.splice(3));
  const opponentPenalty = state.players[1].hand.reduce((total, tile) => total + (tile.joker ? 30 : tile.number), 0);
  engine.applyAction(state, actor.id, {
    type: "commitLayout", layout: [{ kind: "group", tileIds: winning.map((tile) => tile.id) }]
  }, { now: 2000 });
  assert.equal(state.phase, "gameEnd");
  assert.equal(state.gameResult.winnerIds[0], actor.id);
  assert.equal(actor.score, opponentPenalty);
  assert.equal(state.players[1].score, -opponentPenalty);
  engine.validateState(state);
});

test("views expose only the viewer rack while the table is public", () => {
  const state = startedState();
  const hostView = engine.buildView(state, "p1");
  const guestView = engine.buildView(state, "p2");
  assert.equal(hostView.hand.length, 14);
  assert.equal(guestView.hand.length, 14);
  assert.notDeepEqual(hostView.hand.map((tile) => tile.id), guestView.hand.map((tile) => tile.id));
  assert.equal(hostView.players.some((player) => "hand" in player), false);
  assert.equal(hostView.players[1].handCount, 14);
});
