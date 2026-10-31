import test from "node:test";
import assert from "node:assert/strict";
import {
  GameRuleError, addPlayer, applyAction, buildSpectatorView, buildView, createLobby,
  handleTimeout, restoreState, serializeState, setPresence, validateState
} from "./server/game-engine.mjs";

function lobby(capacity = 3) {
  const state = createLobby({ capacity, host: { id: "host", name: "房主", connected: true } });
  for (let index = 2; index <= capacity; index += 1) addPlayer(state, { id: `p${index}`, name: `玩家${index}`, connected: true });
  return state;
}

test("服务器开局、洗牌、发底牌并保持52张牌守恒", () => {
  const state = lobby(4);
  applyAction(state, "host", { type: "start" }, { now: 1000, random: () => 0.37 });
  assert.equal(state.phase, "playing");
  assert.equal(state.handNumber, 1);
  assert.equal(state.players.every((player) => player.hole.length === 2), true);
  assert.equal(state.deck.length, 44);
  assert.equal(state.players.reduce((sum, player) => sum + player.chips + player.totalBet, 0), 4000);
  assert.equal(validateState(state), true);
});

test("每名玩家只收到自己的底牌，旁观者看不到任何未公开底牌", () => {
  const state = lobby(3);
  applyAction(state, "host", { type: "start" }, { now: 1000, random: () => 0.42 });
  const host = buildView(state, "host");
  assert.equal(host.players[0].hole.every(Boolean), true);
  assert.equal(host.players.slice(1).every((player) => player.hole.every((card) => card === null)), true);
  assert.equal(buildSpectatorView(state).players.every((player) => player.hole.every((card) => card === null)), true);
  assert.equal("deck" in host, false);
  assert.equal("burned" in host, false);
});

test("服务端拒绝越权行动和非法过牌", () => {
  const state = lobby(3);
  applyAction(state, "host", { type: "start" }, { now: 1000, random: () => 0.18 });
  const current = state.players[state.currentIndex];
  const other = state.players.find((player) => player.id !== current.id);
  assert.throws(() => applyAction(state, other.id, { type: "fold" }), (error) => error instanceof GameRuleError && error.code === "not_your_turn");
  if (state.currentBet > current.streetBet) {
    assert.throws(() => applyAction(state, current.id, { type: "check" }), (error) => error.code === "cannot_check");
  }
});

test("超时由服务器自动过牌或弃牌并推进状态", () => {
  const state = lobby(2);
  applyAction(state, "host", { type: "start" }, { now: 1000, random: () => 0.23 });
  const actor = state.players[state.currentIndex];
  const owed = state.currentBet - actor.streetBet;
  const previousDeadline = state.deadline;
  assert.equal(handleTimeout(state, { now: previousDeadline + 1, random: () => 0.23 }), true);
  if (owed > 0) assert.equal(actor.folded, true);
  assert.notEqual(state.deadline, previousDeadline);
  assert.equal(validateState(state), true);
});

test("服务器能够从翻牌前完整推进到河牌摊牌并分配底池", () => {
  const state = lobby(2);
  applyAction(state, "host", { type: "start" }, { now: 1000, random: () => 0.41 });
  let now = 2000;
  let guard = 0;
  while (state.phase === "playing" && guard < 20) {
    const actor = state.players[state.currentIndex];
    const owed = state.currentBet - actor.streetBet;
    applyAction(state, actor.id, { type: owed > 0 ? "call" : "check" }, { now: now += 100 });
    guard += 1;
  }
  assert.equal(state.phase, "handResult");
  assert.equal(state.showdown, true);
  assert.equal(state.board.length, 5);
  assert.equal(state.handWinners.length > 0, true);
  assert.equal(state.showdownResults.length, 2);
  assert.equal(state.showdownResults.every((result) => result.bestFive.length === 5 && result.rankName), true);
  assert.equal(state.handWinners.every((pot) => pot.potLabel && pot.payouts.length > 0), true);
  assert.equal(state.handWinners.reduce((sum, pot) => sum + pot.payouts.reduce((part, payout) => part + payout.amount, 0), 0), 40);
  const publicView = buildView(state, "host");
  assert.equal(publicView.showdownResults.every((result) => result.bestFive.length === 5), true);
  assert.equal(state.players.reduce((sum, player) => sum + player.chips, 0), 2000);
  assert.equal(validateState(state), true);
});

test("恢复旧快照时补齐摊牌演出字段", () => {
  const state = lobby(2);
  delete state.showdownResults;
  state.handWinners = [{ potIndex: 0, ids: ["host"], amount: 20, rankName: "其他玩家均弃牌" }];
  const restored = restoreState(state);
  assert.deepEqual(restored.showdownResults, []);
  assert.equal(restored.handWinners[0].potLabel, "底池");
  assert.deepEqual(restored.handWinners[0].payouts, [{ playerId: "host", amount: 0 }]);
});

test("掉线状态、房间快照和恢复都由服务端状态承载", () => {
  const state = lobby(3);
  applyAction(state, "host", { type: "start" }, { now: 1000, random: () => 0.31 });
  const target = state.players.find((player) => player.id !== state.players[state.currentIndex].id);
  setPresence(state, target.id, false, { now: 2000 });
  assert.equal(target.connected, false);
  assert.equal(target.folded, false, "掉线只改变连接状态，轮到该玩家时仍由权威倒计时兜底");
  const restored = restoreState(serializeState(state));
  assert.deepEqual(restored, state);
});

test("房主可以结束锦标赛返回准备大厅", () => {
  const state = lobby(2);
  applyAction(state, "host", { type: "start" }, { now: 1000, random: () => 0.27 });
  applyAction(state, "host", { type: "end" }, { now: 2000 });
  assert.equal(state.phase, "lobby");
  assert.equal(state.players.every((player) => player.chips === 1000 && player.hole.length === 0), true);
});
