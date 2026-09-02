import {
  ACTION_TYPES, BID_LEVELS, COMPANIES, DIVIDEND_PER_SHARE, MAJORITY_BONUS,
  MAX_PLAYERS, MIN_PLAYERS, SECOND_SPLIT_PAYOUT, STARTING_CASH, STARTING_PRICE,
  TIED_MAJORITY_BONUS, TWO_PLAYER_STARTING_CASH, biddingTokenCount, cardLabel,
  companyById, createInformationDecks, createMarketDeck, forecastById, movePrice,
  roundsFor, sharesHeld, shuffle, stockpileCount
} from "../rules.mjs";

export const STATE_VERSION = 1;
export const SUPPORTS_SPECTATORS = true;
export const ACTION_SECONDS = 60;
export const SUPPLY_SECONDS = 60;
export const BID_SECONDS = 45;
export const MARKET_ACTION_SECONDS = 30;
export const SELL_SECONDS = 45;
export const DIVIDEND_SECONDS = 30;
export const REVIEW_SECONDS = 8;

export class GameRuleError extends Error {
  constructor(code, message, status = 400) {
    super(message); this.name = "GameRuleError"; this.code = code; this.status = status;
  }
}

const cleanText = (value, fallback = "玩家") => String(value ?? "").trim().slice(0, 12) || fallback;
const clone = (value) => structuredClone(value);
const playerById = (state, id) => state.players.find((player) => player.id === String(id)) || null;
const currentPlayer = (state) => playerById(state, state.currentActorId);
const orderedPlayers = (state) => state.players.map((_, offset) => state.players[(state.firstPlayerIndex + offset) % state.players.length]);
const cashText = (amount) => `$${Number(amount) / 1_000}K`;

function assertCapacity(value) {
  const capacity = Number(value);
  if (!Number.isInteger(capacity) || capacity < MIN_PLAYERS || capacity > MAX_PLAYERS) {
    throw new GameRuleError("invalid_capacity", `游戏人数必须为 ${MIN_PLAYERS}～${MAX_PLAYERS} 人。`);
  }
  return capacity;
}

function requireActor(state, actorId) {
  const actor = playerById(state, actorId);
  if (!actor) throw new GameRuleError("not_a_player", "你不在玩家席。", 403);
  return actor;
}

function requireHost(state, actorId) {
  const actor = requireActor(state, actorId);
  if (!actor.isHost) throw new GameRuleError("host_required", "只有房主可以执行这个操作。", 403);
  return actor;
}

function makePlayer({ id, name, isHost = false, connected = false }) {
  if (!id) throw new GameRuleError("player_id_required", "缺少玩家身份。");
  return {
    id: String(id), name: cleanText(name, isHost ? "房主" : "玩家"), isHost: Boolean(isHost), connected: Boolean(connected),
    cash: 0, debts: [], portfolio: [], splitPortfolio: [], supplyHand: [], privateInformation: [], actionCards: []
  };
}

function addLog(state, text, now = Date.now()) {
  state.logs.unshift({ id: `log_${state.logSequence += 1}`, text, at: now });
  if (state.logs.length > 160) state.logs.length = 160;
}

function setPhase(state, phase, now, seconds = 0, actorId = null) {
  state.phase = phase;
  state.currentActorId = actorId;
  state.deadline = seconds ? now + seconds * 1000 : 0;
}

function drawMarket(state) {
  const card = state.marketDeck.pop();
  if (!card) throw new GameRuleError("market_deck_empty", "市场牌库已耗尽。", 409);
  return card;
}

function settleDebts(player, state, now) {
  while (player.debts.length && player.cash >= player.debts[0].amount) {
    const debt = player.debts.shift();
    player.cash -= debt.amount;
    state.discard.push(debt);
    addLog(state, `${player.name} 自动偿还了 ${cashText(debt.amount)} 交易费。`, now);
  }
}

function credit(player, amount, state, now) {
  player.cash += amount;
  settleDebts(player, state, now);
}

function resetPlayer(player) {
  player.cash = 0; player.debts = []; player.portfolio = []; player.splitPortfolio = [];
  player.supplyHand = []; player.privateInformation = []; player.actionCards = [];
}

function resetToLobby(state, now = Date.now()) {
  state.round = 0; state.totalRounds = 0; state.firstPlayerIndex = 0; state.marketDeck = []; state.discard = [];
  state.stockPrices = Object.fromEntries(COMPANIES.map((company) => [company.id, STARTING_PRICE]));
  state.stockpiles = []; state.publicInformation = null; state.hiddenInformation = []; state.revealedInformation = [];
  state.supplyQueue = []; state.supplyBatch = 0; state.bidTokens = []; state.bidQueue = []; state.actionQueue = [];
  state.turnQueue = []; state.movementQueue = []; state.pendingDividend = null; state.finalScores = []; state.winnerIds = [];
  for (const player of state.players) resetPlayer(player);
  setPhase(state, "lobby", now);
}

function resolvePriceMove(state, companyId, amount, now, reason) {
  const company = companyById(companyId);
  const result = movePrice(state.stockPrices[companyId], amount);
  for (const event of result.events) {
    if (event.type === "split") {
      for (const player of state.players) {
        const newlySplit = player.portfolio.filter((card) => card.companyId === companyId);
        const alreadySplit = player.splitPortfolio.filter((card) => card.companyId === companyId);
        if (alreadySplit.length) credit(player, alreadySplit.length * SECOND_SPLIT_PAYOUT, state, now);
        player.portfolio = player.portfolio.filter((card) => card.companyId !== companyId);
        player.splitPortfolio.push(...newlySplit);
        if (newlySplit.length || alreadySplit.length) addLog(state, `${player.name} 公开 ${newlySplit.length} 张普通持股用于拆股${alreadySplit.length ? `，并因再次拆股获得 ${cashText(alreadySplit.length * SECOND_SPLIT_PAYOUT)}` : ""}。`, now);
      }
      addLog(state, `${company.name}触发拆股，既有普通持股转入拆股区。`, now);
    }
    if (event.type === "bankruptcy") {
      for (const player of state.players) {
        const lost = [...player.portfolio.filter((card) => card.companyId === companyId), ...player.splitPortfolio.filter((card) => card.companyId === companyId)];
        if (lost.length) addLog(state, `${player.name} 因破产失去 ${lost.length} 张${company.short}持股。`, now);
        state.discard.push(...lost);
        player.portfolio = player.portfolio.filter((card) => card.companyId !== companyId);
        player.splitPortfolio = player.splitPortfolio.filter((card) => card.companyId !== companyId);
      }
      addLog(state, `${company.name}破产，所有该公司持股被清除，股价重置为 $5。`, now);
    }
  }
  state.stockPrices[companyId] = result.price;
  addLog(state, `${reason}：${company.name} ${amount > 0 ? "+" : ""}${amount}，现价 $${result.price}。`, now);
}

function dealStartingStocks(state, random) {
  const stockChoices = shuffle(COMPANIES.map((company) => company.id), random);
  for (let index = 0; index < state.players.length; index += 1) {
    const companyId = stockChoices[index];
    const cardIndex = state.marketDeck.findIndex((card) => card.kind === "stock" && card.companyId === companyId);
    state.players[index].portfolio.push(state.marketDeck.splice(cardIndex, 1)[0]);
  }
  state.marketDeck = shuffle(state.marketDeck, random);
}

function pairInformation(random) {
  const decks = createInformationDecks();
  const companies = shuffle(decks.companies, random);
  const forecasts = shuffle(decks.forecasts, random);
  return companies.map((company, index) => ({ id: `pair_${company.companyId}`, companyId: company.companyId, forecastId: forecasts[index].forecastId }));
}

function beginRound(state, now, random) {
  state.round += 1;
  state.publicInformation = null; state.hiddenInformation = []; state.revealedInformation = [];
  state.stockpiles = Array.from({ length: stockpileCount(state.players.length) }, (_, index) => ({ id: `pile_${index + 1}`, cards: [] }));
  state.supplyQueue = []; state.bidTokens = []; state.bidQueue = []; state.actionQueue = []; state.turnQueue = [];
  state.movementQueue = []; state.pendingDividend = null;
  for (const player of state.players) { player.privateInformation = []; player.supplyHand = []; player.actionCards = []; }

  const pairs = pairInformation(random);
  const order = orderedPlayers(state);
  const privatePairCount = state.players.length === 2 ? 2 : 1;
  let cursor = 0;
  for (const player of order) {
    player.privateInformation = pairs.slice(cursor, cursor + privatePairCount); cursor += privatePairCount;
  }
  if (state.players.length === 2) state.hiddenInformation = pairs.slice(cursor);
  else { state.publicInformation = pairs[cursor++]; state.hiddenInformation = pairs.slice(cursor); }

  for (const pile of state.stockpiles) pile.cards.push({ card: drawMarket(state), faceUp: true, placedBy: null });
  state.supplyQueue = state.players.length === 2
    ? [...order.map((player) => player.id), ...order.map((player) => player.id)]
    : order.map((player) => player.id);
  state.supplyBatch = 1;
  addLog(state, `第 ${state.round}/${state.totalRounds} 轮开始，内幕信息已经分配。`, now);
  openNextSupply(state, now);
}

function openNextSupply(state, now) {
  if (!state.supplyQueue.length) return beginBidding(state, now);
  const actor = playerById(state, state.supplyQueue[0]);
  actor.supplyHand = [drawMarket(state), drawMarket(state)];
  const placementsDone = (state.players.length === 2 ? 4 : state.players.length) - state.supplyQueue.length;
  state.supplyBatch = state.players.length === 2 && placementsDone >= state.players.length ? 2 : 1;
  setPhase(state, "supply", now, SUPPLY_SECONDS, actor.id);
}

function submitSupply(state, actor, action, now) {
  if (state.currentActorId !== actor.id || actor.supplyHand.length !== 2) throw new GameRuleError("not_your_supply", "当前不需要你配置市场牌。", 409);
  const faceUp = actor.supplyHand.find((card) => card.id === String(action.faceUpCardId));
  const faceDown = actor.supplyHand.find((card) => card.id === String(action.faceDownCardId));
  if (!faceUp || !faceDown || faceUp.id === faceDown.id) throw new GameRuleError("invalid_supply_cards", "必须分别选择一张明牌和一张暗牌。", 409);
  const upPile = state.stockpiles.find((pile) => pile.id === String(action.faceUpPileId));
  const downPile = state.stockpiles.find((pile) => pile.id === String(action.faceDownPileId));
  if (!upPile || !downPile) throw new GameRuleError("invalid_stockpile", "请选择合法的股票堆。", 409);
  upPile.cards.push({ card: faceUp, faceUp: true, placedBy: actor.id });
  downPile.cards.push({ card: faceDown, faceUp: false, placedBy: actor.id });
  actor.supplyHand = [];
  state.supplyQueue.shift();
  addLog(state, `${actor.name} 向市场放入了一张明牌和一张暗牌。`, now);
  openNextSupply(state, now);
}

function bidTokenOwner(state, tokenId) {
  const token = state.bidTokens.find((item) => item.id === String(tokenId));
  return token ? playerById(state, token.ownerId) : null;
}

function beginBidding(state, now) {
  const order = orderedPlayers(state);
  const tokenCount = biddingTokenCount(state.players.length);
  state.bidTokens = order.flatMap((player) => Array.from({ length: tokenCount }, (_, index) => ({
    id: `${player.id}_bid_${index + 1}`, ownerId: player.id, pileId: null, amount: null
  })));
  state.bidQueue = tokenCount === 2
    ? Array.from({ length: tokenCount }, (_, tokenIndex) => order.map((player) => `${player.id}_bid_${tokenIndex + 1}`)).flat()
    : order.map((player) => `${player.id}_bid_1`);
  openNextBid(state, now);
}

function openNextBid(state, now) {
  if (!state.bidQueue.length) return resolveStockpiles(state, now);
  const owner = bidTokenOwner(state, state.bidQueue[0]);
  setPhase(state, "bidding", now, BID_SECONDS, owner.id);
}

function placeBid(state, actor, action, now) {
  const token = state.bidTokens.find((item) => item.id === state.bidQueue[0]);
  if (!token || token.ownerId !== actor.id) throw new GameRuleError("not_your_bid", "当前不需要你竞价。", 409);
  const pile = state.stockpiles.find((item) => item.id === String(action.pileId));
  const amount = Number(action.amount);
  if (!pile || !BID_LEVELS.includes(amount)) throw new GameRuleError("invalid_bid", "请选择合法股票堆和竞价档位。", 409);
  const top = state.bidTokens.find((item) => item.pileId === pile.id);
  if (top && amount <= top.amount) throw new GameRuleError("bid_too_low", "新报价必须高于当前报价。", 409);
  const ownOther = state.bidTokens.filter((item) => item.ownerId === actor.id && item.id !== token.id && item.pileId);
  if (ownOther.some((item) => item.pileId === pile.id)) throw new GameRuleError("duplicate_player_pile", "你的两个竞价标记不能位于同一股票堆。", 409);
  if (ownOther.reduce((sum, item) => sum + item.amount, 0) + amount > actor.cash) throw new GameRuleError("bid_exceeds_cash", "你的全部有效报价不能超过现有现金。", 409);
  state.bidQueue.shift();
  if (top) {
    top.pileId = null; top.amount = null;
    if (!state.bidQueue.includes(top.id)) state.bidQueue.push(top.id);
  }
  token.pileId = pile.id; token.amount = amount;
  addLog(state, `${actor.name} 在 ${pile.id.replace("pile_", "股票堆 ")} 报价 ${cashText(amount)}。`, now);
  openNextBid(state, now);
}

function resolveStockpiles(state, now) {
  for (const token of state.bidTokens) {
    const player = playerById(state, token.ownerId);
    const pile = state.stockpiles.find((item) => item.id === token.pileId);
    const publicCards = pile.cards.filter((entry) => entry.faceUp).map((entry) => cardLabel(entry.card));
    player.cash -= token.amount;
    for (const entry of pile.cards) {
      const card = entry.card;
      if (card.kind === "stock") player.portfolio.push(card);
      else if (card.kind === "action") player.actionCards.push(card);
      else if (player.cash >= card.amount) {
        player.cash -= card.amount; state.discard.push(card);
        addLog(state, `${player.name} 支付了 ${cashText(card.amount)} 交易费。`, now);
      } else {
        player.debts.push({ id: card.id, kind: "fee", amount: card.amount });
        addLog(state, `${player.name} 暂时无力支付 ${cashText(card.amount)} 交易费，形成公开欠款。`, now);
      }
    }
    addLog(state, `${player.name} 以 ${cashText(token.amount)} 获得 ${pile.id.replace("pile_", "股票堆 ")}；其中已公开：${publicCards.join("、") || "无"}。`, now);
    pile.cards = [];
  }
  state.actionQueue = orderedPlayers(state).flatMap((player) => player.actionCards.map((card) => ({ ownerId: player.id, cardId: card.id, actionType: card.actionType })));
  openNextMarketAction(state, now);
}

function openNextMarketAction(state, now) {
  if (!state.actionQueue.length) return beginSelling(state, now);
  setPhase(state, "marketAction", now, MARKET_ACTION_SECONDS, state.actionQueue[0].ownerId);
}

function playMarketAction(state, actor, companyId, now) {
  const pending = state.actionQueue[0];
  if (!pending || pending.ownerId !== actor.id || !companyById(companyId)) throw new GameRuleError("invalid_market_action", "当前不能对这家公司执行行动。", 409);
  const cardIndex = actor.actionCards.findIndex((card) => card.id === pending.cardId);
  if (cardIndex < 0) throw new GameRuleError("action_card_missing", "行动牌已经不存在。", 409);
  const [card] = actor.actionCards.splice(cardIndex, 1); state.discard.push(card); state.actionQueue.shift();
  resolvePriceMove(state, companyId, card.actionType === ACTION_TYPES.BOOM ? 2 : -2, now, `${actor.name} 使用${cardLabel(card)}`);
  openNextMarketAction(state, now);
}

function beginSelling(state, now) {
  state.turnQueue = orderedPlayers(state).map((player) => player.id);
  openNextSeller(state, now);
}

function openNextSeller(state, now, random = Math.random) {
  if (!state.turnQueue.length) return beginMovement(state, now, random);
  setPhase(state, "selling", now, SELL_SECONDS, state.turnQueue[0]);
}

function normalizeSale(value) {
  const number = Number(value ?? 0);
  if (!Number.isInteger(number) || number < 0) throw new GameRuleError("invalid_sale", "卖出数量必须是非负整数。", 409);
  return number;
}

function takeCompanyCards(cards, companyId, count) {
  const taken = [];
  for (let index = cards.length - 1; index >= 0 && taken.length < count; index -= 1) {
    if (cards[index].companyId === companyId) taken.push(...cards.splice(index, 1));
  }
  return taken;
}

function submitSales(state, actor, sales, now, random) {
  if (state.turnQueue[0] !== actor.id) throw new GameRuleError("not_your_sale", "当前不需要你卖出股票。", 409);
  const rows = Array.isArray(sales) ? sales : [];
  let proceeds = 0;
  const publicDetails = [];
  const normalized = rows.map((row) => ({ companyId: String(row.companyId), normal: normalizeSale(row.normal), splitFull: normalizeSale(row.splitFull), splitHalf: normalizeSale(row.splitHalf) }));
  if (new Set(normalized.map((row) => row.companyId)).size !== normalized.length || normalized.some((row) => !companyById(row.companyId))) throw new GameRuleError("invalid_sale", "卖出清单包含重复或未知公司。", 409);
  for (const row of normalized) {
    const normalOwned = actor.portfolio.filter((card) => card.companyId === row.companyId).length;
    const splitOwned = actor.splitPortfolio.filter((card) => card.companyId === row.companyId).length;
    if (row.normal > normalOwned || row.splitFull + row.splitHalf > splitOwned) throw new GameRuleError("sale_exceeds_holding", "卖出数量超过实际持股。", 409);
  }
  for (const row of normalized) {
    const price = state.stockPrices[row.companyId];
    const normal = takeCompanyCards(actor.portfolio, row.companyId, row.normal);
    const splitFull = takeCompanyCards(actor.splitPortfolio, row.companyId, row.splitFull);
    const splitHalf = takeCompanyCards(actor.splitPortfolio, row.companyId, row.splitHalf);
    actor.portfolio.push(...splitHalf);
    state.discard.push(...normal, ...splitFull);
    proceeds += normal.length * price * 1_000 + splitFull.length * price * 2_000 + splitHalf.length * price * 1_000;
    if (normal.length || splitFull.length || splitHalf.length) {
      const parts = [normal.length ? `普通股${normal.length}` : "", splitFull.length ? `拆股整卖${splitFull.length}` : "", splitHalf.length ? `拆股卖一股${splitHalf.length}` : ""].filter(Boolean);
      publicDetails.push(`${companyById(row.companyId).short}（${parts.join("、")}）`);
    }
  }
  credit(actor, proceeds, state, now);
  state.turnQueue.shift();
  addLog(state, proceeds ? `${actor.name} 卖出 ${publicDetails.join("；")}，获得 ${cashText(proceeds)}。` : `${actor.name} 本轮没有卖出股票。`, now);
  openNextSeller(state, now, random);
}

function beginMovement(state, now, random) {
  state.revealedInformation = [];
  state.movementQueue = [
    ...orderedPlayers(state).flatMap((player) => player.privateInformation.map((pair) => ({ ...pair, source: "player", ownerId: player.id }))),
    ...(state.publicInformation ? [{ ...state.publicInformation, source: "public", ownerId: null }] : []),
    ...state.hiddenInformation.map((pair) => ({ ...pair, source: "hidden", ownerId: null }))
  ];
  processMovement(state, now, random);
}

function processMovement(state, now, random) {
  while (state.movementQueue.length) {
    const pair = state.movementQueue.shift();
    state.revealedInformation.push(pair);
    const forecast = forecastById(pair.forecastId);
    if (forecast.kind === "dividend") {
      state.pendingDividend = { companyId: pair.companyId, pair, queue: orderedPlayers(state).filter((player) => sharesHeld(player, pair.companyId) > 0).map((player) => player.id) };
      if (!state.pendingDividend.queue.length) { state.pendingDividend = null; continue; }
      return openNextDividend(state,now, random);
    }
    resolvePriceMove(state, pair.companyId, forecast.value, now, `行情公布 ${forecast.label}`);
  }
  finishRound(state, now, random);
}

function openNextDividend(state, now, random) {
  if (!state.pendingDividend?.queue.length) { state.pendingDividend = null; return processMovement(state, now, random); }
  setPhase(state, "dividend", now, DIVIDEND_SECONDS, state.pendingDividend.queue[0]);
}

function submitDividend(state, actor, action, now, random) {
  const pending = state.pendingDividend;
  if (!pending || pending.queue[0] !== actor.id) throw new GameRuleError("not_your_dividend", "当前不需要你选择分红公开数量。", 409);
  const normal = normalizeSale(action.normal); const split = normalizeSale(action.split);
  const normalOwned = actor.portfolio.filter((card) => card.companyId === pending.companyId).length;
  const splitOwned = actor.splitPortfolio.filter((card) => card.companyId === pending.companyId).length;
  if (normal > normalOwned || split > splitOwned) throw new GameRuleError("dividend_exceeds_holding", "公开数量超过实际持股。", 409);
  const shares = normal + split * 2; const payout = shares * DIVIDEND_PER_SHARE;
  credit(actor, payout, state, now); pending.queue.shift();
  addLog(state, shares ? `${actor.name} 公开 ${shares} 股并领取 ${cashText(payout)} 分红。` : `${actor.name} 放弃公开持股和本次分红。`, now);
  openNextDividend(state, now, random);
}

function finishRound(state, now, random) {
  if (state.round >= state.totalRounds) return finishGame(state, now);
  state.firstPlayerIndex = (state.firstPlayerIndex + 1) % state.players.length;
  setPhase(state, "roundReview", now, REVIEW_SECONDS);
  addLog(state, `第 ${state.round} 轮行情结算完毕，${REVIEW_SECONDS} 秒后进入下一轮。`, now);
}

function finishGame(state, now) {
  const bonuses = Object.fromEntries(state.players.map((player) => [player.id, 0]));
  for (const company of COMPANIES) {
    const counts = state.players.map((player) => ({ player, shares: sharesHeld(player, company.id) }));
    const maximum = Math.max(...counts.map((entry) => entry.shares));
    if (maximum <= 0) continue;
    const leaders = counts.filter((entry) => entry.shares === maximum);
    const bonus = leaders.length === 1 ? MAJORITY_BONUS : TIED_MAJORITY_BONUS;
    for (const entry of leaders) bonuses[entry.player.id] += bonus;
  }
  state.finalScores = state.players.map((player) => {
    const shareValue = COMPANIES.reduce((sum, company) => sum + sharesHeld(player, company.id) * state.stockPrices[company.id] * 1_000, 0);
    const debtValue = player.debts.reduce((sum, debt) => sum + debt.amount, 0);
    return { playerId: player.id, cash: player.cash, shareValue, majorityBonus: bonuses[player.id], debtValue, total: player.cash + shareValue + bonuses[player.id] - debtValue };
  });
  const best = Math.max(...state.finalScores.map((score) => score.total));
  state.winnerIds = state.finalScores.filter((score) => score.total === best).map((score) => score.playerId);
  setPhase(state, "ended", now);
  addLog(state, `${state.winnerIds.map((id) => playerById(state, id).name).join("、")} 以最高净资产赢得本局。`, now);
}

function beginGame(state, now, random) {
  resetToLobby(state, now);
  state.marketDeck = shuffle(createMarketDeck(), random);
  state.totalRounds = roundsFor(state.players.length);
  state.firstPlayerIndex = Math.floor(random() * state.players.length);
  for (const player of state.players) player.cash = state.players.length === 2 ? TWO_PLAYER_STARTING_CASH : STARTING_CASH;
  dealStartingStocks(state, random);
  state.round = 0;
  beginRound(state, now, random);
}

export function createLobby({ capacity, host }) {
  const state = { stateVersion: STATE_VERSION, phase: "lobby", capacity: assertCapacity(capacity), players: [makePlayer({ ...host, isHost: true })], logs: [], logSequence: 0 };
  resetToLobby(state); return state;
}

export function addPlayer(state, player) {
  if (state.phase !== "lobby") throw new GameRuleError("game_started", "游戏开始后不能加入玩家席。", 409);
  if (state.players.length >= state.capacity) throw new GameRuleError("room_full", "玩家席已满。", 409);
  if (playerById(state, player.id)) throw new GameRuleError("player_exists", "该玩家已在房间中。", 409);
  const next = makePlayer(player); state.players.push(next); return next;
}

export function removePlayer(state, actorId, playerId) {
  requireHost(state, actorId);
  const index = state.players.findIndex((player) => player.id === String(playerId)); const target = state.players[index];
  if (!target || target.isHost) throw new GameRuleError("invalid_kick_target", "无法移出该玩家。");
  state.players.splice(index, 1); if (state.phase !== "lobby") resetToLobby(state); return target;
}

export function canChangeSeats(state) { return state.phase === "lobby"; }

export function vacateSeat(state, playerId, { now = Date.now() } = {}) {
  if (!canChangeSeats(state)) throw new GameRuleError("seat_change_unavailable", "游戏开始后不能转入旁观席。", 409);
  const index = state.players.findIndex((player) => player.id === String(playerId)); const target = state.players[index];
  if (!target || target.isHost) throw new GameRuleError("invalid_seat_target", "房主必须留在玩家席。", 403);
  state.players.splice(index, 1); addLog(state, `${target.name} 转入旁观席。`, now); return target;
}

export function setPresence(state, playerId, connected) {
  const player = playerById(state, playerId);
  if (!player || player.connected === Boolean(connected)) return false;
  player.connected = Boolean(connected); return true;
}

export function applyAction(state, actorId, action, { now = Date.now(), random = Math.random } = {}) {
  const actor = requireActor(state, actorId); const type = action?.type;
  if (type === "setCapacity") {
    requireHost(state, actorId); if (state.phase !== "lobby") throw new GameRuleError("game_started", "游戏开始后不能修改人数。", 409);
    const capacity = assertCapacity(action.capacity); if (capacity < state.players.length) throw new GameRuleError("capacity_too_small", "人数不能少于当前玩家数。", 409); state.capacity = capacity; return;
  }
  if (type === "start" || type === "restart") {
    requireHost(state, actorId);
    if (type === "start" && state.phase !== "lobby") throw new GameRuleError("already_started", "游戏已经开始。", 409);
    if (type === "restart" && state.phase !== "ended") throw new GameRuleError("restart_unavailable", "当前不能重新开始。", 409);
    if (state.players.length !== state.capacity) throw new GameRuleError("players_missing", `需要 ${state.capacity} 人到齐。`, 409);
    if (state.players.some((player) => !player.connected)) throw new GameRuleError("players_offline", "所有玩家在线后才能开始。", 409);
    beginGame(state, now, random); return;
  }
  if (type === "end") { requireHost(state, actorId); if (state.phase === "lobby") throw new GameRuleError("game_not_started", "当前没有牌局。", 409); resetToLobby(state, now); return; }
  if (state.phase === "supply" && type === "placeSupply") return submitSupply(state, actor, action, now);
  if (state.phase === "bidding" && type === "placeBid") return placeBid(state, actor, action, now);
  if (state.phase === "marketAction" && type === "playMarketAction") return playMarketAction(state, actor, String(action.companyId), now);
  if (state.phase === "selling" && type === "submitSales") return submitSales(state, actor, action.sales, now, random);
  if (state.phase === "dividend" && type === "submitDividend") return submitDividend(state, actor, action, now, random);
  throw new GameRuleError("action_unavailable", "当前阶段不能执行这个操作。", 409);
}

function cheapestTimeoutBid(state, token, random) {
  const actor = playerById(state, token.ownerId);
  const otherTotal = state.bidTokens.filter((item) => item.ownerId === actor.id && item.id !== token.id && item.pileId).reduce((sum, item) => sum + item.amount, 0);
  const ownPileIds = new Set(state.bidTokens.filter((item) => item.ownerId === actor.id && item.id !== token.id && item.pileId).map((item) => item.pileId));
  const options = [];
  for (const pile of state.stockpiles) {
    if (ownPileIds.has(pile.id)) continue;
    const top = state.bidTokens.find((item) => item.pileId === pile.id);
    for (const amount of BID_LEVELS) if ((!top || amount > top.amount) && amount + otherTotal <= actor.cash) { options.push({ pileId: pile.id, amount }); break; }
  }
  if (!options.length) throw new GameRuleError("no_affordable_bid", "没有可承担的合法报价。", 409);
  const minimum = Math.min(...options.map((option) => option.amount));
  const cheapest = options.filter((option) => option.amount === minimum);
  return cheapest[Math.floor(random() * cheapest.length)];
}

export function handleTimeout(state, { now = Date.now(), random = Math.random } = {}) {
  if (["lobby", "ended"].includes(state.phase) || !state.deadline || now < state.deadline) return false;
  if (state.phase === "roundReview") { beginRound(state, now, random); return true; }
  const actor = currentPlayer(state);
  if (state.phase === "supply") {
    const hand = shuffle(actor.supplyHand, random); const piles = shuffle(state.stockpiles, random);
    submitSupply(state, actor, { faceUpCardId: hand[0].id, faceDownCardId: hand[1].id, faceUpPileId: piles[0].id, faceDownPileId: piles[piles.length - 1].id }, now);
  } else if (state.phase === "bidding") {
    placeBid(state, actor, cheapestTimeoutBid(state, state.bidTokens.find((token) => token.id === state.bidQueue[0]), random), now);
  } else if (state.phase === "marketAction") {
    playMarketAction(state, actor, COMPANIES[Math.floor(random() * COMPANIES.length)].id, now);
  } else if (state.phase === "selling") {
    submitSales(state, actor, [], now, random);
  } else if (state.phase === "dividend") {
    submitDividend(state, actor, { normal: 0, split: 0 }, now, random);
  } else return false;
  addLog(state, `${actor.name} 操作超时，服务器执行了默认选择。`, now); return true;
}

export function getDeadline(state) { return Number(state.deadline) || 0; }

function hiddenCard(entry, pile, index, viewerId) {
  if (entry.faceUp || entry.placedBy === viewerId) return { ...entry.card, faceUp: entry.faceUp, knownFromOwnPlacement: !entry.faceUp };
  return { id: `${pile.id}_hidden_${index + 1}`, kind: "hidden", faceUp: false };
}

function playerView(player, viewerId, revealAll = false) {
  const own = player.id === viewerId || revealAll;
  return {
    id: player.id, name: player.name, isHost: player.isHost, connected: player.connected, cash: player.cash,
    debts: player.debts.map((debt) => debt.amount), portfolioCount: player.portfolio.length, splitPortfolioCount: player.splitPortfolio.length,
    portfolio: own ? player.portfolio.map(clone) : [], splitPortfolio: own ? player.splitPortfolio.map(clone) : [],
    privateInformation: own ? player.privateInformation.map(clone) : []
  };
}

function permissionsFor(state, viewer) {
  const ownTurn = viewer && state.currentActorId === viewer.id;
  return {
    canManage: Boolean(viewer?.isHost), canKick: Boolean(viewer?.isHost), canSetCapacity: Boolean(viewer?.isHost && state.phase === "lobby"),
    canStart: Boolean(viewer?.isHost && state.phase === "lobby"), canEnd: Boolean(viewer?.isHost && state.phase !== "lobby"), canRestart: Boolean(viewer?.isHost && state.phase === "ended"),
    canPlaceSupply: Boolean(ownTurn && state.phase === "supply"), canBid: Boolean(ownTurn && state.phase === "bidding"),
    canPlayMarketAction: Boolean(ownTurn && state.phase === "marketAction"), canSell: Boolean(ownTurn && state.phase === "selling"),
    canChooseDividend: Boolean(ownTurn && state.phase === "dividend")
  };
}

function publicView(state, viewer = null) {
  return {
    selfId: viewer?.id || null, phase: state.phase, capacity: state.capacity, round: state.round, totalRounds: state.totalRounds,
    supplyBatch: state.supplyBatch,
    firstPlayerId: state.players[state.firstPlayerIndex]?.id || null, currentPlayerId: state.currentActorId, deadline: state.deadline,
    deckCount: state.marketDeck.length, stockPrices: clone(state.stockPrices), publicInformation: clone(state.publicInformation),
    revealedInformation: state.revealedInformation.map(clone), hiddenInformationCount: state.hiddenInformation.length,
    stockpiles: state.stockpiles.map((pile) => ({ id: pile.id, cards: pile.cards.map((entry, index) => hiddenCard(entry, pile, index, viewer?.id || null)) })),
    bidTokens: state.bidTokens.map(clone), currentBidTokenId: state.bidQueue[0] || null,
    marketAction: state.actionQueue[0] ? clone(state.actionQueue[0]) : null,
    pendingDividend: state.pendingDividend ? { companyId: state.pendingDividend.companyId, currentPlayerId: state.pendingDividend.queue[0] || null } : null,
    players: state.players.map((player) => playerView(player, viewer?.id || null, state.phase === "ended")),
    supplyHand: viewer ? viewer.supplyHand.map(clone) : [],
    finalScores: state.phase === "ended" ? state.finalScores.map(clone) : [], winnerIds: [...state.winnerIds],
    logs: state.logs.map(clone), permissions: permissionsFor(state, viewer)
  };
}

export function buildView(state, viewerId) { return publicView(state, requireActor(state, viewerId)); }
export function buildSpectatorView(state) { return publicView(state, null); }

export function validateState(state) {
  if (!state || !Array.isArray(state.players)) throw new Error("Invalid game17 state");
  if (state.phase === "lobby") return true;
  if (state.players.length < MIN_PLAYERS || state.players.length > MAX_PLAYERS) throw new Error("Invalid player count");
  if (Object.values(state.stockPrices).some((price) => !Number.isInteger(price) || price < 1 || price > 10)) throw new Error("Invalid stock price");
  const cards = [
    ...state.marketDeck, ...state.discard,
    ...state.stockpiles.flatMap((pile) => pile.cards.map((entry) => entry.card)),
    ...state.players.flatMap((player) => [...player.portfolio, ...player.splitPortfolio, ...player.supplyHand, ...player.actionCards, ...player.debts])
  ];
  const ids = cards.map((card) => card.id);
  if (cards.length !== 80 || new Set(ids).size !== 80) throw new Error(`Market card conservation failed: ${cards.length}/${new Set(ids).size}`);
  if (state.players.some((player) => !Number.isInteger(player.cash) || player.cash < 0)) throw new Error("Invalid player cash");
  return true;
}

export function serializeState(state) { validateState(state); return clone(state); }
export function restoreState(serializedState) {
  if (serializedState?.stateVersion !== STATE_VERSION) throw new Error(`Unsupported game17 state version: ${serializedState?.stateVersion}`);
  const state = clone(serializedState); validateState(state); return state;
}
