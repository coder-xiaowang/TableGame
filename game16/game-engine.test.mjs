import test from "node:test";
import assert from "node:assert/strict";
import { addPlayer, applyAction, buildSpectatorView, buildView, createLobby, handleTimeout, restoreState, serializeState, validateState } from "./server/game-engine.mjs";

const random = () => 0;
const now = 1_000_000;
function started(count = 3) {
  const state = createLobby({ capacity: count, host: { id: "p1", name: "甲", connected: true } });
  for (let i = 2; i <= count; i += 1) addPlayer(state, { id: `p${i}`, name: `玩家${i}`, connected: true });
  applyAction(state, "p1", { type: "start" }, { now, random });
  return state;
}
const current = (state) => state.players[state.currentIndex];
const others = (state, id) => state.players.filter((p) => p.id !== id && !p.eliminated);
function reactionAction(state, type, extra = {}) {
  return { type, ...extra, reactionId: state.reaction.id, reactionKind: state.reaction.kind };
}
function passAll(state, ids, at = now + 1) { for (const id of ids) applyAction(state, id, reactionAction(state, "pass"), { now: at, random }); }

test("开局资源正确且15张角色牌守恒", () => {
  const state = started(4);
  assert.equal(state.phase, "action");
  assert.ok(state.players.every((p) => p.coins === 2 && p.influences.length === 2));
  assert.equal(state.deck.length, 7);
  assert.equal(validateState(state), true);
});

test("收入立即结算，公爵征税等待所有玩家质疑", () => {
  const income = started(); const actor = current(income);
  applyAction(income, actor.id, { type: "declareAction", actionType: "income" }, { now: now + 1, random });
  assert.equal(actor.coins, 3); assert.notEqual(current(income).id, actor.id);
  const tax = started(); const duke = current(tax); duke.influences[0].role = "duke";
  applyAction(tax, duke.id, { type: "declareAction", actionType: "tax" }, { now: now + 1, random });
  assert.equal(tax.phase, "challengeAction");
  passAll(tax, others(tax, duke.id).map((p) => p.id));
  assert.equal(duke.coins, 5); assert.equal(tax.phase, "action");
});

test("10枚金币强制政变且费用在声明时支付", () => {
  const state = started(); const actor = current(state); const target = others(state, actor.id)[0]; actor.coins = 10;
  assert.throws(() => applyAction(state, actor.id, { type: "declareAction", actionType: "income" }, { now: now + 1, random }), (e) => e.code === "coup_required");
  applyAction(state, actor.id, { type: "declareAction", actionType: "coup", targetId: target.id }, { now: now + 2, random });
  assert.equal(actor.coins, 3); assert.equal(state.phase, "loseInfluence");
});

test("真角色证明后换牌，质疑者失去影响力，原行动继续", () => {
  const state = started(); const actor = current(state); const challenger = others(state, actor.id)[0];
  actor.influences[0].role = "duke"; const proofId = actor.influences[0].id;
  applyAction(state, actor.id, { type: "declareAction", actionType: "tax" }, { now: now + 1, random });
  applyAction(state, challenger.id, reactionAction(state, "challenge"), { now: now + 2, random });
  applyAction(state, actor.id, { type: "prove", cardId: proofId }, { now: now + 3, random });
  assert.equal(state.loss.playerId, challenger.id); assert.notEqual(actor.influences[0].id, proofId);
  applyAction(state, challenger.id, { type: "loseInfluence", cardId: challenger.influences[0].id }, { now: now + 4, random });
  assert.equal(actor.coins, 5); validateState(state);
});

test("虚假角色被质疑后失去影响力且行动失败", () => {
  const state = started(); const actor = current(state); const challenger = others(state, actor.id)[0];
  actor.influences.forEach((card) => { card.role = "captain"; });
  applyAction(state, actor.id, { type: "declareAction", actionType: "tax" }, { now: now + 1, random });
  applyAction(state, challenger.id, reactionAction(state, "challenge"), { now: now + 2, random });
  applyAction(state, actor.id, { type: "concede" }, { now: now + 3, random });
  applyAction(state, actor.id, { type: "loseInfluence", cardId: actor.influences[0].id }, { now: now + 4, random });
  assert.equal(actor.coins, 2); assert.equal(state.phase, "action");
});

test("假女伯爵阻挡失败后先受质疑惩罚，再继续刺杀", () => {
  const state = started(); const actor = current(state); const [target, third] = others(state, actor.id);
  actor.coins = 3; actor.influences[0].role = "assassin"; target.influences.forEach((card) => { card.role = "duke"; });
  applyAction(state, actor.id, { type: "declareAction", actionType: "assassinate", targetId: target.id }, { now: now + 1, random });
  passAll(state, [target.id, third.id], now + 2);
  applyAction(state, target.id, reactionAction(state, "block", { role: "contessa" }), { now: now + 3, random });
  applyAction(state, actor.id, reactionAction(state, "challenge"), { now: now + 4, random });
  applyAction(state, target.id, { type: "concede" }, { now: now + 5, random });
  applyAction(state, target.id, { type: "loseInfluence", cardId: target.influences[0].id }, { now: now + 6, random });
  assert.equal(state.phase, "loseInfluence"); assert.equal(state.loss.reason, "assassinate");
  applyAction(state, target.id, { type: "loseInfluence", cardId: target.influences[1].id }, { now: now + 7, random });
  assert.equal(target.eliminated, true); assert.equal(target.coins, 0); assert.equal(actor.coins, 0);
});

test("外援可被任意对手以公爵阻挡，接受阻挡后行动取消", () => {
  const state = started(); const actor = current(state); const blocker = others(state, actor.id)[0];
  applyAction(state, actor.id, { type: "declareAction", actionType: "foreignAid" }, { now: now + 1, random });
  assert.equal(state.phase, "block");
  applyAction(state, blocker.id, reactionAction(state, "block", { role: "duke" }), { now: now + 2, random });
  passAll(state, others(state, blocker.id).map((p) => p.id), now + 3);
  assert.equal(actor.coins, 2); assert.equal(state.phase, "action");
});

test("大使候选牌仅本人可见，交换后牌量守恒", () => {
  const state = started(); const actor = current(state); actor.influences[0].role = "ambassador";
  applyAction(state, actor.id, { type: "declareAction", actionType: "exchange" }, { now: now + 1, random });
  passAll(state, others(state, actor.id).map((p) => p.id), now + 2);
  const own = buildView(state, actor.id); const opponent = buildView(state, others(state, actor.id)[0].id); const spectator = buildSpectatorView(state);
  assert.equal(own.exchange.cards.length, 4); assert.equal(opponent.exchange, null); assert.equal(spectator.exchange, null);
  applyAction(state, actor.id, { type: "submitExchange", keepIds: own.exchange.cards.slice(-2).map((card) => card.id) }, { now: now + 3, random });
  assert.equal(state.phase, "action"); validateState(state);
});

test("对手和旁观者看不到隐藏身份", () => {
  const state = started(); const actor = current(state); const opponent = others(state, actor.id)[0];
  const own = buildView(state, actor.id); const other = buildView(state, opponent.id); const spectator = buildSpectatorView(state);
  assert.ok(own.players.find((p) => p.id === actor.id).influences.every((c) => c.role));
  assert.ok(other.players.find((p) => p.id === actor.id).influences.every((c) => c.role === null));
  assert.ok(spectator.players.flatMap((p) => p.influences).every((c) => c.role === null));
});

test("行动超时由服务器兜底，快照可以恢复", () => {
  const state = started(); assert.equal(handleTimeout(state, { now: state.deadline + 1, random }), true);
  assert.equal(state.phase, "action"); const restored = restoreState(serializeState(state));
  assert.deepEqual(restored, state); validateState(restored);
});

test("响应窗口使用唯一编号，旧行动质疑不会串到新的阻挡质疑窗口", () => {
  const state = started();
  const actor = current(state);
  const [target, third] = others(state, actor.id);
  actor.coins = 3;
  actor.influences[0].role = "assassin";
  applyAction(state, actor.id, { type: "declareAction", actionType: "assassinate", targetId: target.id }, { now: now + 1, random });
  assert.equal(state.deadline, now + 1 + 18_000);
  const oldActionChallenge = reactionAction(state, "challenge");
  passAll(state, [target.id, third.id], now + 2);
  applyAction(state, target.id, reactionAction(state, "block", { role: "contessa" }), { now: now + 3, random });
  assert.equal(state.phase, "challengeBlock");
  const currentReactionId = state.reaction.id;
  assert.throws(
    () => applyAction(state, third.id, oldActionChallenge, { now: now + 4, random }),
    (error) => error.code === "stale_reaction"
  );
  assert.equal(state.phase, "challengeBlock");
  assert.equal(state.reaction.id, currentReactionId);
});

test("首个有效质疑会立即关闭所有玩家的当前响应窗口", () => {
  const state = started();
  const actor = current(state);
  const [first, second] = others(state, actor.id);
  actor.influences[0].role = "duke";
  applyAction(state, actor.id, { type: "declareAction", actionType: "tax" }, { now: now + 1, random });
  applyAction(state, first.id, reactionAction(state, "challenge"), { now: now + 2, random });
  assert.equal(state.phase, "proveClaim");
  assert.equal(state.reaction, null);
  assert.equal(buildView(state, second.id).permissions.canRespond, false);
});

test("权威演出事件对所有视角一致且不会泄露真实身份", () => {
  const state = started();
  const actor = current(state);
  const [challenger] = others(state, actor.id);
  actor.influences.forEach((card) => { card.role = "captain"; });
  applyAction(state, actor.id, { type: "declareAction", actionType: "tax" }, { now: now + 1, random });
  const playerMoment = buildView(state, challenger.id).moments.at(-1);
  const spectatorMoment = buildSpectatorView(state).moments.at(-1);
  assert.deepEqual(spectatorMoment, playerMoment);
  assert.equal(playerMoment.kind, "claim");
  assert.equal(playerMoment.actorId, actor.id);
  assert.equal(playerMoment.claimedRole, "duke");
  assert.ok([0, 1].includes(playerMoment.claimSlot));
  assert.ok(buildView(state, challenger.id).players.find((player) => player.id === actor.id).influences.every((card) => card.role === null));
  applyAction(state, challenger.id, reactionAction(state, "challenge"), { now: now + 2, random });
  const challengeMoment = buildSpectatorView(state).moments.at(-1);
  assert.equal(challengeMoment.kind, "challenge");
  assert.equal(challengeMoment.actorId, challenger.id);
  assert.equal(challengeMoment.targetId, actor.id);
  assert.equal(challengeMoment.claimSlot, null);
  assert.ok(challengeMoment.sequence > playerMoment.sequence);
});
