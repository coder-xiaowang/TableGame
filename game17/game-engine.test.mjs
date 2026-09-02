import assert from "node:assert/strict";
import test from "node:test";
import {
  GameRuleError, addPlayer, applyAction, buildSpectatorView, buildView,
  createLobby, handleTimeout, restoreState, serializeState, setPresence, validateState
} from "./server/game-engine.mjs";
import { BID_LEVELS, COMPANIES } from "./rules.mjs";

function rng(seed = 123456) {
  let value = seed >>> 0;
  return () => ((value = (value * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

function makeGame(count, random = rng()) {
  const state = createLobby({ capacity: count, host: { id: "p1", name: "甲", connected: true } });
  for (let index = 2; index <= count; index += 1) addPlayer(state, { id: `p${index}`, name: `玩家${index}`, connected: true });
  for (const player of state.players) setPresence(state, player.id, true);
  applyAction(state, "p1", { type: "start" }, { now: 1000, random });
  return state;
}

function firstLegalBid(state) {
  const token = state.bidTokens.find((item) => item.id === state.currentBidTokenId || item.id === state.bidQueue[0]);
  const actor = state.players.find((player) => player.id === state.currentActorId);
  const ownOther = state.bidTokens.filter((item) => item.ownerId === actor.id && item.id !== token.id && item.pileId);
  for (const pile of state.stockpiles) {
    if (ownOther.some((item) => item.pileId === pile.id)) continue;
    const top = state.bidTokens.find((item) => item.pileId === pile.id);
    for (const amount of BID_LEVELS) {
      if ((!top || amount > top.amount) && amount + ownOther.reduce((sum, item) => sum + item.amount, 0) <= actor.cash) return { pileId: pile.id, amount };
    }
  }
  throw new Error("No legal bid in test");
}

function advance(state, random, now) {
  const actorId = state.currentActorId;
  if (state.phase === "supply") {
    const actor = state.players.find((player) => player.id === actorId);
    applyAction(state, actorId, { type: "placeSupply", faceUpCardId: actor.supplyHand[0].id, faceDownCardId: actor.supplyHand[1].id, faceUpPileId: state.stockpiles[0].id, faceDownPileId: state.stockpiles.at(-1).id }, { now, random });
  } else if (state.phase === "bidding") {
    applyAction(state, actorId, { type: "placeBid", ...firstLegalBid(state) }, { now, random });
  } else if (state.phase === "marketAction") {
    applyAction(state, actorId, { type: "playMarketAction", companyId: COMPANIES[0].id }, { now, random });
  } else if (state.phase === "selling") {
    applyAction(state, actorId, { type: "submitSales", sales: [] }, { now, random });
  } else if (state.phase === "dividend") {
    applyAction(state, actorId, { type: "submitDividend", normal: 0, split: 0 }, { now, random });
  } else if (state.phase === "roundReview") {
    handleTimeout(state, { now: state.deadline + 1, random });
  } else throw new Error(`Unhandled phase ${state.phase}`);
}

test("三人局完整状态机可以无浏览器走到终局", () => {
  const random = rng(7); const state = makeGame(3, random);
  let steps = 0;
  while (state.phase !== "ended" && steps < 1000) advance(state, random, 2000 + steps++);
  assert.equal(state.phase, "ended"); assert.ok(steps < 1000); assert.equal(state.round, 7);
  assert.equal(state.finalScores.length, 3); assert.ok(state.winnerIds.length >= 1); assert.equal(validateState(state), true);
});

test("两人局执行双内幕、双批供给、四标记竞价", () => {
  const random = rng(19); const state = makeGame(2, random);
  assert.equal(state.players[0].cash, 30000); assert.equal(state.players[0].privateInformation.length, 2);
  assert.equal(state.hiddenInformation.length, 2); assert.equal(state.publicInformation, null); assert.equal(state.stockpiles.length, 4);
  while (state.phase === "supply") advance(state, random, state.deadline - 1);
  assert.equal(state.bidTokens.length, 4);
  while (state.phase === "bidding") advance(state, random, state.deadline - 1);
  assert.ok(["marketAction", "selling"].includes(state.phase));
  assert.equal(new Set(state.bidTokens.map((token) => token.pileId)).size, 4);
});

test("逐玩家视图和旁观视图不会泄露持股、供给手牌与内幕消息", () => {
  const state = makeGame(3, rng(33));
  const p1 = buildView(state, "p1"); const p2 = buildView(state, "p2"); const watched = buildSpectatorView(state);
  assert.ok(p1.players.find((player) => player.id === "p1").portfolio.length > 0);
  assert.equal(p2.players.find((player) => player.id === "p1").portfolio.length, 0);
  assert.equal(watched.players.flatMap((player) => player.portfolio).length, 0);
  assert.equal(p1.players.find((player) => player.id === "p2").privateInformation.length, 0);
  assert.equal(watched.supplyHand.length, 0); assert.equal(watched.selfId, null);
  const otherJson = JSON.stringify(p2); const watchedJson = JSON.stringify(watched);
  for (const secret of [...state.players[0].portfolio, ...state.players[0].supplyHand, ...state.players[0].privateInformation]) {
    assert.equal(otherJson.includes(secret.id), false); assert.equal(watchedJson.includes(secret.id), false);
  }
});

test("超时兜底能够推进供给阶段且非法越权被拒绝", () => {
  const state = makeGame(3, rng(44)); const wrong = state.players.find((player) => player.id !== state.currentActorId);
  assert.throws(() => applyAction(state, wrong.id, { type: "placeSupply" }), (error) => error instanceof GameRuleError && error.code === "not_your_supply");
  const phaseActor = state.currentActorId; const deadline = state.deadline;
  assert.equal(handleTimeout(state, { now: deadline + 1, random: rng(2) }), true);
  assert.notEqual(state.currentActorId, phaseActor);
});

test("任意等待阶段序列化恢复后保持私密状态和期限", () => {
  const state = makeGame(4, rng(55)); const restored = restoreState(serializeState(state));
  assert.deepEqual(restored, state); assert.equal(restored.deadline, state.deadline);
  assert.deepEqual(buildView(restored, "p1").supplyHand, buildView(state, "p1").supplyHand);
});

test("拆股、再次拆股奖励和破产均由服务端结算", () => {
  const random = rng(66); const state = makeGame(3, random); const actor = state.players[0]; const companyId = actor.portfolio[0].companyId;
  const booms = state.marketDeck.filter((card) => card.kind === "action" && card.actionType === "boom").slice(0, 2);
  const bust = state.marketDeck.find((card) => card.kind === "action" && card.actionType === "bust");
  assert.equal(booms.length, 2); assert.ok(bust);
  state.marketDeck = state.marketDeck.filter((card) => ![...booms, bust].some((chosen) => chosen.id === card.id));
  actor.actionCards = [...booms]; state.actionQueue = booms.map((card) => ({ ownerId: actor.id, cardId: card.id, actionType: card.actionType })); state.phase = "marketAction"; state.currentActorId = actor.id; state.stockPrices[companyId] = 9;
  const cashBefore = actor.cash;
  applyAction(state, actor.id, { type: "playMarketAction", companyId }, { now: 4000, random });
  assert.equal(actor.portfolio.filter((card) => card.companyId === companyId).length, 0); assert.equal(actor.splitPortfolio.filter((card) => card.companyId === companyId).length, 1);
  state.stockPrices[companyId] = 9;
  applyAction(state, actor.id, { type: "playMarketAction", companyId }, { now: 4001, random });
  assert.equal(actor.cash, cashBefore + 10000);
  actor.actionCards = [bust]; state.actionQueue = [{ ownerId: actor.id, cardId: bust.id, actionType: "bust" }]; state.phase = "marketAction"; state.currentActorId = actor.id; state.stockPrices[companyId] = 1;
  applyAction(state, actor.id, { type: "playMarketAction", companyId }, { now: 4002, random });
  assert.equal(state.stockPrices[companyId], 5); assert.equal(actor.splitPortfolio.filter((card) => card.companyId === companyId).length, 0); assert.equal(validateState(state), true);
});

test("拆股牌可卖一股转回普通区，分红可以只公开部分持股", () => {
  const random = rng(77); const state = makeGame(3, random); const actor = state.players[0]; const companyId = actor.portfolio[0].companyId;
  const extraIndex = state.marketDeck.findIndex((card) => card.kind === "stock" && card.companyId === companyId); const [extra] = state.marketDeck.splice(extraIndex, 1); actor.splitPortfolio.push(extra);
  state.phase = "selling"; state.turnQueue = [actor.id, state.players[1].id]; state.currentActorId = actor.id; state.deadline = 5000;
  const beforeSale = actor.cash;
  applyAction(state, actor.id, { type: "submitSales", sales: [{ companyId, normal: 1, splitFull: 0, splitHalf: 1 }] }, { now: 4100, random });
  assert.equal(actor.cash, beforeSale + state.stockPrices[companyId] * 2000); assert.equal(actor.portfolio.filter((card) => card.companyId === companyId).length, 1); assert.equal(actor.splitPortfolio.filter((card) => card.companyId === companyId).length, 0);
  state.phase = "dividend"; state.pendingDividend = { companyId, pair: { companyId, forecastId: "dividend" }, queue: [actor.id] }; state.movementQueue = []; state.currentActorId = actor.id; state.deadline = 6000;
  const beforeDividend = actor.cash;
  applyAction(state, actor.id, { type: "submitDividend", normal: 1, split: 0 }, { now: 4200, random });
  assert.equal(actor.cash, beforeDividend + 2000); assert.ok(state.logs.some((entry) => entry.text.includes("公开 1 股"))); assert.equal(validateState(state), true);
});
