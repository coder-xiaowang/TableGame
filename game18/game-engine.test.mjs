import assert from "node:assert/strict";
import test from "node:test";
import { CARDS } from "./rules.mjs";
import {
  GameRuleError, addPlayer, applyAction, buildSpectatorView, buildView,
  createLobby, handleTimeout, restoreState, serializeState, setPresence, validateState
} from "./server/game-engine.mjs";

function randomSource(seed = 17) {
  let value = seed >>> 0;
  return () => ((value = (value * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function startedState(count = 3, targetScore = 5) {
  const state = createLobby({ capacity: count, host: { id: "p1", name: "甲", connected: true } });
  for (let index = 2; index <= count; index += 1) addPlayer(state, { id: `p${index}`, name: `玩家${index}`, connected: true });
  applyAction(state, "p1", { type: "setTargetScore", targetScore });
  applyAction(state, "p1", { type: "start" }, { now: 1_000, random: randomSource() });
  const discoverer = state.players.find((player) => player.id === state.pending.actorId);
  applyAction(state, discoverer.id, { type: "submitCase", text: "失踪的布丁案" }, { now: 2_000 });
  return state;
}

function giveType(state, receiver, type) {
  if (receiver.hand.some((card) => card.type === type)) return receiver.hand.find((card) => card.type === type);
  const owner = state.players.find((player) => player.hand.some((card) => card.type === type));
  const wantedIndex = owner.hand.findIndex((card) => card.type === type);
  const replacement = receiver.hand[0];
  const wanted = owner.hand[wantedIndex];
  receiver.hand[0] = wanted;
  owner.hand[wantedIndex] = replacement;
  return wanted;
}

function removeTypeFrom(state, player, type) {
  const index = player.hand.findIndex((card) => card.type === type);
  if (index < 0) return;
  const recipient = state.players.find((candidate) => candidate.id !== player.id && !candidate.hand.some((card) => card.type === type));
  const replacement = recipient.hand[0];
  recipient.hand[0] = player.hand[index];
  player.hand[index] = replacement;
}

test("开局由第一发现者描述案件并进入下一名玩家回合", () => {
  const state = createLobby({ capacity: 3, host: { id: "p1", name: "甲", connected: true } });
  addPlayer(state, { id: "p2", name: "乙", connected: true });
  addPlayer(state, { id: "p3", name: "丙", connected: true });
  applyAction(state, "p1", { type: "start" }, { now: 100, random: randomSource(2) });
  assert.equal(state.phase, "caseStory");
  const discoverer = state.players.find((player) => player.id === state.pending.actorId);
  assert.ok(discoverer.hand.some((card) => card.type === CARDS.DISCOVERER));
  applyAction(state, discoverer.id, { type: "submitCase", text: "  消失的蛋糕  " }, { now: 200 });
  assert.equal(state.caseText, "消失的蛋糕");
  assert.equal(state.phase, "turn");
  assert.equal(discoverer.turnsTaken, 1);
  assert.ok(state.discard.some((card) => card.type === CARDS.DISCOVERER));
  validateState(state);
});

test("旁观者和其他玩家看不到私人手牌", () => {
  const state = startedState();
  const p1 = buildView(state, "p1");
  const spectator = buildSpectatorView(state);
  assert.ok(p1.players.find((player) => player.id === "p1").hand.every((card) => card.type));
  assert.ok(p1.players.find((player) => player.id === "p2").hand.every((card) => card.type === null));
  assert.ok(spectator.players.every((player) => player.hand.every((card) => card.type === null)));
});

test("侦探第一圈无效，第二圈能抓捕没有不在场证明的犯人", () => {
  const state = startedState(8);
  const actor = state.players[state.currentIndex];
  const target = state.players.find((player) => player.id !== actor.id);
  const detective = giveType(state, actor, CARDS.DETECTIVE);
  actor.turnsTaken = 0;
  applyAction(state, actor.id, { type: "playCard", cardId: detective.id }, { now: 3_000, random: randomSource() });
  assert.equal(state.phase, "turn");

  state.currentIndex = state.players.indexOf(actor);
  const criminal = giveType(state, target, CARDS.CRIMINAL);
  removeTypeFrom(state, target, CARDS.ALIBI);
  const secondDetective = giveType(state, actor, CARDS.DETECTIVE);
  actor.turnsTaken = 1;
  applyAction(state, actor.id, { type: "playCard", cardId: secondDetective.id }, { now: 4_000, random: randomSource() });
  assert.equal(state.phase, "chooseTarget");
  applyAction(state, actor.id, { type: "chooseTarget", targetId: target.id }, { now: 4_100 });
  assert.ok(["roundReview", "ended"].includes(state.phase));
  assert.equal(state.roundResult.outcome, "detective");
  assert.equal(state.roundResult.culpritId, target.id);
  assert.ok(state.discard.some((card) => card.id === criminal.id) === false);
});

test("不在场证明让侦探只能得到公开的失败结果", () => {
  const state = startedState();
  const actor = state.players[state.currentIndex];
  const target = state.players.find((player) => player.id !== actor.id);
  const detective = giveType(state, actor, CARDS.DETECTIVE);
  giveType(state, target, CARDS.CRIMINAL);
  giveType(state, target, CARDS.ALIBI);
  actor.turnsTaken = 1;
  applyAction(state, actor.id, { type: "playCard", cardId: detective.id }, { now: 3_000 });
  applyAction(state, actor.id, { type: "chooseTarget", targetId: target.id }, { now: 3_100 });
  assert.equal(state.phase, "turn");
  assert.match(state.logs[0].text, /我不是犯人/);
  assert.doesNotMatch(state.logs[0].text, /不在场证明/);
});

test("交易双方选择互相保密并在收齐后原子交换", () => {
  const state = startedState(8);
  const actor = state.players[state.currentIndex];
  const target = state.players.find((player) => player.id !== actor.id && player.hand.length);
  const trade = giveType(state, actor, CARDS.TRADE);
  actor.turnsTaken = 1;
  applyAction(state, actor.id, { type: "playCard", cardId: trade.id }, { now: 3_000 });
  applyAction(state, actor.id, { type: "chooseTarget", targetId: target.id }, { now: 3_100 });
  const actorChoice = actor.hand[0].id;
  const targetChoice = target.hand[0].id;
  applyAction(state, actor.id, { type: "submitTradeCard", cardId: actorChoice }, { now: 3_200 });
  assert.equal(buildView(state, actor.id).pending.ownSelectionId, actorChoice);
  assert.equal(buildView(state, target.id).pending.ownSelectionId, null);
  assert.equal(buildSpectatorView(state).pending.ownSelectionId, null);
  assert.ok(actor.hand.some((card) => card.id === actorChoice));
  applyAction(state, target.id, { type: "submitTradeCard", cardId: targetChoice }, { now: 3_300 });
  assert.ok(actor.hand.some((card) => card.id === targetChoice));
  assert.ok(target.hand.some((card) => card.id === actorChoice));
  validateState(state);
});

test("情报交换在所有人确认前不移动牌，之后同时向左传递", () => {
  const state = startedState(4);
  const actor = state.players[state.currentIndex];
  const card = giveType(state, actor, CARDS.PASS_LEFT);
  applyAction(state, actor.id, { type: "playCard", cardId: card.id }, { now: 3_000 });
  assert.equal(state.phase, "passLeft");
  const pending = state.pending;
  const choices = Object.fromEntries(pending.participantIds.map((id) => [id, playerBy(state, id).hand[0].id]));
  const before = Object.fromEntries(state.players.map((player) => [player.id, player.hand.map((item) => item.id)]));
  for (const id of pending.participantIds.slice(0, -1)) applyAction(state, id, { type: "submitPassCard", cardId: choices[id] }, { now: 3_100 });
  assert.deepEqual(Object.fromEntries(state.players.map((player) => [player.id, player.hand.map((item) => item.id)])), before);
  const last = pending.participantIds.at(-1);
  applyAction(state, last, { type: "submitPassCard", cardId: choices[last] }, { now: 3_200 });
  for (let index = 0; index < state.players.length; index += 1) {
    const owner = state.players[index];
    const left = state.players[(index + 1) % state.players.length];
    if (choices[owner.id]) assert.ok(left.hand.some((item) => item.id === choices[owner.id]));
  }
  validateState(state);
});

function playerBy(state, id) {
  return state.players.find((player) => player.id === id);
}

test("目击者结果只进入发动者视图，超时可以继续回合", () => {
  const state = startedState(8);
  const actor = state.players[state.currentIndex];
  const target = state.players.find((player) => player.id !== actor.id);
  const witness = giveType(state, actor, CARDS.WITNESS);
  applyAction(state, actor.id, { type: "playCard", cardId: witness.id }, { now: 3_000 });
  applyAction(state, actor.id, { type: "chooseTarget", targetId: target.id }, { now: 3_100 });
  assert.equal(buildView(state, actor.id).privateInsight.cardTypes.length, target.hand.length);
  assert.equal(buildView(state, target.id).privateInsight, null);
  assert.equal(buildSpectatorView(state).privateInsight, null);
  assert.equal(handleTimeout(state, { now: state.deadline + 1 }), true);
  assert.equal(state.phase, "turn");
});

test("序列化恢复保留秘密选择且通过守恒检查", () => {
  const state = startedState();
  const restored = restoreState(serializeState(state));
  assert.deepEqual(restored, state);
  validateState(restored);
});

test("旁观者身份不能直接调用玩家动作", () => {
  const state = startedState();
  assert.throws(() => applyAction(state, "watcher", { type: "playCard", cardId: "x" }), (error) => error instanceof GameRuleError && error.code === "not_a_player");
});

test("少年只告知发动者犯人身份，同时通知当前犯人已被认出", () => {
  const state = startedState(8);
  const actor = state.players[state.currentIndex];
  const child = giveType(state, actor, CARDS.CHILD);
  const culprit = state.players.find((player) => player.id !== actor.id);
  giveType(state, culprit, CARDS.CRIMINAL);
  applyAction(state, actor.id, { type: "playCard", cardId: child.id }, { now: 3_000 });
  assert.equal(state.phase, "privateReveal");
  assert.equal(buildView(state, actor.id).privateInsight.culpritHolderId, culprit.id);
  assert.deepEqual(buildView(state, culprit.id).privateInsight, { kind: "identifiedByChild", actorId: actor.id });
  assert.equal(buildSpectatorView(state).privateInsight, null);
  assert.equal(buildView(state, state.players.find((player) => ![actor.id, culprit.id].includes(player.id)).id).privateInsight, null);
});

test("神犬只公开被选中的随机牌背，翻到犯人时立即结算", () => {
  const state = startedState(8);
  const actor = state.players[state.currentIndex];
  const target = state.players.find((player) => player.id !== actor.id);
  const dog = giveType(state, actor, CARDS.DOG);
  const criminal = giveType(state, target, CARDS.CRIMINAL);
  applyAction(state, actor.id, { type: "playCard", cardId: dog.id }, { now: 3_000, random: randomSource(9) });
  applyAction(state, actor.id, { type: "chooseTarget", targetId: target.id }, { now: 3_100, random: randomSource(9) });
  const publicPick = buildSpectatorView(state).pending;
  assert.deepEqual(publicPick.slots, []);
  const criminalSlot = state.pending.slots.find((slot) => slot.cardId === criminal.id);
  applyAction(state, actor.id, { type: "chooseDogSlot", slotKey: criminalSlot.key }, { now: 3_200 });
  assert.ok(["roundReview", "ended"].includes(state.phase));
  assert.equal(state.roundResult.outcome, "dog");
  assert.equal(state.roundResult.changes[actor.id], 3);
});

test("谣言依据结算前快照让每人从右侧随机取得一张牌", () => {
  const state = startedState(8);
  const actor = state.players[state.currentIndex];
  const gossip = giveType(state, actor, CARDS.GOSSIP);
  const snapshots = state.players.map((player) => player.hand.filter((card) => card.id !== gossip.id));
  const expected = state.players.map((_, receiverIndex) => snapshots[(receiverIndex - 1 + state.players.length) % state.players.length][0]?.id || null);
  applyAction(state, actor.id, { type: "playCard", cardId: gossip.id }, { now: 3_000, random: () => 0 });
  for (let index = 0; index < state.players.length; index += 1) {
    if (expected[index]) assert.ok(state.players[index].hand.some((card) => card.id === expected[index]));
  }
  validateState(state);
});

test("犯人作为最后一张牌逃脱时为犯人与已公开共犯各加2分", () => {
  const state = startedState(8);
  const actor = state.players[state.currentIndex];
  const accomplice = state.players.find((player) => player.id !== actor.id);
  const criminal = giveType(state, actor, CARDS.CRIMINAL);
  const receiver = state.players.find((player) => ![actor.id, accomplice.id].includes(player.id));
  receiver.hand.push(...actor.hand.filter((card) => card.id !== criminal.id));
  actor.hand = [criminal];
  accomplice.accomplice = true;
  applyAction(state, actor.id, { type: "playCard", cardId: criminal.id }, { now: 3_000 });
  assert.equal(state.roundResult.outcome, "escape");
  assert.equal(state.roundResult.changes[actor.id], 2);
  assert.equal(state.roundResult.changes[accomplice.id], 2);
  assert.ok(state.players.filter((player) => ![actor.id, accomplice.id].includes(player.id)).every((player) => state.roundResult.changes[player.id] === 0));
  validateState(state);
});
