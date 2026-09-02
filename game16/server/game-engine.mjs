import {
  ACTIONS, ACTION_META, ASSASSINATE_COST, COUP_COST, FORCED_COUP_COINS,
  MAX_PLAYERS, MIN_PLAYERS, ROLE_LABELS, ROLES, STARTING_COINS,
  actionLabel, actionMeta, createCourtDeck, roleLabel, shuffle
} from "../rules.mjs";

export const STATE_VERSION = 1;
export const SUPPORTS_SPECTATORS = true;
export const TURN_SECONDS = 45;
export const ACTION_SECONDS = TURN_SECONDS;
export const REACTION_SECONDS = 12;
export const PROOF_SECONDS = 15;
export const DECISION_SECONDS = 20;
export const EXCHANGE_SECONDS = 30;

export class GameRuleError extends Error {
  constructor(code, message, status = 400) {
    super(message); this.name = "GameRuleError"; this.code = code; this.status = status;
  }
}

const cleanText = (value, fallback = "玩家") => String(value ?? "").trim().slice(0, 12) || fallback;
const playerById = (state, id) => state.players.find((player) => player.id === String(id)) || null;
const alive = (player) => player && !player.eliminated && player.influences.some((card) => !card.revealed);
const livingPlayers = (state) => state.players.filter(alive);
const activeInfluences = (player) => player.influences.filter((card) => !card.revealed);
const currentPlayer = (state) => state.players[state.currentIndex] || null;
const uniqueStrings = (values) => [...new Set((values || []).map(String))];

function assertCapacity(value) {
  const capacity = Number(value);
  if (!Number.isInteger(capacity) || capacity < MIN_PLAYERS || capacity > MAX_PLAYERS) {
    throw new GameRuleError("invalid_capacity", `游戏人数必须为 ${MIN_PLAYERS}～${MAX_PLAYERS} 人。`);
  }
  return capacity;
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
  return { id: String(id), name: cleanText(name, isHost ? "房主" : "玩家"), isHost: Boolean(isHost), connected: Boolean(connected), coins: 0, influences: [], eliminated: false };
}

function addLog(state, text, now) {
  state.logs.unshift({ id: `log_${state.logSequence += 1}`, text, at: now });
  if (state.logs.length > 120) state.logs.length = 120;
}

function setPhase(state, phase, now, seconds = 0) {
  state.phase = phase;
  state.deadline = seconds ? now + seconds * 1000 : 0;
}

function resetPending(state) {
  state.action = null; state.reaction = null; state.challenge = null; state.loss = null; state.exchange = null;
}

function resetToLobby(state) {
  setPhase(state, "lobby", Date.now());
  state.deck = []; state.currentIndex = 0; state.winnerId = null; resetPending(state);
  for (const player of state.players) { player.coins = 0; player.influences = []; player.eliminated = false; }
}

function draw(state) {
  const card = state.deck.pop();
  if (!card) throw new GameRuleError("court_deck_empty", "宫廷牌库没有足够的角色牌。", 409);
  card.revealed = false;
  return card;
}

function beginGame(state, now, random) {
  state.deck = shuffle(createCourtDeck(), random);
  state.winnerId = null; resetPending(state);
  for (const player of state.players) {
    player.coins = STARTING_COINS; player.eliminated = false; player.influences = [draw(state), draw(state)];
  }
  state.currentIndex = Math.min(state.players.length - 1, Math.floor(random() * state.players.length));
  setPhase(state, "action", now, TURN_SECONDS);
  addLog(state, `政变开始，${currentPlayer(state).name} 首先行动。`, now);
}

function nextTurn(state, now) {
  resetPending(state);
  const winners = livingPlayers(state);
  if (winners.length <= 1) {
    state.winnerId = winners[0]?.id || null;
    setPhase(state, "ended", now);
    addLog(state, winners[0] ? `${winners[0].name} 成为最后仍有影响力的玩家，赢得政变！` : "本局没有幸存者。", now);
    return;
  }
  let index = state.currentIndex;
  do { index = (index + 1) % state.players.length; } while (!alive(state.players[index]));
  state.currentIndex = index;
  setPhase(state, "action", now, TURN_SECONDS);
}

function finishIfWinner(state, now) {
  const winners = livingPlayers(state);
  if (winners.length > 1) return false;
  state.winnerId = winners[0]?.id || null; resetPending(state); setPhase(state, "ended", now);
  addLog(state, winners[0] ? `${winners[0].name} 成为最后仍有影响力的玩家，赢得政变！` : "本局没有幸存者。", now);
  return true;
}

function eligibleActionChallengers(state) {
  return livingPlayers(state).filter((p) => p.id !== state.action.actorId).map((p) => p.id);
}

function eligibleBlockers(state) {
  const meta = actionMeta(state.action.type);
  if (!meta?.blockRoles.length) return [];
  if (state.action.type === ACTIONS.FOREIGN_AID) return livingPlayers(state).filter((p) => p.id !== state.action.actorId).map((p) => p.id);
  const target = playerById(state, state.action.targetId);
  return alive(target) ? [target.id] : [];
}

function openReaction(state, kind, eligibleIds, now) {
  state.reaction = { kind, eligibleIds: uniqueStrings(eligibleIds), passedIds: [] };
  setPhase(state, kind === "challengeAction" ? "challengeAction" : kind === "block" ? "block" : "challengeBlock", now, REACTION_SECONDS);
}

function continueAfterActionChallenge(state, now, random) {
  state.challenge = null;
  const blockers = eligibleBlockers(state);
  if (blockers.length) return openReaction(state, "block", blockers, now);
  return resolveAction(state, now, random);
}

function openLoss(state, playerId, reason, continuation, now) {
  state.reaction = null;
  state.loss = { playerId, reason, continuation };
  setPhase(state, "loseInfluence", now, DECISION_SECONDS);
}

function resolveAction(state, now, random) {
  const action = state.action;
  const actor = playerById(state, action.actorId);
  const target = playerById(state, action.targetId);
  if (!alive(actor)) return nextTurn(state, now);
  if (action.type === ACTIONS.INCOME) { actor.coins += 1; addLog(state, `${actor.name} 获得 1 枚收入。`, now); return nextTurn(state, now); }
  if (action.type === ACTIONS.FOREIGN_AID) { actor.coins += 2; addLog(state, `${actor.name} 获得 2 枚外援。`, now); return nextTurn(state, now); }
  if (action.type === ACTIONS.TAX) { actor.coins += 3; addLog(state, `${actor.name} 以公爵身份获得 3 枚税收。`, now); return nextTurn(state, now); }
  if (action.type === ACTIONS.STEAL) {
    const amount = Math.min(2, Math.max(0, target?.coins || 0));
    if (target) target.coins -= amount; actor.coins += amount;
    addLog(state, `${actor.name} 从 ${target?.name || "目标"} 处偷走 ${amount} 枚金币。`, now);
    return nextTurn(state, now);
  }
  if (action.type === ACTIONS.EXCHANGE) {
    const drawn = [draw(state), draw(state)];
    state.exchange = { playerId: actor.id, drawn, originalIds: activeInfluences(actor).map((card) => card.id) };
    setPhase(state, "exchange", now, EXCHANGE_SECONDS);
    addLog(state, `${actor.name} 开始与宫廷牌库交换角色。`, now);
    return;
  }
  if (action.type === ACTIONS.COUP || action.type === ACTIONS.ASSASSINATE) {
    if (!alive(target)) return nextTurn(state, now);
    addLog(state, `${target.name} 必须因${actionLabel(action.type)}失去一点影响力。`, now);
    return openLoss(state, target.id, action.type, { type: "finishTurn" }, now);
  }
  throw new GameRuleError("unknown_action", "无法结算这个行动。");
}

function cancelByBlock(state, now) {
  const blocker = playerById(state, state.action.blockerId);
  addLog(state, `${blocker?.name || "玩家"} 的阻挡生效，${actionLabel(state.action.type)}被取消。`, now);
  nextTurn(state, now);
}

function afterLoss(state, continuation, now, random) {
  if (finishIfWinner(state, now)) return;
  if (continuation.type === "finishTurn") return nextTurn(state, now);
  if (continuation.type === "actionClaimProved") return continueAfterActionChallenge(state, now, random);
  if (continuation.type === "actionClaimFailed") return nextTurn(state, now);
  if (continuation.type === "blockClaimProved") return cancelByBlock(state, now);
  if (continuation.type === "blockClaimFailed") return resolveAction(state, now, random);
}

function loseInfluence(state, player, cardId, now, random) {
  if (state.loss?.playerId !== player.id) throw new GameRuleError("not_your_decision", "当前不需要你失去影响力。", 409);
  const card = activeInfluences(player).find((item) => item.id === String(cardId));
  if (!card) throw new GameRuleError("invalid_influence", "请选择一张尚未公开的角色牌。", 409);
  card.revealed = true;
  addLog(state, `${player.name} 失去一点影响力，公开了${roleLabel(card.role)}。`, now);
  if (!activeInfluences(player).length) {
    player.eliminated = true;
    player.coins = 0;
    addLog(state, `${player.name} 已失去全部影响力，金币归还国库并退出本局。`, now);
  }
  const continuation = state.loss.continuation; state.loss = null;
  afterLoss(state, continuation, now, random);
}

function allPassed(reaction) { return reaction.eligibleIds.every((id) => reaction.passedIds.includes(id)); }

function handlePass(state, actor, now, random) {
  if (!state.reaction?.eligibleIds.includes(actor.id)) throw new GameRuleError("response_not_allowed", "你不能在这个窗口响应。", 409);
  if (!state.reaction.passedIds.includes(actor.id)) state.reaction.passedIds.push(actor.id);
  if (!allPassed(state.reaction)) return;
  if (state.phase === "challengeAction") return continueAfterActionChallenge(state, now, random);
  if (state.phase === "block") return resolveAction(state, now, random);
  if (state.phase === "challengeBlock") return cancelByBlock(state, now);
}

function startChallenge(state, challenger, context, now) {
  if (!state.reaction?.eligibleIds.includes(challenger.id)) throw new GameRuleError("challenge_not_allowed", "你不能提出这次质疑。", 409);
  const claimantId = context === "action" ? state.action.actorId : state.action.blockerId;
  const role = context === "action" ? actionMeta(state.action.type).role : state.action.blockRole;
  state.challenge = { context, challengerId: challenger.id, claimantId, role };
  state.reaction = null; setPhase(state, "proveClaim", now, PROOF_SECONDS);
  addLog(state, `${challenger.name} 质疑 ${playerById(state, claimantId).name} 声称的${roleLabel(role)}。`, now);
}

function proveClaim(state, claimant, cardId, now, random) {
  const challenge = state.challenge;
  if (!challenge || challenge.claimantId !== claimant.id) throw new GameRuleError("not_your_decision", "当前不需要你证明角色。", 409);
  const index = claimant.influences.findIndex((card) => !card.revealed && card.id === String(cardId) && card.role === challenge.role);
  if (index < 0) throw new GameRuleError("invalid_proof", "这张牌不能证明当前角色声明。", 409);
  const shown = claimant.influences[index];
  addLog(state, `${claimant.name} 成功展示${roleLabel(shown.role)}；该牌洗回宫廷并获得一张秘密替代牌。`, now);
  state.deck.push({ ...shown, revealed: false }); state.deck = shuffle(state.deck, random); claimant.influences[index] = draw(state);
  const challenger = playerById(state, challenge.challengerId);
  const continuation = { type: challenge.context === "action" ? "actionClaimProved" : "blockClaimProved" };
  state.challenge = null;
  if (!alive(challenger)) return afterLoss(state, continuation, now, random);
  openLoss(state, challenger.id, "failedChallenge", continuation, now);
}

function concedeClaim(state, claimant, now) {
  const challenge = state.challenge;
  if (!challenge || challenge.claimantId !== claimant.id) throw new GameRuleError("not_your_decision", "当前不需要你回应质疑。", 409);
  addLog(state, `${claimant.name} 未能证明${roleLabel(challenge.role)}，质疑成功。`, now);
  const continuation = { type: challenge.context === "action" ? "actionClaimFailed" : "blockClaimFailed" };
  state.challenge = null;
  openLoss(state, claimant.id, "lostChallenge", continuation, now);
}

function declareAction(state, actor, action, now, random) {
  if (currentPlayer(state)?.id !== actor.id) throw new GameRuleError("not_your_turn", "现在还没轮到你。", 409);
  if (!alive(actor)) throw new GameRuleError("eliminated", "你已经失去全部影响力。", 409);
  const meta = actionMeta(action.actionType);
  if (!meta) throw new GameRuleError("invalid_action", "请选择一个合法行动。", 409);
  if (actor.coins >= FORCED_COUP_COINS && action.actionType !== ACTIONS.COUP) throw new GameRuleError("coup_required", "拥有至少10枚金币时必须发动政变。", 409);
  if (actor.coins < meta.cost) throw new GameRuleError("not_enough_coins", "金币不足。", 409);
  let target = null;
  if (meta.target) {
    target = playerById(state, action.targetId);
    if (!alive(target) || target.id === actor.id) throw new GameRuleError("invalid_target", "请选择一名仍有影响力的其他玩家。", 409);
    if (action.actionType === ACTIONS.STEAL && target.coins < 1) throw new GameRuleError("target_has_no_coins", "不能从没有金币的玩家处偷窃。", 409);
  }
  actor.coins -= meta.cost;
  state.action = { type: action.actionType, actorId: actor.id, targetId: target?.id || null, claimedRole: meta.role, blockerId: null, blockRole: null };
  addLog(state, `${actor.name}${meta.role ? `声称自己是${roleLabel(meta.role)}，` : ""}选择${actionLabel(action.actionType)}${target ? `，目标是 ${target.name}` : ""}${meta.cost ? `（支付${meta.cost}枚金币）` : ""}。`, now);
  if (meta.role) return openReaction(state, "challengeAction", eligibleActionChallengers(state), now);
  if (meta.blockRoles.length) return openReaction(state, "block", eligibleBlockers(state), now);
  return resolveAction(state, now, random);
}

function declareBlock(state, blocker, role, now) {
  if (state.phase !== "block" || !state.reaction?.eligibleIds.includes(blocker.id)) throw new GameRuleError("block_not_allowed", "你不能阻挡这个行动。", 409);
  const allowed = actionMeta(state.action.type).blockRoles;
  if (!allowed.includes(role)) throw new GameRuleError("invalid_block_role", "这个角色不能阻挡当前行动。", 409);
  state.action.blockerId = blocker.id; state.action.blockRole = role;
  addLog(state, `${blocker.name} 声称自己是${roleLabel(role)}，阻挡${actionLabel(state.action.type)}。`, now);
  openReaction(state, "challengeBlock", livingPlayers(state).filter((p) => p.id !== blocker.id).map((p) => p.id), now);
}

function submitExchange(state, actor, keepIds, now) {
  if (state.phase !== "exchange" || state.exchange?.playerId !== actor.id) throw new GameRuleError("exchange_not_allowed", "当前不能交换角色。", 409);
  const activeCards = activeInfluences(actor);
  const pool = [...activeCards, ...state.exchange.drawn];
  const wanted = uniqueStrings(keepIds);
  if (wanted.length !== activeCards.length || wanted.some((id) => !pool.some((card) => card.id === id))) throw new GameRuleError("invalid_exchange", `必须保留 ${activeCards.length} 张角色牌。`, 409);
  const keep = wanted.map((id) => pool.find((card) => card.id === id));
  const returned = pool.filter((card) => !wanted.includes(card.id));
  let keepIndex = 0;
  actor.influences = actor.influences.map((card) => card.revealed ? card : { ...keep[keepIndex++], revealed: false });
  state.deck.push(...returned.map((card) => ({ ...card, revealed: false })));
  state.exchange = null;
  addLog(state, `${actor.name} 完成了秘密角色交换。`, now);
  nextTurn(state, now);
}

export function createLobby({ capacity, host }) {
  return { stateVersion: STATE_VERSION, phase: "lobby", capacity: assertCapacity(capacity), players: [makePlayer({ ...host, isHost: true })], deck: [], currentIndex: 0, deadline: 0, winnerId: null, action: null, reaction: null, challenge: null, loss: null, exchange: null, logs: [], logSequence: 0 };
}

export function addPlayer(state, player) {
  if (state.phase !== "lobby") throw new GameRuleError("game_started", "游戏开始后不能中途加入玩家席。", 409);
  if (state.players.length >= state.capacity) throw new GameRuleError("room_full", "玩家席已满。", 409);
  if (playerById(state, player.id)) throw new GameRuleError("player_exists", "该玩家已经在房间中。", 409);
  const next = makePlayer(player); state.players.push(next); return next;
}

export function removePlayer(state, actorId, playerId) {
  requireHost(state, actorId);
  const index = state.players.findIndex((player) => player.id === String(playerId));
  const target = state.players[index];
  if (!target || target.isHost) throw new GameRuleError("invalid_kick_target", "无法移出该玩家。");
  state.players.splice(index, 1); if (state.phase !== "lobby") resetToLobby(state); return target;
}

export function canChangeSeats(state) { return state.phase === "lobby"; }

export function vacateSeat(state, playerId, { now = Date.now() } = {}) {
  if (!canChangeSeats(state)) throw new GameRuleError("seat_change_unavailable", "游戏开始后不能转入旁观席。", 409);
  const index = state.players.findIndex((player) => player.id === String(playerId));
  const target = state.players[index];
  if (!target || target.isHost) throw new GameRuleError("invalid_seat_target", "房主必须留在玩家席。", 403);
  state.players.splice(index, 1); addLog(state, `${target.name} 转入了旁观席。`, now); return target;
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
    const capacity = assertCapacity(action.capacity); if (capacity < state.players.length) throw new GameRuleError("capacity_too_small", "人数不能少于玩家席人数。", 409); state.capacity = capacity; return;
  }
  if (type === "start" || type === "restart") {
    requireHost(state, actorId);
    if (type === "start" && state.phase !== "lobby") throw new GameRuleError("already_started", "游戏已经开始。", 409);
    if (type === "restart" && state.phase !== "ended") throw new GameRuleError("restart_unavailable", "当前不能重新开始。", 409);
    if (state.players.length !== state.capacity) throw new GameRuleError("players_missing", `需要 ${state.capacity} 人到齐。`, 409);
    if (state.players.some((p) => !p.connected)) throw new GameRuleError("players_offline", "所有玩家在线后才能开始。", 409);
    return beginGame(state, now, random);
  }
  if (type === "end") { requireHost(state, actorId); if (state.phase === "lobby") throw new GameRuleError("game_not_started", "当前没有牌局。", 409); return resetToLobby(state); }
  if (state.phase === "action" && type === "declareAction") return declareAction(state, actor, action, now, random);
  if (["challengeAction", "block", "challengeBlock"].includes(state.phase) && type === "pass") return handlePass(state, actor, now, random);
  if (state.phase === "challengeAction" && type === "challenge") return startChallenge(state, actor, "action", now);
  if (state.phase === "block" && type === "block") return declareBlock(state, actor, String(action.role), now);
  if (state.phase === "challengeBlock" && type === "challenge") return startChallenge(state, actor, "block", now);
  if (state.phase === "proveClaim" && type === "prove") return proveClaim(state, actor, action.cardId, now, random);
  if (state.phase === "proveClaim" && type === "concede") return concedeClaim(state, actor, now);
  if (state.phase === "loseInfluence" && type === "loseInfluence") return loseInfluence(state, actor, action.cardId, now, random);
  if (state.phase === "exchange" && type === "submitExchange") return submitExchange(state, actor, action.keepIds, now);
  throw new GameRuleError("action_unavailable", "当前阶段不能执行这个操作。", 409);
}

export function handleTimeout(state, { now = Date.now(), random = Math.random } = {}) {
  if (["lobby", "ended"].includes(state.phase) || !state.deadline || now < state.deadline) return false;
  if (state.phase === "action") {
    const actor = currentPlayer(state); const targets = livingPlayers(state).filter((p) => p.id !== actor.id);
    if (actor.coins >= FORCED_COUP_COINS) declareAction(state, actor, { actionType: ACTIONS.COUP, targetId: targets[Math.floor(random() * targets.length)].id }, now, random);
    else declareAction(state, actor, { actionType: ACTIONS.INCOME }, now, random);
    addLog(state, `${actor.name} 行动超时，服务器执行默认行动。`, now); return true;
  }
  if (["challengeAction", "block", "challengeBlock"].includes(state.phase)) {
    state.reaction.passedIds = [...state.reaction.eligibleIds]; handlePass(state, playerById(state, state.reaction.eligibleIds[0]), now, random); return true;
  }
  if (state.phase === "proveClaim") {
    const claimant = playerById(state, state.challenge.claimantId);
    const proof = activeInfluences(claimant).find((card) => card.role === state.challenge.role);
    if (proof) proveClaim(state, claimant, proof.id, now, random); else concedeClaim(state, claimant, now); return true;
  }
  if (state.phase === "loseInfluence") {
    const player = playerById(state, state.loss.playerId); const cards = activeInfluences(player);
    loseInfluence(state, player, cards[Math.floor(random() * cards.length)].id, now, random); return true;
  }
  if (state.phase === "exchange") {
    const player = playerById(state, state.exchange.playerId); submitExchange(state, player, state.exchange.originalIds, now); return true;
  }
  return false;
}

export function getDeadline(state) { return Number(state.deadline) || 0; }

function publicPlayer(player, viewerId = null) {
  return { id: player.id, name: player.name, isHost: player.isHost, connected: player.connected, coins: player.coins, eliminated: player.eliminated,
    influences: player.influences.map((card, index) => ({
      id: player.id === viewerId ? card.id : `${player.id}_slot_${index + 1}`,
      revealed: card.revealed,
      role: card.revealed || player.id === viewerId ? card.role : null
    })) };
}

function permissionsFor(state, viewer) {
  const id = viewer?.id;
  return {
    canManage: Boolean(viewer?.isHost), canKick: Boolean(viewer?.isHost), canSetCapacity: Boolean(viewer?.isHost && state.phase === "lobby"),
    canStart: Boolean(viewer?.isHost && state.phase === "lobby"), canEnd: Boolean(viewer?.isHost && state.phase !== "lobby"), canRestart: Boolean(viewer?.isHost && state.phase === "ended"),
    canDeclareAction: state.phase === "action" && currentPlayer(state)?.id === id,
    canRespond: ["challengeAction", "block", "challengeBlock"].includes(state.phase) && state.reaction?.eligibleIds.includes(id) && !state.reaction.passedIds.includes(id),
    canChallenge: ["challengeAction", "challengeBlock"].includes(state.phase) && state.reaction?.eligibleIds.includes(id) && !state.reaction.passedIds.includes(id),
    canBlock: state.phase === "block" && state.reaction?.eligibleIds.includes(id) && !state.reaction.passedIds.includes(id),
    canProve: state.phase === "proveClaim" && state.challenge?.claimantId === id,
    canLoseInfluence: state.phase === "loseInfluence" && state.loss?.playerId === id,
    canExchange: state.phase === "exchange" && state.exchange?.playerId === id
  };
}

function publicView(state, viewer = null) {
  const action = state.action ? { ...state.action } : null;
  const reaction = state.reaction ? { kind: state.reaction.kind, eligibleIds: [...state.reaction.eligibleIds], passedIds: [...state.reaction.passedIds] } : null;
  const challenge = state.challenge ? { ...state.challenge } : null;
  const loss = state.loss ? { playerId: state.loss.playerId, reason: state.loss.reason } : null;
  return { selfId: viewer?.id || null, phase: state.phase, capacity: state.capacity, currentPlayerId: currentPlayer(state)?.id || null, deckCount: state.deck.length,
    deadline: state.deadline, winnerId: state.winnerId, action, reaction, challenge, loss, players: state.players.map((p) => publicPlayer(p, viewer?.id)),
    exchange: viewer && state.exchange?.playerId === viewer.id ? { cards: [...activeInfluences(viewer), ...state.exchange.drawn].map((c) => ({ id: c.id, role: c.role })), keepCount: activeInfluences(viewer).length, originalIds: [...state.exchange.originalIds] } : null,
    proofOptions: viewer && state.challenge?.claimantId === viewer.id ? activeInfluences(viewer).filter((c) => c.role === state.challenge.role).map((c) => ({ id: c.id, role: c.role })) : [],
    logs: state.logs.map((entry) => ({ ...entry })), permissions: permissionsFor(state, viewer) };
}

export function buildView(state, viewerId) { return publicView(state, requireActor(state, viewerId)); }
export function buildSpectatorView(state) { return publicView(state, null); }

export function validateState(state) {
  if (!state || !Array.isArray(state.players)) throw new Error("Invalid game16 state");
  if (state.phase === "lobby") return true;
  const cards = [...state.deck, ...state.players.flatMap((p) => p.influences), ...(state.exchange?.drawn || [])];
  const ids = cards.map((card) => card.id);
  if (cards.length !== 15 || new Set(ids).size !== 15) throw new Error(`Influence card conservation failed: ${cards.length}/${new Set(ids).size}`);
  if (state.players.some((p) => p.coins < 0 || p.influences.length !== 2)) throw new Error("Invalid player resources");
  return true;
}

export function serializeState(state) { validateState(state); return structuredClone(state); }
export function restoreState(serializedState) {
  if (serializedState?.stateVersion !== STATE_VERSION) throw new Error(`Unsupported game16 state version: ${serializedState?.stateVersion}`);
  const state = structuredClone(serializedState); validateState(state); return state;
}
