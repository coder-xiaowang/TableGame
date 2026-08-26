import { cardScore, finalScore, startingChips } from "../rules.js";

export const ACTION_SECONDS = 30;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 7;

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
    throw new GameRuleError("invalid_capacity", "游戏人数必须为 3–7 人。");
  }
  return value;
}

function cleanName(value, fallback = "玩家") {
  return String(value ?? "").trim().slice(0, 12) || fallback;
}

function makePlayer({ id, name, isHost = false, connected = false }) {
  if (!id) throw new GameRuleError("player_id_required", "缺少玩家身份。");
  return {
    id: String(id),
    name: cleanName(name, isHost ? "房主" : "玩家"),
    isHost: Boolean(isHost),
    connected: Boolean(connected),
    chips: 0,
    cards: []
  };
}

function addLog(state, text, now = Date.now()) {
  state.logs.unshift({
    id: `log_${now}_${state.logSequence += 1}`,
    text: String(text),
    at: now
  });
  if (state.logs.length > 100) state.logs.length = 100;
}

function requireHost(state, actorId) {
  const actor = state.players.find((player) => player.id === actorId);
  if (!actor?.isHost) {
    throw new GameRuleError("host_required", "只有房主可以执行此操作。", 403);
  }
  return actor;
}

function requirePlayingTurn(state, actorId) {
  if (state.phase !== "playing") {
    throw new GameRuleError("game_not_playing", "游戏当前不在进行中。", 409);
  }
  const player = state.players[state.currentIndex];
  if (!player || player.id !== actorId) {
    throw new GameRuleError("not_your_turn", "现在还没有轮到你行动。", 409);
  }
  return player;
}

function shuffle(items, random) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [items[index], items[target]] = [items[target], items[index]];
  }
  return items;
}

function beginTurn(state, now) {
  state.deadline = now + ACTION_SECONDS * 1000;
}

function finishGame(state, now) {
  state.phase = "ended";
  state.deadline = 0;
  state.activeCard = null;
  const best = Math.min(...state.players.map(finalScore));
  state.winners = state.players
    .filter((player) => finalScore(player) === best)
    .map((player) => player.id);
  const names = state.winners
    .map((id) => state.players.find((player) => player.id === id)?.name)
    .join("、");
  addLog(state, `${names} 以 ${best} 分获胜`, now);
}

function takeCard(state, player, { now, fromTimeout = false }) {
  const card = state.activeCard;
  const collected = state.pot;
  player.cards.push(card);
  player.cards.sort((a, b) => a - b);
  player.chips += collected;
  addLog(
    state,
    `${player.name} 拿下 ${card}${collected ? `，并获得 ${collected} 枚筹码` : ""}${fromTimeout ? "（超时）" : ""}`,
    now
  );
  state.pot = 0;
  if (!state.deck.length) {
    finishGame(state, now);
    return;
  }
  state.activeCard = state.deck.pop();
  beginTurn(state, now);
}

export function createLobby({ capacity, host }) {
  return {
    phase: "lobby",
    capacity: assertCapacity(capacity),
    players: [makePlayer({ ...host, isHost: true })],
    deck: [],
    removed: [],
    activeCard: null,
    pot: 0,
    currentIndex: 0,
    deadline: 0,
    winners: [],
    logs: [],
    logSequence: 0
  };
}

export function addPlayer(state, player, { now = Date.now() } = {}) {
  if (state.phase !== "lobby") {
    throw new GameRuleError("game_started", "游戏已经开始，暂时不能加入新玩家。", 409);
  }
  if (state.players.length >= state.capacity) {
    throw new GameRuleError("room_full", "房间人数已满。", 409);
  }
  if (state.players.some((item) => item.id === player.id)) {
    throw new GameRuleError("player_exists", "该玩家已经在房间中。", 409);
  }
  const next = makePlayer(player);
  state.players.push(next);
  addLog(state, `${next.name} 加入了房间`, now);
  return next;
}

export function removePlayer(state, actorId, playerId, { now = Date.now() } = {}) {
  requireHost(state, actorId);
  if (state.phase !== "lobby") {
    throw new GameRuleError("game_started", "游戏开始后不能移出玩家。", 409);
  }
  const index = state.players.findIndex((player) => player.id === playerId);
  const target = state.players[index];
  if (!target || target.isHost) {
    throw new GameRuleError("invalid_kick_target", "无法移出该玩家。");
  }
  state.players.splice(index, 1);
  addLog(state, `${target.name} 被移出房间`, now);
  return target;
}

export function setPresence(state, playerId, connected, {
  now = Date.now(),
  announce = true
} = {}) {
  const player = state.players.find((item) => item.id === playerId);
  if (!player || player.connected === Boolean(connected)) return false;
  player.connected = Boolean(connected);
  if (announce) addLog(state, `${player.name} ${connected ? "重新连接" : "暂时离线"}`, now);
  return true;
}

export function applyAction(state, actorId, action, {
  now = Date.now(),
  random = Math.random
} = {}) {
  const type = action?.type;

  if (type === "setCapacity") {
    requireHost(state, actorId);
    if (state.phase !== "lobby") {
      throw new GameRuleError("game_started", "游戏开始后不能修改人数。", 409);
    }
    const capacity = assertCapacity(action.capacity);
    if (capacity < state.players.length) {
      throw new GameRuleError("capacity_too_small", "人数不能少于当前已加入的玩家数。", 409);
    }
    state.capacity = capacity;
    return;
  }

  if (type === "start") {
    requireHost(state, actorId);
    if (state.phase !== "lobby") {
      throw new GameRuleError("already_started", "游戏已经开始。", 409);
    }
    if (state.players.length !== state.capacity) {
      throw new GameRuleError("players_missing", `需要 ${state.capacity} 位玩家到齐。`, 409);
    }
    if (state.players.some((player) => !player.connected)) {
      throw new GameRuleError("players_offline", "请等待所有玩家恢复连接后再开始。", 409);
    }
    const cards = shuffle(Array.from({ length: 33 }, (_, index) => index + 3), random);
    state.removed = cards.splice(0, 9).sort((a, b) => a - b);
    state.deck = cards;
    state.pot = 0;
    state.winners = [];
    state.logs = [];
    state.logSequence = 0;
    const chips = startingChips(state.capacity);
    for (const player of state.players) {
      player.cards = [];
      player.chips = chips;
    }
    state.currentIndex = Math.floor(random() * state.players.length);
    state.activeCard = state.deck.pop();
    state.phase = "playing";
    addLog(state, `游戏开始，${state.players[state.currentIndex].name} 首先行动`, now);
    beginTurn(state, now);
    return;
  }

  if (type === "end") {
    requireHost(state, actorId);
    if (state.phase !== "playing") {
      throw new GameRuleError("game_not_playing", "当前没有可结束的游戏。", 409);
    }
    state.phase = "lobby";
    state.deck = [];
    state.removed = [];
    state.activeCard = null;
    state.pot = 0;
    state.deadline = 0;
    state.winners = [];
    state.logs = [];
    state.logSequence = 0;
    for (const player of state.players) {
      player.cards = [];
      player.chips = 0;
    }
    return;
  }

  const player = requirePlayingTurn(state, actorId);
  if (type === "pass") {
    if (player.chips <= 0) {
      throw new GameRuleError("no_chips", "你没有筹码，只能拿下当前数字牌。", 409);
    }
    player.chips -= 1;
    state.pot += 1;
    addLog(state, `${player.name} 说了“不，谢谢”，牌上增加 1 枚筹码`, now);
    state.currentIndex = (state.currentIndex + 1) % state.players.length;
    beginTurn(state, now);
    return;
  }
  if (type === "take") {
    takeCard(state, player, { now });
    return;
  }
  throw new GameRuleError("unknown_action", "无法识别该游戏操作。");
}

export function handleTimeout(state, { now = Date.now() } = {}) {
  if (state.phase !== "playing" || !state.deadline || now < state.deadline) return false;
  const player = state.players[state.currentIndex];
  addLog(state, `${player.name} 行动超时，自动拿下 ${state.activeCard}`, now);
  takeCard(state, player, { now, fromTimeout: true });
  return true;
}

export function buildView(state, viewerId) {
  const viewer = state.players.find((player) => player.id === viewerId);
  if (!viewer) throw new GameRuleError("not_a_player", "你不属于这个游戏房间。", 403);
  const reveal = state.phase === "ended";
  return {
    selfId: viewerId,
    phase: state.phase,
    capacity: state.capacity,
    currentIndex: state.currentIndex,
    activeCard: state.activeCard,
    pot: state.pot,
    deckCount: state.deck.length,
    deadline: state.deadline,
    winners: [...state.winners],
    removed: reveal ? [...state.removed] : [],
    logs: state.logs.map((entry) => ({ ...entry })),
    permissions: {
      canManage: viewer.isHost,
      canKick: viewer.isHost && state.phase === "lobby",
      canStart: viewer.isHost && state.phase === "lobby",
      canEnd: viewer.isHost && state.phase === "playing"
    },
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      isHost: player.isHost,
      connected: player.connected,
      cards: [...player.cards],
      cardScore: cardScore(player.cards),
      chips: player.id === viewerId || reveal ? player.chips : null,
      finalScore: reveal ? finalScore(player) : null
    }))
  };
}

export function getDeadline(state) {
  return state.phase === "playing" ? state.deadline : 0;
}
