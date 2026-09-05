import {
  CARDS, DEFAULT_TARGET_SCORE, MAX_PLAYERS, MIN_PLAYERS, TARGET_SCORE_OPTIONS,
  cardLabel, createRoundDeck, leftIndex, rightIndex, shuffle
} from "../rules.mjs";

export const STATE_VERSION = 1;
export const SUPPORTS_SPECTATORS = true;
export const TURN_SECONDS = 45;
export const ACTION_SECONDS = TURN_SECONDS;
export const CHOICE_SECONDS = 30;
export const REVEAL_SECONDS = 20;
export const CASE_SECONDS = 45;
export const REVIEW_SECONDS = 8;

const FALLBACK_CASES = Object.freeze([
  "冰箱里珍藏的布丁不见了！",
  "案发现场最后一块蛋糕神秘失踪！",
  "书房里的幸运书签被人拿走了！",
  "客厅里那只最柔软的抱枕不翼而飞！",
  "今天最后一包薯片被悄悄吃掉了！"
]);

export class GameRuleError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "GameRuleError";
    this.code = code;
    this.status = status;
  }
}

const clone = (value) => structuredClone(value);
const cleanName = (value, fallback = "玩家") => String(value ?? "").trim().slice(0, 12) || fallback;
const cleanCase = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 100);
const playerById = (state, id) => state.players.find((player) => player.id === String(id)) || null;
const currentPlayer = (state) => state.players[state.currentIndex] || null;
const culpritHolder = (state) => state.players.find((player) => player.hand.some((card) => card.type === CARDS.CRIMINAL)) || null;
const hasCard = (player, type) => player.hand.some((card) => card.type === type);
const randomItem = (values, random) => values[Math.min(values.length - 1, Math.floor(random() * values.length))];

function assertCapacity(value) {
  const capacity = Number(value);
  if (!Number.isInteger(capacity) || capacity < MIN_PLAYERS || capacity > MAX_PLAYERS) {
    throw new GameRuleError("invalid_capacity", `游戏人数必须为 ${MIN_PLAYERS}～${MAX_PLAYERS} 人。`);
  }
  return capacity;
}

function assertTargetScore(value) {
  const score = Number(value);
  if (!TARGET_SCORE_OPTIONS.includes(score)) throw new GameRuleError("invalid_target_score", "目标分数只能是5分或10分。");
  return score;
}

function requireActor(state, id) {
  const actor = playerById(state, id);
  if (!actor) throw new GameRuleError("not_a_player", "你不在玩家席。", 403);
  return actor;
}

function requireHost(state, id) {
  const actor = requireActor(state, id);
  if (!actor.isHost) throw new GameRuleError("host_required", "只有房主可以执行这个操作。", 403);
  return actor;
}

function makePlayer({ id, name, isHost = false, connected = false }) {
  if (!id) throw new GameRuleError("player_id_required", "缺少玩家身份。");
  return {
    id: String(id),
    name: cleanName(name, isHost ? "房主" : "玩家"),
    isHost: Boolean(isHost),
    connected: Boolean(connected),
    score: 0,
    hand: [],
    turnsTaken: 0,
    accomplice: false
  };
}

function addLog(state, text, now) {
  state.logs.unshift({ id: `log_${state.logSequence += 1}`, text, at: now });
  if (state.logs.length > 140) state.logs.length = 140;
}

function setPhase(state, phase, now, seconds = 0) {
  state.phase = phase;
  state.deadline = seconds ? now + seconds * 1000 : 0;
}

function clearRound(state) {
  state.currentIndex = 0;
  state.caseText = "";
  state.discard = [];
  state.roundCardIds = [];
  state.pending = null;
  state.roundResult = null;
  for (const player of state.players) {
    player.hand = [];
    player.turnsTaken = 0;
    player.accomplice = false;
  }
}

function resetToLobby(state, now = Date.now()) {
  clearRound(state);
  state.round = 0;
  state.winnerIds = [];
  for (const player of state.players) player.score = 0;
  setPhase(state, "lobby", now);
}

function dealRound(state, now, random) {
  clearRound(state);
  state.round += 1;
  const deck = createRoundDeck(state.players.length, random);
  state.roundCardIds = deck.map((card) => card.id);
  for (let index = 0; index < deck.length; index += 1) state.players[index % state.players.length].hand.push(deck[index]);
  const discovererIndex = state.players.findIndex((player) => hasCard(player, CARDS.DISCOVERER));
  if (discovererIndex < 0) throw new Error("Round has no discoverer");
  state.currentIndex = discovererIndex;
  state.pending = { type: "caseStory", actorId: state.players[discovererIndex].id };
  setPhase(state, "caseStory", now, CASE_SECONDS);
  addLog(state, `第 ${state.round} 轮开始，等待第一发现者描述案件。`, now);
}

function beginMatch(state, now, random) {
  state.winnerIds = [];
  state.round = 0;
  for (const player of state.players) player.score = 0;
  dealRound(state, now, random);
}

function removeCard(player, cardId) {
  const index = player.hand.findIndex((card) => card.id === String(cardId));
  if (index < 0) throw new GameRuleError("card_not_owned", "这张牌不在你的手中。", 409);
  return player.hand.splice(index, 1)[0];
}

function discardCard(state, player, card) {
  state.discard.push({ ...card, playedBy: player.id, order: state.discard.length + 1 });
}

function eligibleTargets(state, kind, actorId) {
  return state.players.filter((player) => {
    if (player.id === actorId) return false;
    if (kind === CARDS.DETECTIVE) return true;
    return player.hand.length > 0;
  });
}

function nextTurn(state, now) {
  state.pending = null;
  for (let step = 1; step <= state.players.length; step += 1) {
    const index = (state.currentIndex + step) % state.players.length;
    if (state.players[index].hand.length) {
      state.currentIndex = index;
      setPhase(state, "turn", now, TURN_SECONDS);
      return;
    }
  }
  throw new Error("No player has cards before the criminal escaped");
}

function scoreRound(state, outcome, winnerId, now) {
  const culprit = culpritHolder(state);
  const culpritId = culprit?.id || winnerId;
  const accompliceIds = state.players.filter((player) => player.accomplice).map((player) => player.id);
  const changes = Object.fromEntries(state.players.map((player) => [player.id, 0]));
  let title;

  if (outcome === "escape") {
    changes[winnerId] = 2;
    for (const id of accompliceIds) changes[id] = 2;
    title = `${playerById(state, winnerId)?.name || "犯人"} 成功逃脱！`;
  } else {
    changes[winnerId] = outcome === "dog" ? 3 : 2;
    for (const player of state.players) {
      if (player.id !== culpritId && player.id !== winnerId && !accompliceIds.includes(player.id)) changes[player.id] = 1;
    }
    title = outcome === "dog"
      ? `${playerById(state, winnerId)?.name || "神犬"} 找到了犯人！`
      : `${playerById(state, winnerId)?.name || "侦探"} 指认成功！`;
  }

  for (const player of state.players) player.score += changes[player.id];
  state.roundResult = { outcome, title, winnerId, culpritId, accompliceIds, changes };
  state.pending = null;
  addLog(state, `${title} 本轮计分完成。`, now);

  const reached = state.players.filter((player) => player.score >= state.targetScore);
  if (reached.length) {
    const best = Math.max(...state.players.map((player) => player.score));
    state.winnerIds = state.players.filter((player) => player.score === best).map((player) => player.id);
    setPhase(state, "ended", now);
    addLog(state, `${state.winnerIds.map((id) => playerById(state, id).name).join("、")} 赢得整场比赛。`, now);
  } else {
    setPhase(state, "roundReview", now, REVIEW_SECONDS);
  }
}

function submitCase(state, actor, text, now) {
  if (state.phase !== "caseStory" || state.pending?.actorId !== actor.id) throw new GameRuleError("case_not_allowed", "当前不需要你描述案件。", 409);
  const card = actor.hand.find((item) => item.type === CARDS.DISCOVERER);
  if (!card) throw new Error("Discoverer does not hold discoverer card");
  const story = cleanCase(text) || FALLBACK_CASES[state.round % FALLBACK_CASES.length];
  removeCard(actor, card.id);
  discardCard(state, actor, card);
  actor.turnsTaken += 1;
  state.caseText = story;
  addLog(state, `${actor.name} 是第一发现者：“${story}”`, now);
  nextTurn(state, now);
}

function openTargetChoice(state, actor, kind, now) {
  const targets = eligibleTargets(state, kind, actor.id);
  if (!targets.length) {
    addLog(state, `${cardLabel(kind)}没有可选择的目标，效果结束。`, now);
    nextTurn(state, now);
    return;
  }
  state.pending = { type: "chooseTarget", kind, actorId: actor.id };
  setPhase(state, "chooseTarget", now, CHOICE_SECONDS);
}

function openPrivateReveal(state, actor, kind, target, now) {
  state.pending = kind === CARDS.WITNESS
    ? { type: "privateReveal", kind, actorId: actor.id, targetId: target.id, cardTypes: target.hand.map((card) => card.type) }
    : { type: "privateReveal", kind, actorId: actor.id, culpritHolderId: target.id };
  setPhase(state, "privateReveal", now, REVEAL_SECONDS);
}

function resolveGossip(state, actor, now, random) {
  const snapshots = state.players.map((player) => [...player.hand]);
  const moves = [];
  for (let receiverIndex = 0; receiverIndex < state.players.length; receiverIndex += 1) {
    const donorIndex = rightIndex(receiverIndex, state.players.length);
    const options = snapshots[donorIndex];
    if (!options.length) continue;
    moves.push({ donorId: state.players[donorIndex].id, receiverId: state.players[receiverIndex].id, cardId: randomItem(options, random).id });
  }
  for (const move of moves) {
    const donor = playerById(state, move.donorId);
    const receiver = playerById(state, move.receiverId);
    receiver.hand.push(removeCard(donor, move.cardId));
  }
  addLog(state, `${actor.name} 散播谣言，大家从右侧玩家处秘密取得了一张牌。`, now);
  nextTurn(state, now);
}

function openPassLeft(state, actor, now) {
  const participantIds = state.players.filter((player) => player.hand.length).map((player) => player.id);
  if (!participantIds.length) return nextTurn(state, now);
  state.pending = { type: "passLeft", actorId: actor.id, participantIds, selections: {} };
  setPhase(state, "passLeft", now, CHOICE_SECONDS);
  addLog(state, `${actor.name} 发起情报交换，等待所有有手牌的玩家秘密选择。`, now);
}

function playCard(state, actor, cardId, now, random) {
  if (state.phase !== "turn" || currentPlayer(state)?.id !== actor.id) throw new GameRuleError("not_your_turn", "现在还没轮到你出牌。", 409);
  const card = actor.hand.find((item) => item.id === String(cardId));
  if (!card) throw new GameRuleError("card_not_owned", "这张牌不在你的手中。", 409);
  if (card.type === CARDS.CRIMINAL && actor.hand.length !== 1) throw new GameRuleError("criminal_not_last", "犯人牌只有成为最后一张手牌时才能打出。", 409);

  const firstPersonalTurn = actor.turnsTaken === 0;
  removeCard(actor, card.id);
  discardCard(state, actor, card);
  actor.turnsTaken += 1;
  addLog(state, `${actor.name} 打出了“${cardLabel(card.type)}”。`, now);

  if (card.type === CARDS.CRIMINAL) return scoreRound(state, "escape", actor.id, now);
  if (card.type === CARDS.ACCOMPLICE) {
    actor.accomplice = true;
    addLog(state, `${actor.name} 已公开加入犯人阵营。`, now);
    return nextTurn(state, now);
  }
  if ([CARDS.ALIBI, CARDS.CIVILIAN].includes(card.type)) return nextTurn(state, now);
  if (card.type === CARDS.DETECTIVE && firstPersonalTurn) {
    addLog(state, "侦探在这名玩家的第一圈出牌时不产生效果。", now);
    return nextTurn(state, now);
  }
  if ([CARDS.DETECTIVE, CARDS.WITNESS, CARDS.DOG, CARDS.TRADE].includes(card.type)) return openTargetChoice(state, actor, card.type, now);
  if (card.type === CARDS.CHILD) {
    const culprit = culpritHolder(state);
    if (!culprit) throw new Error("Round has no criminal holder");
    addLog(state, `${actor.name} 发动少年，秘密确认了当前犯人的身份。`, now);
    return openPrivateReveal(state, actor, CARDS.CHILD, culprit, now);
  }
  if (card.type === CARDS.PASS_LEFT) return openPassLeft(state, actor, now);
  if (card.type === CARDS.GOSSIP) return resolveGossip(state, actor, now, random);
  throw new GameRuleError("unknown_card", "无法执行这张牌。", 409);
}

function chooseTarget(state, actor, targetId, now, random) {
  const pending = state.pending;
  if (state.phase !== "chooseTarget" || pending?.actorId !== actor.id) throw new GameRuleError("target_not_allowed", "当前不能选择目标。", 409);
  const target = eligibleTargets(state, pending.kind, actor.id).find((player) => player.id === String(targetId));
  if (!target) throw new GameRuleError("invalid_target", "请选择一名合法的其他玩家。", 409);

  if (pending.kind === CARDS.DETECTIVE) {
    const caught = hasCard(target, CARDS.CRIMINAL) && !hasCard(target, CARDS.ALIBI);
    addLog(state, caught ? `${actor.name} 指认 ${target.name}，抓捕成功！` : `${actor.name} 指认 ${target.name}，但对方回答“我不是犯人”。`, now);
    if (caught) return scoreRound(state, "detective", actor.id, now);
    return nextTurn(state, now);
  }
  if (pending.kind === CARDS.WITNESS) {
    addLog(state, `${actor.name} 以目击者身份秘密查看了 ${target.name} 的手牌。`, now);
    return openPrivateReveal(state, actor, CARDS.WITNESS, target, now);
  }
  if (pending.kind === CARDS.DOG) {
    const order = shuffle(target.hand.map((card) => card.id), random);
    state.pending = { type: "dogPick", actorId: actor.id, targetId: target.id, slots: order.map((cardId, index) => ({ key: `slot_${index + 1}`, cardId })) };
    setPhase(state, "dogPick", now, CHOICE_SECONDS);
    addLog(state, `${actor.name} 让神犬搜查 ${target.name} 的手牌。`, now);
    return;
  }
  if (pending.kind === CARDS.TRADE) {
    if (!actor.hand.length || !target.hand.length) {
      addLog(state, "交易一方已经没有手牌，交换没有发生。", now);
      return nextTurn(state, now);
    }
    state.pending = { type: "trade", actorId: actor.id, targetId: target.id, participantIds: [actor.id, target.id], selections: {} };
    setPhase(state, "trade", now, CHOICE_SECONDS);
    addLog(state, `${actor.name} 邀请 ${target.name} 各自秘密选择一张牌进行交易。`, now);
  }
}

function resolveTrade(state, now) {
  const pending = state.pending;
  const actor = playerById(state, pending.actorId);
  const target = playerById(state, pending.targetId);
  const actorCard = removeCard(actor, pending.selections[actor.id]);
  const targetCard = removeCard(target, pending.selections[target.id]);
  actor.hand.push(targetCard);
  target.hand.push(actorCard);
  addLog(state, `${actor.name} 与 ${target.name} 完成了一张牌的秘密交易。`, now);
  nextTurn(state, now);
}

function submitTradeCard(state, actor, cardId, now) {
  const pending = state.pending;
  if (state.phase !== "trade" || !pending?.participantIds.includes(actor.id)) throw new GameRuleError("trade_not_allowed", "当前不需要你选择交易牌。", 409);
  if (pending.selections[actor.id]) throw new GameRuleError("already_selected", "你已经确认了交易牌。", 409);
  if (!actor.hand.some((card) => card.id === String(cardId))) throw new GameRuleError("card_not_owned", "这张牌不在你的手中。", 409);
  pending.selections[actor.id] = String(cardId);
  if (pending.participantIds.every((id) => pending.selections[id])) resolveTrade(state, now);
}

function resolvePassLeft(state, now) {
  const pending = state.pending;
  const moves = pending.participantIds.map((id) => {
    const ownerIndex = state.players.findIndex((player) => player.id === id);
    return { ownerId: id, receiverId: state.players[leftIndex(ownerIndex, state.players.length)].id, cardId: pending.selections[id] };
  });
  const cards = moves.map((move) => ({ ...move, card: removeCard(playerById(state, move.ownerId), move.cardId) }));
  for (const move of cards) playerById(state, move.receiverId).hand.push(move.card);
  addLog(state, "所有人完成情报交换，选择的牌已同时交给左侧玩家。", now);
  nextTurn(state, now);
}

function submitPassCard(state, actor, cardId, now) {
  const pending = state.pending;
  if (state.phase !== "passLeft" || !pending?.participantIds.includes(actor.id)) throw new GameRuleError("pass_not_allowed", "当前不需要你选择传递牌。", 409);
  if (pending.selections[actor.id]) throw new GameRuleError("already_selected", "你已经确认了传递牌。", 409);
  if (!actor.hand.some((card) => card.id === String(cardId))) throw new GameRuleError("card_not_owned", "这张牌不在你的手中。", 409);
  pending.selections[actor.id] = String(cardId);
  if (pending.participantIds.every((id) => pending.selections[id])) resolvePassLeft(state, now);
}

function chooseDogSlot(state, actor, slotKey, now) {
  const pending = state.pending;
  if (state.phase !== "dogPick" || pending?.actorId !== actor.id) throw new GameRuleError("dog_pick_not_allowed", "当前不能进行神犬搜查。", 409);
  const slot = pending.slots.find((item) => item.key === String(slotKey));
  const target = playerById(state, pending.targetId);
  const card = target?.hand.find((item) => item.id === slot?.cardId);
  if (!slot || !card) throw new GameRuleError("invalid_dog_slot", "请选择一张有效的牌背。", 409);
  addLog(state, `神犬公开了 ${target.name} 的“${cardLabel(card.type)}”。`, now);
  if (card.type === CARDS.CRIMINAL) return scoreRound(state, "dog", actor.id, now);
  state.pending = { type: "dogReveal", actorId: actor.id, targetId: target.id, revealedType: card.type };
  setPhase(state, "dogReveal", now, REVEAL_SECONDS);
}

function acknowledge(state, actor, now) {
  if (!["privateReveal", "dogReveal"].includes(state.phase) || state.pending?.actorId !== actor.id) throw new GameRuleError("acknowledge_not_allowed", "当前不需要你确认。", 409);
  nextTurn(state, now);
}

export function createLobby({ capacity, host }) {
  return {
    stateVersion: STATE_VERSION,
    phase: "lobby",
    capacity: assertCapacity(capacity),
    targetScore: DEFAULT_TARGET_SCORE,
    players: [makePlayer({ ...host, isHost: true })],
    round: 0,
    currentIndex: 0,
    caseText: "",
    discard: [],
    roundCardIds: [],
    pending: null,
    roundResult: null,
    winnerIds: [],
    deadline: 0,
    logs: [],
    logSequence: 0
  };
}

export function addPlayer(state, player) {
  if (state.phase !== "lobby") throw new GameRuleError("game_started", "游戏开始后不能加入玩家席。", 409);
  if (state.players.length >= state.capacity) throw new GameRuleError("room_full", "玩家席已满。", 409);
  if (playerById(state, player.id)) throw new GameRuleError("player_exists", "该玩家已在房间中。", 409);
  const next = makePlayer(player);
  state.players.push(next);
  return next;
}

export function removePlayer(state, actorId, playerId) {
  requireHost(state, actorId);
  const index = state.players.findIndex((player) => player.id === String(playerId));
  const target = state.players[index];
  if (!target || target.isHost) throw new GameRuleError("invalid_kick_target", "无法移出该玩家。");
  state.players.splice(index, 1);
  if (state.phase !== "lobby") resetToLobby(state);
  return target;
}

export function canChangeSeats(state) {
  return state.phase === "lobby";
}

export function vacateSeat(state, playerId, { now = Date.now() } = {}) {
  if (!canChangeSeats(state)) throw new GameRuleError("seat_change_unavailable", "游戏开始后不能转入旁观席。", 409);
  const index = state.players.findIndex((player) => player.id === String(playerId));
  const target = state.players[index];
  if (!target || target.isHost) throw new GameRuleError("invalid_seat_target", "房主必须留在玩家席。", 403);
  state.players.splice(index, 1);
  addLog(state, `${target.name} 转入旁观席。`, now);
  return target;
}

export function setPresence(state, playerId, connected) {
  const player = playerById(state, playerId);
  if (!player || player.connected === Boolean(connected)) return false;
  player.connected = Boolean(connected);
  return true;
}

export function applyAction(state, actorId, action, { now = Date.now(), random = Math.random } = {}) {
  const actor = requireActor(state, actorId);
  const type = action?.type;
  if (type === "setCapacity") {
    requireHost(state, actorId);
    if (state.phase !== "lobby") throw new GameRuleError("game_started", "游戏开始后不能修改人数。", 409);
    const capacity = assertCapacity(action.capacity);
    if (capacity < state.players.length) throw new GameRuleError("capacity_too_small", "人数不能少于当前玩家席人数。", 409);
    state.capacity = capacity;
    return;
  }
  if (type === "setTargetScore") {
    requireHost(state, actorId);
    if (state.phase !== "lobby") throw new GameRuleError("game_started", "游戏开始后不能修改目标分数。", 409);
    state.targetScore = assertTargetScore(action.targetScore);
    return;
  }
  if (type === "start" || type === "restart") {
    requireHost(state, actorId);
    if (type === "start" && state.phase !== "lobby") throw new GameRuleError("already_started", "游戏已经开始。", 409);
    if (type === "restart" && state.phase !== "ended") throw new GameRuleError("restart_unavailable", "当前不能重新开始。", 409);
    if (state.players.length !== state.capacity) throw new GameRuleError("players_missing", `需要 ${state.capacity} 人到齐。`, 409);
    if (state.players.some((player) => !player.connected)) throw new GameRuleError("players_offline", "所有玩家在线后才能开始。", 409);
    beginMatch(state, now, random);
    return;
  }
  if (type === "end") {
    requireHost(state, actorId);
    if (state.phase === "lobby") throw new GameRuleError("game_not_started", "当前没有牌局。", 409);
    resetToLobby(state, now);
    return;
  }
  if (state.phase === "caseStory" && type === "submitCase") return submitCase(state, actor, action.text, now);
  if (state.phase === "turn" && type === "playCard") return playCard(state, actor, action.cardId, now, random);
  if (state.phase === "chooseTarget" && type === "chooseTarget") return chooseTarget(state, actor, action.targetId, now, random);
  if (state.phase === "trade" && type === "submitTradeCard") return submitTradeCard(state, actor, action.cardId, now);
  if (state.phase === "passLeft" && type === "submitPassCard") return submitPassCard(state, actor, action.cardId, now);
  if (state.phase === "dogPick" && type === "chooseDogSlot") return chooseDogSlot(state, actor, action.slotKey, now);
  if (["privateReveal", "dogReveal"].includes(state.phase) && type === "acknowledge") return acknowledge(state, actor, now);
  throw new GameRuleError("action_unavailable", "当前阶段不能执行这个操作。", 409);
}

function timeoutSelectForPending(state, pending, random) {
  for (const id of pending.participantIds) {
    if (pending.selections[id]) continue;
    const player = playerById(state, id);
    pending.selections[id] = randomItem(player.hand, random).id;
  }
}

export function handleTimeout(state, { now = Date.now(), random = Math.random } = {}) {
  if (["lobby", "ended"].includes(state.phase) || !state.deadline || now < state.deadline) return false;
  if (state.phase === "roundReview") {
    dealRound(state, now, random);
    return true;
  }
  if (state.phase === "caseStory") {
    submitCase(state, playerById(state, state.pending.actorId), randomItem(FALLBACK_CASES, random), now);
    return true;
  }
  if (state.phase === "turn") {
    const actor = currentPlayer(state);
    const legal = actor.hand.filter((card) => card.type !== CARDS.CRIMINAL || actor.hand.length === 1);
    playCard(state, actor, randomItem(legal, random).id, now, random);
    addLog(state, `${actor.name} 出牌超时，服务器执行了合法默认选择。`, now);
    return true;
  }
  if (state.phase === "chooseTarget") {
    const actor = playerById(state, state.pending.actorId);
    const target = randomItem(eligibleTargets(state, state.pending.kind, actor.id), random);
    chooseTarget(state, actor, target.id, now, random);
    return true;
  }
  if (state.phase === "trade") {
    timeoutSelectForPending(state, state.pending, random);
    resolveTrade(state, now);
    return true;
  }
  if (state.phase === "passLeft") {
    timeoutSelectForPending(state, state.pending, random);
    resolvePassLeft(state, now);
    return true;
  }
  if (state.phase === "dogPick") {
    const slot = randomItem(state.pending.slots, random);
    chooseDogSlot(state, playerById(state, state.pending.actorId), slot.key, now);
    return true;
  }
  if (["privateReveal", "dogReveal"].includes(state.phase)) {
    acknowledge(state, playerById(state, state.pending.actorId), now);
    return true;
  }
  return false;
}

export function getDeadline(state) {
  return Number(state.deadline) || 0;
}

function publicPlayer(player, viewerId, revealAll) {
  const own = player.id === viewerId;
  return {
    id: player.id,
    name: player.name,
    isHost: player.isHost,
    connected: player.connected,
    score: player.score,
    turnsTaken: player.turnsTaken,
    accomplice: player.accomplice,
    handCount: player.hand.length,
    hand: player.hand.map((card, index) => own || revealAll
      ? { id: own ? card.id : `${player.id}_revealed_${index + 1}`, type: card.type, hidden: false }
      : { id: `${player.id}_hidden_${index + 1}`, type: null, hidden: true })
  };
}

function permissionsFor(state, viewer) {
  const id = viewer?.id;
  return {
    canManage: Boolean(viewer?.isHost),
    canKick: Boolean(viewer?.isHost),
    canSetCapacity: Boolean(viewer?.isHost && state.phase === "lobby"),
    canSetTargetScore: Boolean(viewer?.isHost && state.phase === "lobby"),
    canStart: Boolean(viewer?.isHost && state.phase === "lobby"),
    canEnd: Boolean(viewer?.isHost && state.phase !== "lobby"),
    canRestart: Boolean(viewer?.isHost && state.phase === "ended"),
    canSubmitCase: state.phase === "caseStory" && state.pending?.actorId === id,
    canPlayCard: state.phase === "turn" && currentPlayer(state)?.id === id,
    canChooseTarget: state.phase === "chooseTarget" && state.pending?.actorId === id,
    canSubmitTrade: state.phase === "trade" && state.pending?.participantIds.includes(id) && !state.pending.selections[id],
    canSubmitPass: state.phase === "passLeft" && state.pending?.participantIds.includes(id) && !state.pending.selections[id],
    canChooseDogSlot: state.phase === "dogPick" && state.pending?.actorId === id,
    canAcknowledge: ["privateReveal", "dogReveal"].includes(state.phase) && state.pending?.actorId === id
  };
}

function publicPending(state, viewer) {
  const pending = state.pending;
  if (!pending) return null;
  if (pending.type === "caseStory") return { type: pending.type, actorId: pending.actorId };
  if (pending.type === "chooseTarget") return { type: pending.type, kind: pending.kind, actorId: pending.actorId };
  if (["trade", "passLeft"].includes(pending.type)) {
    return {
      type: pending.type,
      actorId: pending.actorId,
      targetId: pending.targetId || null,
      participantIds: [...pending.participantIds],
      submittedIds: pending.participantIds.filter((id) => pending.selections[id]),
      ownSelectionId: viewer && pending.participantIds.includes(viewer.id) ? pending.selections[viewer.id] || null : null
    };
  }
  if (pending.type === "dogPick") {
    return { type: pending.type, actorId: pending.actorId, targetId: pending.targetId, slots: viewer?.id === pending.actorId ? pending.slots.map((slot) => slot.key) : [] };
  }
  if (pending.type === "dogReveal") return { type: pending.type, actorId: pending.actorId, targetId: pending.targetId, revealedType: pending.revealedType };
  if (pending.type === "privateReveal") return { type: pending.type, kind: pending.kind, actorId: pending.actorId, targetId: pending.kind === CARDS.WITNESS ? pending.targetId : null };
  return { type: pending.type };
}

function privateInsight(state, viewer) {
  const pending = state.pending;
  if (!viewer || pending?.type !== "privateReveal") return null;
  if (viewer.id === pending.actorId) {
    if (pending.kind === CARDS.WITNESS) return { kind: pending.kind, targetId: pending.targetId, cardTypes: [...pending.cardTypes] };
    return { kind: pending.kind, culpritHolderId: pending.culpritHolderId };
  }
  if (pending.kind === CARDS.CHILD && viewer.id === pending.culpritHolderId) return { kind: "identifiedByChild", actorId: pending.actorId };
  return null;
}

function publicView(state, viewer = null) {
  const revealAll = ["roundReview", "ended"].includes(state.phase);
  return {
    selfId: viewer?.id || null,
    phase: state.phase,
    capacity: state.capacity,
    targetScore: state.targetScore,
    round: state.round,
    currentPlayerId: currentPlayer(state)?.id || null,
    caseText: state.caseText,
    deadline: state.deadline,
    players: state.players.map((player) => publicPlayer(player, viewer?.id || null, revealAll)),
    discard: state.discard.map((card) => ({ type: card.type, playedBy: card.playedBy, order: card.order })),
    pending: publicPending(state, viewer),
    privateInsight: privateInsight(state, viewer),
    roundResult: state.roundResult ? clone(state.roundResult) : null,
    winnerIds: [...state.winnerIds],
    logs: state.logs.map((entry) => ({ ...entry })),
    permissions: permissionsFor(state, viewer)
  };
}

export function buildView(state, viewerId) {
  return publicView(state, requireActor(state, viewerId));
}

export function buildSpectatorView(state) {
  return publicView(state, null);
}

export function validateState(state) {
  if (!state || !Array.isArray(state.players)) throw new Error("Invalid game18 state");
  if (state.players.some((player) => !Number.isInteger(player.score) || player.score < 0 || !Array.isArray(player.hand))) throw new Error("Invalid player state");
  if (state.phase === "lobby") return true;
  if (state.players.length < MIN_PLAYERS || state.players.length > MAX_PLAYERS) throw new Error("Invalid active player count");
  const cards = [...state.players.flatMap((player) => player.hand), ...state.discard];
  const ids = cards.map((card) => card.id);
  if (cards.length !== state.roundCardIds.length || new Set(ids).size !== ids.length || ids.some((id) => !state.roundCardIds.includes(id))) {
    throw new Error(`Round card conservation failed: ${cards.length}/${new Set(ids).size}/${state.roundCardIds.length}`);
  }
  if (cards.filter((card) => card.type === CARDS.CRIMINAL).length !== 1) throw new Error("Round must contain exactly one criminal");
  if (cards.filter((card) => card.type === CARDS.DISCOVERER).length !== 1) throw new Error("Round must contain exactly one discoverer");
  return true;
}

export function serializeState(state) {
  validateState(state);
  return clone(state);
}

export function restoreState(serializedState) {
  if (serializedState?.stateVersion !== STATE_VERSION) throw new Error(`Unsupported game18 state version: ${serializedState?.stateVersion}`);
  const state = clone(serializedState);
  validateState(state);
  return state;
}
