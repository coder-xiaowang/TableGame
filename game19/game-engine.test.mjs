import assert from "node:assert/strict";
import test from "node:test";
import { CARD_META, CHARACTERS, ROLE_DISTRIBUTION, createDeck } from "./rules.mjs";
import * as engine from "./server/game-engine.mjs";

function lobby(count = 4) {
  const state = engine.createLobby({ capacity: count, host: { id: "p1", name: "甲", connected: true } });
  for (let index = 2; index <= count; index += 1) engine.addPlayer(state, { id: `p${index}`, name: `玩家${index}`, connected: true });
  return state;
}
const effect = (state, action) => state.pending?.id ? { ...action, effectId: state.pending.id } : action;

function enterPlay(state, random = () => 0.25) {
  const actor = state.players[state.currentIndex];
  if (state.phase === "drawChoice") engine.applyAction(state, actor.id, effect(state, { type: "chooseDraw", mode: "deck" }), { now: 2, random });
  else if (state.phase === "draw") engine.applyAction(state, actor.id, { type: "draw" }, { now: 2, random });
  if (state.phase === "kitChoice") engine.applyAction(state, actor.id, effect(state, { type: "chooseKit", cardIds: state.pending.cards.slice(0, 2).map((card) => card.id) }), { now: 3, random });
  return actor;
}

function moveCardTo(state, type, target) {
  const zones = [state.deck, state.discard, ...state.players.flatMap((player) => [player.hand, player.equipment])];
  for (const zone of zones) {
    const index = zone.findIndex((card) => card.type === type);
    if (index >= 0) { const [card] = zone.splice(index, 1); target.push(card); return card; }
  }
  throw new Error(`Missing ${type}`);
}

test("基础版配置含16名角色、80张唯一牌和正确身份人数", () => {
  const deck = createDeck();
  assert.equal(CHARACTERS.length, 16);
  assert.equal(deck.length, 80);
  assert.equal(new Set(deck.map((card) => card.id)).size, 80);
  assert.equal(deck.filter((card) => card.type === "bang").length, 25);
  assert.equal(deck.filter((card) => card.type === "missed").length, 12);
  assert.ok(deck.every((card) => CARD_META[card.type]));
  assert.deepEqual(Object.keys(ROLE_DISTRIBUTION).map(Number), [4, 5, 6, 7]);
});

test("开局由服务器分配秘密身份、角色、生命与手牌", () => {
  const state = lobby();
  engine.applyAction(state, "p1", { type: "start" }, { now: 1000, random: () => 0.37 });
  engine.validateState(state);
  const sheriff = state.players.find((player) => player.role === "sheriff");
  assert.ok(sheriff);
  assert.equal(sheriff.maxLife, CHARACTERS.find((item) => item.id === sheriff.characterId).life + 1);
  const ownView = engine.buildView(state, "p1");
  const spectator = engine.buildSpectatorView(state);
  assert.equal(ownView.players.find((player) => player.id === "p1").role, state.players[0].role);
  assert.ok(ownView.players.filter((player) => player.id !== "p1" && player.role !== "sheriff").every((player) => player.role === null));
  assert.ok(spectator.players.filter((player) => player.role !== "sheriff").every((player) => player.role === null));
  assert.ok(spectator.players.every((player) => player.hand.every((card) => card.type === null)));
});

test("公开演出对所有视角一致，摸牌详情只发送给获得者", () => {
  const state = lobby();
  engine.applyAction(state, "p1", { type: "start" }, { now: 1000, random: () => 0.37 });
  const actor = state.players[state.currentIndex];
  const actorView = engine.buildView(state, actor.id);
  const other = state.players.find((player) => player.id !== actor.id);
  const otherView = engine.buildView(state, other.id);
  const spectator = engine.buildSpectatorView(state);
  const publicFromActor = actorView.presentationEvents.filter((event) => !event.private);
  assert.deepEqual(publicFromActor, spectator.presentationEvents);
  assert.deepEqual(otherView.presentationEvents.filter((event) => !event.private), spectator.presentationEvents);
  assert.ok(actorView.presentationEvents.some((event) => event.kind === "private-draw" && event.private));
  assert.ok(otherView.presentationEvents.every((event) => !event.private));
  assert.ok(spectator.presentationEvents.every((event) => !event.private));
  assert.ok(spectator.presentationEvents.every((event) => !JSON.stringify(event).includes(ROLE_DISTRIBUTION[4].find((role) => role !== "sheriff"))));
});

test("旁观座位仅可在准备阶段变更", () => {
  const state = lobby();
  assert.equal(engine.canChangeSeats(state), true);
  engine.applyAction(state, "p1", { type: "start" }, { now: 1, random: () => 0.5 });
  assert.equal(engine.canChangeSeats(state), false);
  assert.throws(() => engine.vacateSeat(state, "p2"), /不能离开玩家席/);
});

test("普通摸牌后进入权威出牌阶段且牌守恒", () => {
  const state = lobby();
  engine.applyAction(state, "p1", { type: "start" }, { now: 1, random: () => 0.25 });
  enterPlay(state, () => 0.25);
  assert.equal(state.phase, "play");
  engine.validateState(state);
});

test("砰与闪由响应状态机串行结算，旧阶段动作被拒绝", () => {
  const state = lobby();
  engine.applyAction(state, "p1", { type: "start" }, { now: 1, random: () => 0.25 });
  const actor = enterPlay(state), target = state.players.find((player) => player.alive && player.id !== actor.id);
  moveCardTo(state, "winchester", actor.equipment);
  const bang = moveCardTo(state, "bang", actor.hand), missed = moveCardTo(state, "missed", target.hand);
  engine.applyAction(state, actor.id, { type: "playCard", cardId: bang.id, targetId: target.id }, { now: 4, random: () => 0.25 });
  assert.equal(state.phase, "defense");
  assert.deepEqual(state.presentationEvents.slice(-2).map((event) => event.kind), ["attack", "response-window"]);
  assert.equal(state.presentationEvents.at(-2).actorId, actor.id);
  assert.equal(state.presentationEvents.at(-2).targetId, target.id);
  assert.equal(new Set(state.presentationEvents.slice(-2).map((event) => event.sceneId)).size, 1);
  assert.ok(state.presentationEvents.slice(-2).every((event) => event.priority === 3));
  assert.throws(() => engine.applyAction(state, actor.id, effect(state, { type: "endTurn" }), { now: 5 }), /不需要你响应/);
  engine.applyAction(state, target.id, effect(state, { type: "respond", cardId: missed.id }), { now: 6, random: () => 0.25 });
  assert.equal(state.phase, "play");
  assert.equal(state.presentationEvents.at(-1).kind, "defense");
  assert.equal(state.currentIndex, state.players.indexOf(actor));
  engine.validateState(state);
});

test("随机抢走的秘密手牌只向行动双方说明具体牌面", () => {
  const state = lobby();
  engine.applyAction(state, "p1", { type: "start" }, { now: 1, random: () => 0.25 });
  const actor = enterPlay(state), target = state.players[(state.currentIndex + 1) % state.players.length];
  actor.characterId = "rose_doolan";
  target.characterId = "bart_cassidy";
  const panic = moveCardTo(state, "panic", actor.hand);
  const stolen = target.hand[0];
  engine.applyAction(state, actor.id, { type: "playCard", cardId: panic.id, targetId: target.id, targetZone: "hand" }, { now: 4, random: () => 0 });
  const actorEvents = engine.buildView(state, actor.id).presentationEvents;
  const targetEvents = engine.buildView(state, target.id).presentationEvents;
  const outsider = state.players.find((player) => ![actor.id, target.id].includes(player.id));
  const outsiderEvents = engine.buildView(state, outsider.id).presentationEvents;
  const spectatorEvents = engine.buildSpectatorView(state).presentationEvents;
  assert.ok(actorEvents.some((event) => event.private && event.text.includes(CARD_META[stolen.type].name)));
  assert.ok(targetEvents.some((event) => event.private && event.text.includes(CARD_META[stolen.type].name)));
  const actorTransfer = actorEvents.find((event) => event.kind === "private-card-transfer" && event.private && event.text.includes(CARD_META[stolen.type].name));
  const publicSteal = actorEvents.find((event) => event.kind === "steal" && !event.private);
  assert.equal(actorTransfer.sceneId, publicSteal.sceneId);
  assert.ok(outsiderEvents.every((event) => !event.private));
  assert.ok(spectatorEvents.every((event) => !event.private));
  assert.equal(spectatorEvents.some((event) => event.text.includes(CARD_META[stolen.type].name) && event.kind !== "steal"), false);
  engine.validateState(state);
});

test("旧快照缺少演出字段时仍可恢复并继续生成事件", () => {
  const state = lobby();
  const legacy = structuredClone(state);
  delete legacy.presentationEvents;
  delete legacy.privatePresentationEvents;
  delete legacy.presentationSequence;
  delete legacy.presentationSceneSequence;
  const restored = engine.restoreState(legacy);
  assert.deepEqual(restored.presentationEvents, []);
  assert.deepEqual(restored.privatePresentationEvents, {});
  assert.equal(restored.presentationSceneSequence, 0);
  engine.applyAction(restored, "p1", { type: "start" }, { now: 1000, random: () => 0.37 });
  assert.ok(restored.presentationSequence > 0);
  assert.equal(restored.presentationEvents.at(-1).sceneId, "bang_scene_1");
  assert.doesNotThrow(() => engine.validateState(restored));
});

test("同一结算链共享场景且非法操作不消耗演出场景编号", () => {
  const state = lobby();
  engine.applyAction(state, "p1", { type: "start" }, { now: 1, random: () => 0.25 });
  const actor = enterPlay(state), target = state.players.find((player) => player.alive && player.id !== actor.id);
  moveCardTo(state, "winchester", actor.equipment);
  const bang = moveCardTo(state, "bang", actor.hand);
  engine.applyAction(state, actor.id, { type: "playCard", cardId: bang.id, targetId: target.id }, { now: 4, random: () => 0.25 });
  const attackScene = state.presentationEvents.slice(-2);
  assert.equal(new Set(attackScene.map((event) => event.sceneId)).size, 1);
  const before = state.presentationSceneSequence;
  assert.throws(() => engine.applyAction(state, actor.id, effect(state, { type: "endTurn" }), { now: 5 }), /不需要你响应/);
  assert.equal(state.presentationSceneSequence, before);
  assert.equal("activePresentationScene" in state, false);
  const snapshot = engine.serializeState(state);
  const restored = engine.restoreState(snapshot);
  assert.equal(restored.presentationSceneSequence, state.presentationSceneSequence);
  assert.deepEqual(restored.presentationEvents, state.presentationEvents);

  delete snapshot.presentationSceneSequence;
  const inferred = engine.restoreState(snapshot);
  assert.equal(inferred.presentationSceneSequence, state.presentationSceneSequence);
});

test("超额手牌必须按当前生命弃牌，超时也能自动推进", () => {
  const state = lobby();
  engine.applyAction(state, "p1", { type: "start" }, { now: 1, random: () => 0.31 });
  const actor = enterPlay(state, () => 0.31);
  actor.life = 1;
  engine.applyAction(state, actor.id, { type: "endTurn" }, { now: 10, random: () => 0.31 });
  assert.equal(state.phase, "discardExcess");
  assert.equal(state.pending.count, actor.hand.length - actor.life);
  engine.handleTimeout(state, { now: state.deadline + 1, random: () => 0.31 });
  assert.equal(actor.hand.length, actor.life);
  assert.notEqual(state.currentIndex, state.players.indexOf(actor));
  engine.validateState(state);
});

test("濒死放弃后由出局者决定弃牌顺序，再恢复原攻击者阶段", () => {
  const state = lobby();
  engine.applyAction(state, "p1", { type: "start" }, { now: 1, random: () => 0.19 });
  const actor = enterPlay(state, () => 0.19);
  for (const item of state.players) item.characterId = "bart_cassidy";
  actor.role = "sheriff";
  const target = state.players.find((player) => player.id !== actor.id); target.role = "outlaw"; target.life = 1;
  moveCardTo(state, "winchester", actor.equipment);
  const bang = moveCardTo(state, "bang", actor.hand);
  engine.applyAction(state, actor.id, { type: "playCard", cardId: bang.id, targetId: target.id }, { now: 4, random: () => 0.19 });
  engine.applyAction(state, target.id, effect(state, { type: "takeHit" }), { now: 5, random: () => 0.19 });
  assert.equal(state.phase, "dying");
  engine.applyAction(state, target.id, effect(state, { type: "giveUp" }), { now: 6, random: () => 0.19 });
  assert.equal(state.phase, "eliminationDiscard");
  assert.equal(target.alive, false);
  const cardIds = [...target.hand, ...target.equipment].map((card) => card.id).reverse();
  engine.applyAction(state, target.id, effect(state, { type: "orderEliminationDiscard", cardIds }), { now: 7, random: () => 0.19 });
  assert.equal(state.phase, "play");
  assert.equal(state.discard[state.discard.length - 1].id, cardIds[cardIds.length - 1]);
  engine.validateState(state);
});

test("23种基础牌均能通过权威入口并完成或进入合法结算阶段", async (context) => {
  const types = Object.keys(CARD_META);
  for (const type of types) await context.test(type, () => {
    const state = lobby();
    engine.applyAction(state, "p1", { type: "start" }, { now: 1, random: () => 0.43 });
    const actor = enterPlay(state, () => 0.43);
    actor.characterId = type === "missed" ? "calamity_janet" : "bart_cassidy";
    const candidates = state.players.filter((player) => player.id !== actor.id && player.alive);
    const target = type === "jail" ? candidates.find((player) => player.role !== "sheriff") : candidates[0];
    moveCardTo(state, "winchester", actor.equipment);
    const card = moveCardTo(state, type, actor.hand);
    const action = { type: "playCard", cardId: card.id };
    if (["bang", "missed", "duel", "panic", "cat_balou", "jail"].includes(type)) action.targetId = target.id;
    if (["panic", "cat_balou"].includes(type)) action.targetZone = "hand";
    engine.applyAction(state, actor.id, action, { now: 10, random: () => 0.43 });
    let guard = 0;
    while (state.phase !== "play" && state.phase !== "ended" && guard++ < 20) {
      const pendingActor = state.pending?.actorId ? state.players.find((player) => player.id === state.pending.actorId) : null;
      if (state.phase === "defense" || state.phase === "duel") engine.applyAction(state, pendingActor.id, effect(state, { type: "takeHit" }), { now: 11 + guard, random: () => 0.43 });
      else if (state.phase === "generalStore") engine.applyAction(state, state.pending.chooserIds[0], effect(state, { type: "chooseStore", cardId: state.pending.choices[0].id }), { now: 11 + guard, random: () => 0.43 });
      else if (state.phase === "dying") engine.applyAction(state, pendingActor.id, effect(state, { type: "giveUp" }), { now: 11 + guard, random: () => 0.43 });
      else if (state.phase === "eliminationDiscard") engine.applyAction(state, pendingActor.id, effect(state, { type: "orderEliminationDiscard", cardIds: [...pendingActor.hand, ...pendingActor.equipment].map((item) => item.id) }), { now: 11 + guard, random: () => 0.43 });
      else break;
    }
    assert.ok(["play", "ended"].includes(state.phase), `${type} stopped at ${state.phase}`);
    engine.validateState(state);
  });
});
