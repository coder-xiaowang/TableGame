import {
  ACTION_SECONDS, STARTING_CHIPS, blindInfo, cardKey, compareRanks, createDeck, evaluateBestFive, rankName
} from "../rules.mjs";

export const STATE_VERSION = 1;
export { ACTION_SECONDS };
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const SUPPORTS_SPECTATORS = true;
const SHOWDOWN_RESULT_MS = 9000;
const UNCONTESTED_RESULT_MS = 4500;

export class GameRuleError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "GameRuleError";
    this.code = code;
    this.status = status;
  }
}

function assertCapacity(capacity) {
  const value = Number(capacity);
  if (!Number.isInteger(value) || value < MIN_PLAYERS || value > MAX_PLAYERS) {
    throw new GameRuleError("invalid_capacity", "牌桌人数必须为 2–6 人。");
  }
  return value;
}

function cleanName(value, fallback = "玩家") {
  return String(value ?? "").trim().slice(0, 12) || fallback;
}

function makePlayer({ id, name, isHost = false, connected = false }) {
  if (!id) throw new GameRuleError("player_id_required", "缺少玩家身份。");
  return {
    id: String(id), name: cleanName(name, isHost ? "房主" : "玩家"), isHost: Boolean(isHost),
    connected: Boolean(connected), chips: STARTING_CHIPS, status: "active", hole: [], folded: false,
    allIn: false, streetBet: 0, totalBet: 0, acted: false
  };
}

function requireHost(state, actorId) {
  const actor = state.players.find((player) => player.id === String(actorId));
  if (!actor?.isHost) throw new GameRuleError("host_required", "只有房主可以执行此操作。", 403);
  return actor;
}

function addLog(state, text, now = Date.now()) {
  state.logs.unshift({ id: `poker_log_${now}_${state.logSequence += 1}`, text: String(text), at: now });
  if (state.logs.length > 100) state.logs.length = 100;
}

function alive(state) {
  return state.players.filter((player) => player.status === "active" && player.chips > 0);
}

function live(state) {
  return state.players.filter((player) => player.status === "active" && !player.folded);
}

function canAct(player) {
  return player?.status === "active" && !player.folded && !player.allIn && player.chips > 0;
}

function nextIndex(state, from, predicate = (player) => player.status === "active" && player.chips > 0) {
  for (let step = 1; step <= state.players.length; step += 1) {
    const index = (from + step + state.players.length) % state.players.length;
    if (predicate(state.players[index])) return index;
  }
  return null;
}

function currentBlind(state) {
  return blindInfo(state.handNumber);
}

function postBlind(state, index, amount, label, now) {
  const player = state.players[index];
  const paid = Math.min(amount, player.chips);
  player.chips -= paid;
  player.streetBet = paid;
  player.totalBet = paid;
  if (player.chips === 0) player.allIn = true;
  addLog(state, `${player.name} 支付${label} ${paid}`, now);
}

function beginDecision(state, now) {
  const player = state.players[state.currentIndex];
  if (!player || !canAct(player)) {
    if (roundComplete(state)) return advanceStreet(state, now);
    state.currentIndex = nextIndex(state, state.currentIndex ?? state.dealerIndex, canAct);
  }
  state.deadline = now + ACTION_SECONDS * 1000;
}

function roundComplete(state) {
  const actors = state.players.filter(canAct);
  if (!actors.length) return true;
  if (actors.length === 1 && actors[0].streetBet === state.currentBet) return true;
  return actors.every((player) => player.acted && player.streetBet === state.currentBet);
}

function commit(player, amount) {
  const paid = Math.min(amount, player.chips);
  player.chips -= paid;
  player.streetBet += paid;
  player.totalBet += paid;
  if (player.chips === 0) player.allIn = true;
  return paid;
}

function pots(state) {
  const levels = [...new Set(state.players.map((player) => player.totalBet).filter(Boolean))].sort((a, b) => a - b);
  let previous = 0;
  return levels.map((level) => {
    const contributors = state.players.filter((player) => player.totalBet >= level);
    const amount = (level - previous) * contributors.length;
    const eligible = contributors.filter((player) => !player.folded && player.status === "active").map((player) => player.id);
    previous = level;
    return { amount, eligible };
  }).filter((pot) => pot.amount > 0);
}

function finishTournament(state, now) {
  state.phase = "ended";
  state.currentIndex = null;
  state.deadline = 0;
  const winner = alive(state)[0];
  state.winnerIds = winner ? [winner.id] : [];
  if (winner) addLog(state, `${winner.name} 获得锦标赛冠军！`, now);
}

function endHand(state, showdown, now) {
  state.currentIndex = null;
  state.showdown = Boolean(showdown);
  for (const player of state.players) {
    if (player.status === "active" && player.chips === 0) {
      player.status = "eliminated";
      addLog(state, `${player.name} 被淘汰`, now);
    }
  }
  state.phase = "handResult";
  state.deadline = now + (showdown ? SHOWDOWN_RESULT_MS : UNCONTESTED_RESULT_MS);
}

function awardUncontested(state, now) {
  const winner = live(state)[0];
  const amount = state.players.reduce((sum, player) => sum + player.totalBet, 0);
  if (winner) {
    winner.chips += amount;
    state.handWinners = [{ potIndex: 0, potLabel: "底池", ids: [winner.id], amount, rankName: "其他玩家均弃牌", payouts: [{ playerId: winner.id, amount }] }];
    addLog(state, `${winner.name} 赢得底池 ${amount}（其他玩家均弃牌）`, now);
  }
  endHand(state, false, now);
}

function winnerOrderFromDealer(state, winners) {
  const ordered = [];
  for (let step = 1; step <= state.players.length; step += 1) {
    const player = state.players[(state.dealerIndex + step) % state.players.length];
    if (winners.includes(player)) ordered.push(player);
  }
  return ordered;
}

function showdown(state, now) {
  state.showdown = true;
  state.handWinners = [];
  state.showdownResults = [];
  const rankings = new Map();
  for (const player of state.players.filter((item) => item.status === "active" && !item.folded)) {
    const result = evaluateBestFive([...player.hole, ...state.board]);
    const publicResult = { playerId: player.id, rank: [...result.rank], rankName: rankName(result.rank), bestFive: result.cards.map((card) => ({ ...card })) };
    rankings.set(player.id, publicResult);
    state.showdownResults.push(publicResult);
  }
  const allPots = pots(state);
  for (let potIndex = 0; potIndex < allPots.length; potIndex += 1) {
    const pot = allPots[potIndex];
    const candidates = state.players.filter((player) => pot.eligible.includes(player.id));
    if (!candidates.length) continue;
    let best = null;
    let winners = [];
    for (const player of candidates) {
      const rank = rankings.get(player.id).rank;
      if (!best || compareRanks(rank, best) > 0) { best = rank; winners = [player]; }
      else if (compareRanks(rank, best) === 0) winners.push(player);
    }
    const share = Math.floor(pot.amount / winners.length);
    const remainder = pot.amount % winners.length;
    const ordered = winnerOrderFromDealer(state, winners);
    const payouts = winners.map((winner) => ({ playerId: winner.id, amount: share }));
    for (const payout of payouts) state.players.find((player) => player.id === payout.playerId).chips += payout.amount;
    for (let index = 0; index < remainder; index += 1) {
      const receiver = ordered[index % ordered.length];
      receiver.chips += 1;
      payouts.find((payout) => payout.playerId === receiver.id).amount += 1;
    }
    const label = rankName(best);
    state.handWinners.push({
      potIndex,
      potLabel: allPots.length === 1 ? "底池" : potIndex === 0 ? "主池" : `边池 ${potIndex}`,
      ids: winners.map((winner) => winner.id),
      amount: pot.amount,
      rankName: label,
      payouts
    });
    addLog(state, `${winners.map((winner) => winner.name).join("、")} 以${label}赢得 ${pot.amount}`, now);
  }
  endHand(state, true, now);
}

function burnAndDeal(state, count) {
  state.burned.push(state.deck.pop());
  for (let index = 0; index < count; index += 1) state.board.push(state.deck.pop());
}

function advanceStreet(state, now) {
  if (state.street === "river") return showdown(state, now);
  for (const player of state.players) { player.streetBet = 0; player.acted = false; }
  state.currentBet = 0;
  state.lastFullRaise = currentBlind(state).bb;
  if (state.street === "preflop") { burnAndDeal(state, 3); state.street = "flop"; }
  else if (state.street === "flop") { burnAndDeal(state, 1); state.street = "turn"; }
  else { burnAndDeal(state, 1); state.street = "river"; }
  addLog(state, ({ flop: "翻牌", turn: "转牌", river: "河牌" })[state.street], now);
  const actors = state.players.filter(canAct);
  if (actors.length <= 1) return advanceStreet(state, now);
  state.currentIndex = nextIndex(state, state.dealerIndex, canAct);
  beginDecision(state, now);
}

function afterAction(state, now) {
  if (live(state).length === 1) return awardUncontested(state, now);
  if (roundComplete(state)) return advanceStreet(state, now);
  state.currentIndex = nextIndex(state, state.currentIndex, canAct);
  beginDecision(state, now);
}

function startHand(state, now, random) {
  if (alive(state).length <= 1) return finishTournament(state, now);
  state.phase = "playing";
  state.handNumber += 1;
  state.showdown = false;
  state.handWinners = [];
  state.showdownResults = [];
  state.street = "preflop";
  state.board = [];
  state.burned = [];
  state.deck = createDeck(random);
  state.currentBet = 0;
  state.deadline = 0;
  for (const player of state.players) {
    player.hole = [];
    player.folded = player.status !== "active";
    player.allIn = false;
    player.streetBet = 0;
    player.totalBet = 0;
    player.acted = false;
  }
  state.dealerIndex = nextIndex(state, state.dealerIndex);
  const active = alive(state);
  state.smallBlindIndex = active.length === 2 ? state.dealerIndex : nextIndex(state, state.dealerIndex);
  state.bigBlindIndex = nextIndex(state, state.smallBlindIndex);
  for (let round = 0; round < 2; round += 1) {
    for (let step = 1; step <= state.players.length; step += 1) {
      const player = state.players[(state.dealerIndex + step) % state.players.length];
      if (player.status === "active") player.hole.push(state.deck.pop());
    }
  }
  const blind = currentBlind(state);
  postBlind(state, state.smallBlindIndex, blind.sb, "小盲", now);
  postBlind(state, state.bigBlindIndex, blind.bb, "大盲", now);
  state.currentBet = blind.bb;
  state.lastFullRaise = blind.bb;
  state.currentIndex = nextIndex(state, state.bigBlindIndex, canAct);
  addLog(state, `第 ${state.handNumber} 手开始，盲注 ${blind.sb}/${blind.bb}`, now);
  beginDecision(state, now);
}

function resetToLobby(state) {
  state.phase = "lobby";
  state.handNumber = 0;
  state.dealerIndex = -1;
  state.street = "waiting";
  state.board = [];
  state.burned = [];
  state.deck = [];
  state.currentIndex = null;
  state.currentBet = 0;
  state.lastFullRaise = 20;
  state.smallBlindIndex = null;
  state.bigBlindIndex = null;
  state.deadline = 0;
  state.logs = [];
  state.logSequence = 0;
  state.showdown = false;
  state.handWinners = [];
  state.showdownResults = [];
  state.winnerIds = [];
  for (const player of state.players) Object.assign(player, {
    chips: STARTING_CHIPS, status: "active", hole: [], folded: false, allIn: false,
    streetBet: 0, totalBet: 0, acted: false
  });
}

export function createLobby({ capacity, host }) {
  return {
    stateVersion: STATE_VERSION, phase: "lobby", capacity: assertCapacity(capacity),
    players: [makePlayer({ ...host, isHost: true })], handNumber: 0, dealerIndex: -1,
    street: "waiting", board: [], burned: [], deck: [], currentIndex: null, currentBet: 0,
    lastFullRaise: 20, smallBlindIndex: null, bigBlindIndex: null, deadline: 0,
    logs: [], logSequence: 0, showdown: false, showdownResults: [], handWinners: [], winnerIds: []
  };
}

export function addPlayer(state, player, { now = Date.now() } = {}) {
  if (state.phase !== "lobby") throw new GameRuleError("game_started", "锦标赛开始后不能加入玩家席。", 409);
  if (state.players.length >= state.capacity) throw new GameRuleError("room_full", "牌桌人数已满。", 409);
  if (state.players.some((item) => item.id === String(player.id))) throw new GameRuleError("player_exists", "该玩家已在牌桌中。", 409);
  const next = makePlayer(player);
  state.players.push(next);
  addLog(state, `${next.name} 加入牌桌`, now);
  return next;
}

export function removePlayer(state, actorId, playerId, { now = Date.now() } = {}) {
  requireHost(state, actorId);
  if (state.phase !== "lobby") throw new GameRuleError("game_started", "锦标赛开始后不能移出正式玩家。", 409);
  const index = state.players.findIndex((player) => player.id === String(playerId));
  const target = state.players[index];
  if (!target || target.isHost) throw new GameRuleError("invalid_kick_target", "无法移出该玩家。", 400);
  state.players.splice(index, 1);
  addLog(state, `${target.name} 被移出牌桌`, now);
  return target;
}

export function canChangeSeats(state) { return state.phase === "lobby"; }

export function vacateSeat(state, playerId, { now = Date.now() } = {}) {
  if (!canChangeSeats(state)) throw new GameRuleError("seat_change_unavailable", "锦标赛开始后不能转入旁观席。", 409);
  const index = state.players.findIndex((player) => player.id === String(playerId));
  const target = state.players[index];
  if (!target || target.isHost) throw new GameRuleError("invalid_seat_target", "该玩家不能转入旁观席。", 403);
  state.players.splice(index, 1);
  addLog(state, `${target.name} 转入旁观席`, now);
  return target;
}

export function setPresence(state, playerId, connected, { now = Date.now(), announce = true } = {}) {
  const player = state.players.find((item) => item.id === String(playerId));
  if (!player || player.connected === Boolean(connected)) return false;
  player.connected = Boolean(connected);
  if (announce) addLog(state, `${player.name} ${connected ? "重新连接" : "暂时离线"}`, now);
  return true;
}

function requireTurn(state, actorId) {
  if (state.phase !== "playing" || state.currentIndex == null) throw new GameRuleError("game_not_playing", "当前没有等待中的下注行动。", 409);
  const player = state.players[state.currentIndex];
  if (!player || player.id !== String(actorId)) throw new GameRuleError("not_your_turn", "现在还没有轮到你行动。", 409);
  if (!canAct(player)) throw new GameRuleError("cannot_act", "你当前不能执行下注行动。", 409);
  return player;
}

export function applyAction(state, actorId, action, { now = Date.now(), random = Math.random } = {}) {
  const type = action?.type;
  if (type === "setCapacity") {
    requireHost(state, actorId);
    if (state.phase !== "lobby") throw new GameRuleError("game_started", "锦标赛开始后不能修改人数。", 409);
    const capacity = assertCapacity(action.capacity);
    if (capacity < state.players.length) throw new GameRuleError("capacity_too_small", "人数不能少于当前玩家数。", 409);
    state.capacity = capacity;
    return;
  }
  if (type === "start") {
    requireHost(state, actorId);
    if (state.phase !== "lobby") throw new GameRuleError("already_started", "锦标赛已经开始。", 409);
    if (state.players.length !== state.capacity) throw new GameRuleError("players_missing", `需要 ${state.capacity} 位玩家到齐。`, 409);
    if (state.players.some((player) => !player.connected)) throw new GameRuleError("players_offline", "所有玩家在线后才能开始。", 409);
    state.logs = []; state.logSequence = 0; state.handNumber = 0; state.dealerIndex = -1; state.winnerIds = [];
    for (const player of state.players) Object.assign(player, { chips: STARTING_CHIPS, status: "active" });
    startHand(state, now, random);
    return;
  }
  if (type === "end") {
    requireHost(state, actorId);
    if (state.phase === "lobby") throw new GameRuleError("game_not_started", "当前已在准备阶段。", 409);
    resetToLobby(state);
    return;
  }
  const player = requireTurn(state, actorId);
  const owed = Math.max(0, state.currentBet - player.streetBet);
  if (type === "fold") {
    player.folded = true; player.acted = true; addLog(state, `${player.name} 弃牌`, now);
  } else if (type === "check") {
    if (owed !== 0) throw new GameRuleError("cannot_check", "当前需要跟注，不能过牌。", 409);
    player.acted = true; addLog(state, `${player.name} 过牌`, now);
  } else if (type === "call") {
    if (owed <= 0) throw new GameRuleError("nothing_to_call", "当前没有需要跟注的筹码。", 409);
    const paid = commit(player, owed); player.acted = true;
    addLog(state, `${player.name}${paid < owed ? "全押" : "跟注"} ${paid}`, now);
  } else if (type === "raise") {
    if (player.acted) throw new GameRuleError("raise_not_reopened", "本轮行动尚未被完整加注重新开放。", 409);
    let target = Math.floor(Number(action.target));
    const maximum = player.streetBet + player.chips;
    if (!Number.isFinite(target) || target <= state.currentBet) throw new GameRuleError("invalid_raise", "加注目标必须高于当前下注。", 409);
    target = Math.min(target, maximum);
    const increment = target - state.currentBet;
    const allIn = target === maximum;
    const minimum = state.currentBet === 0 ? currentBlind(state).bb : state.lastFullRaise;
    if (increment < minimum && !allIn) throw new GameRuleError("raise_too_small", `完整加注至少需要增加 ${minimum}。`, 409);
    const paid = target - player.streetBet;
    if (paid <= 0) throw new GameRuleError("invalid_raise", "无效的加注金额。", 409);
    commit(player, paid);
    if (increment >= minimum) {
      state.lastFullRaise = increment;
      for (const other of state.players) if (canAct(other)) other.acted = false;
    }
    state.currentBet = Math.max(state.currentBet, target);
    player.acted = true;
    addLog(state, `${player.name}${player.allIn ? "全押到" : "加注到"} ${target}`, now);
  } else throw new GameRuleError("unknown_action", "无法识别该下注操作。");
  afterAction(state, now);
}

export function handleTimeout(state, { now = Date.now(), random = Math.random } = {}) {
  if (!state.deadline || now < state.deadline) return false;
  if (state.phase === "handResult") {
    if (alive(state).length <= 1) finishTournament(state, now);
    else startHand(state, now, random);
    return true;
  }
  if (state.phase !== "playing" || state.currentIndex == null) return false;
  const player = state.players[state.currentIndex];
  const owed = Math.max(0, state.currentBet - player.streetBet);
  addLog(state, `${player.name} 行动超时，自动${owed === 0 ? "过牌" : "弃牌"}`, now);
  if (owed === 0) { player.acted = true; afterAction(state, now); }
  else { player.folded = true; player.acted = true; afterAction(state, now); }
  return true;
}

function publicPlayer(player, index, state, viewerId, reveal) {
  const maySee = player.id === viewerId || (reveal && !player.folded);
  return {
    id: player.id, name: player.name, isHost: player.isHost, connected: player.connected,
    chips: player.chips, status: player.status,
    hole: maySee ? player.hole.map((card) => ({ ...card })) : player.hole.map(() => null),
    folded: player.folded, allIn: player.allIn, streetBet: player.streetBet,
    totalBet: player.totalBet, acted: player.acted, seat: index
  };
}

function buildPublicState(state, viewerId, permissions) {
  const reveal = state.showdown || state.phase === "ended";
  return {
    selfId: viewerId, phase: state.phase, capacity: state.capacity, handNumber: state.handNumber,
    dealerIndex: state.dealerIndex, street: state.street, board: state.board.map((card) => ({ ...card })),
    deckCount: state.deck.length, currentIndex: state.currentIndex, currentBet: state.currentBet,
    lastFullRaise: state.lastFullRaise, smallBlindIndex: state.smallBlindIndex,
    bigBlindIndex: state.bigBlindIndex, deadline: state.deadline, showdown: state.showdown,
    blind: currentBlind(state), logs: state.logs.map((entry) => ({ ...entry })),
    pots: pots(state).map((pot) => ({ amount: pot.amount, eligible: [...pot.eligible] })),
    showdownResults: state.showdownResults.map((result) => ({
      ...result, rank: [...result.rank], bestFive: result.bestFive.map((card) => ({ ...card }))
    })),
    handWinners: state.handWinners.map((result) => ({
      ...result, ids: [...result.ids], payouts: result.payouts.map((payout) => ({ ...payout }))
    })),
    winnerIds: [...state.winnerIds], actionDurationMs: ACTION_SECONDS * 1000,
    players: state.players.map((player, index) => publicPlayer(player, index, state, viewerId, reveal)),
    permissions
  };
}

export function buildView(state, viewerId) {
  const viewer = state.players.find((player) => player.id === String(viewerId));
  if (!viewer) throw new GameRuleError("not_a_player", "你不属于这张牌桌。", 403);
  return buildPublicState(state, viewer.id, {
    canManage: viewer.isHost, canKick: viewer.isHost && state.phase === "lobby",
    canStart: viewer.isHost && state.phase === "lobby", canEnd: viewer.isHost && state.phase !== "lobby"
  });
}

export function buildSpectatorView(state) {
  return buildPublicState(state, null, { canManage: false, canKick: false, canStart: false, canEnd: false });
}

export function getDeadline(state) {
  return ["playing", "handResult"].includes(state.phase) ? state.deadline : 0;
}

export function validateState(state) {
  if (!state || state.stateVersion !== STATE_VERSION) throw new Error("unsupported poker state version");
  assertCapacity(state.capacity);
  if (!Array.isArray(state.players) || !state.players.length || state.players.length > state.capacity) throw new Error("invalid poker players");
  if (new Set(state.players.map((player) => player.id)).size !== state.players.length) throw new Error("duplicate poker player id");
  if (state.players.filter((player) => player.isHost).length !== 1) throw new Error("poker room must have one host");
  for (const player of state.players) {
    if (!Number.isInteger(player.chips) || player.chips < 0 || !Number.isInteger(player.streetBet) || player.streetBet < 0 || !Number.isInteger(player.totalBet) || player.totalBet < 0) throw new Error("invalid poker chips");
  }
  if (state.phase !== "lobby") {
    const cards = [...state.deck, ...state.board, ...state.burned, ...state.players.flatMap((player) => player.hole)];
    if (cards.length !== 52 || new Set(cards.map(cardKey)).size !== 52) throw new Error("poker card conservation failed");
    const chipTotal = state.players.reduce((sum, player) => sum + player.chips, 0);
    const committed = state.players.reduce((sum, player) => sum + player.totalBet, 0);
    const expected = state.players.length * STARTING_CHIPS;
    if (state.phase === "playing" ? chipTotal + committed !== expected : chipTotal !== expected) throw new Error("poker chip conservation failed");
  }
  return true;
}

export function serializeState(state) {
  validateState(state);
  return structuredClone(state);
}

export function restoreState(serialized) {
  const state = structuredClone(serialized);
  state.showdownResults ??= [];
  state.handWinners ??= [];
  for (const result of state.handWinners) {
    result.potLabel ??= result.potIndex ? `边池 ${result.potIndex}` : "底池";
    result.payouts ??= (result.ids || []).map((playerId) => ({ playerId, amount: 0 }));
  }
  validateState(state);
  return state;
}
