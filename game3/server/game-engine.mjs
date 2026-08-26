import { CATEGORIES, categoryScore, isYahtzee, newScorecard, totals } from "../rules.mjs";

export const ACTION_SECONDS = 0;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const STATE_VERSION = 1;

export class GameRuleError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "GameRuleError";
    this.code = code;
    this.status = status;
  }
}

function cleanName(value, fallback = "玩家") {
  return String(value ?? "").trim().slice(0, 12) || fallback;
}

function assertCapacity(capacity) {
  const value = Number(capacity);
  if (!Number.isInteger(value) || value < MIN_PLAYERS || value > MAX_PLAYERS) {
    throw new GameRuleError("invalid_capacity", "游戏人数必须为 2～6 人。");
  }
  return value;
}

function makePlayer({ id, name, isHost = false, connected = false }) {
  if (!id) throw new GameRuleError("player_id_required", "缺少玩家身份。");
  return {
    id: String(id),
    name: cleanName(name, isHost ? "房主" : "玩家"),
    isHost: Boolean(isHost),
    connected: Boolean(connected),
    scorecard: newScorecard(),
    yahtzeeBonus: 0
  };
}

function requireHost(state, actorId) {
  const actor = state.players.find((player) => player.id === String(actorId));
  if (!actor?.isHost) {
    throw new GameRuleError("host_required", "只有房主可以执行此操作。", 403);
  }
  return actor;
}

function resetTurn(state) {
  state.dice = [null, null, null, null, null];
  state.held = [false, false, false, false, false];
  state.rolls = 0;
}

function resetScores(state) {
  for (const player of state.players) {
    player.scorecard = newScorecard();
    player.yahtzeeBonus = 0;
  }
}

function resetToLobby(state) {
  state.phase = "lobby";
  state.currentPlayerIndex = 0;
  state.completedTurns = 0;
  resetTurn(state);
  resetScores(state);
}

function currentPlayer(state) {
  return state.players[state.currentPlayerIndex] || null;
}

function nextConnectedPlayerIndex(state, from) {
  for (let step = 1; step <= state.players.length; step += 1) {
    const index = (from + step) % state.players.length;
    if (state.players[index].connected) return index;
  }
  return null;
}

function rollDie(random) {
  return Math.floor(Math.max(0, Math.min(0.999999999, random())) * 6) + 1;
}

export function createLobby({ capacity, host }) {
  return {
    stateVersion: STATE_VERSION,
    phase: "lobby",
    capacity: assertCapacity(capacity),
    players: [makePlayer({ ...host, isHost: true })],
    currentPlayerIndex: 0,
    completedTurns: 0,
    dice: [null, null, null, null, null],
    held: [false, false, false, false, false],
    rolls: 0
  };
}

export function addPlayer(state, player) {
  if (state.phase !== "lobby") {
    throw new GameRuleError("game_started", "比赛已经开始，无法中途加入。", 409);
  }
  if (state.players.length >= state.capacity) {
    throw new GameRuleError("room_full", "房间人数已满。", 409);
  }
  if (state.players.some((item) => item.id === String(player.id))) {
    throw new GameRuleError("player_exists", "该玩家已经在房间中。", 409);
  }
  const next = makePlayer(player);
  state.players.push(next);
  return next;
}

export function removePlayer(state, actorId, playerId) {
  requireHost(state, actorId);
  const index = state.players.findIndex((player) => player.id === String(playerId));
  const target = state.players[index];
  if (!target || target.isHost) {
    throw new GameRuleError("invalid_kick_target", "无法移出该玩家。");
  }
  state.players.splice(index, 1);
  if (state.phase !== "lobby") resetToLobby(state);
  return target;
}

export function setPresence(state, playerId, connected) {
  const player = state.players.find((item) => item.id === String(playerId));
  if (!player || player.connected === Boolean(connected)) return false;
  player.connected = Boolean(connected);
  if (!connected && state.phase === "playing" && currentPlayer(state)?.id === player.id) {
    const nextIndex = nextConnectedPlayerIndex(state, state.currentPlayerIndex);
    if (nextIndex == null) state.phase = "ended";
    else {
      state.currentPlayerIndex = nextIndex;
      resetTurn(state);
    }
  }
  return true;
}

export function applyAction(state, actorId, action, { random = Math.random } = {}) {
  const type = action?.type;

  if (type === "setCapacity") {
    requireHost(state, actorId);
    if (state.phase !== "lobby") {
      throw new GameRuleError("game_started", "比赛开始后不能修改人数。", 409);
    }
    const capacity = assertCapacity(action.capacity);
    if (capacity < state.players.length) {
      throw new GameRuleError("capacity_too_small", "新人数不能少于当前已加入人数。", 409);
    }
    state.capacity = capacity;
    return;
  }

  if (type === "start") {
    requireHost(state, actorId);
    if (state.phase !== "lobby") {
      throw new GameRuleError("already_started", "比赛已经开始。", 409);
    }
    if (state.players.length !== state.capacity) {
      throw new GameRuleError("players_missing", `需要 ${state.capacity} 名玩家到齐后才能开始。`, 409);
    }
    if (state.players.some((player) => !player.connected)) {
      throw new GameRuleError("players_offline", "所有玩家在线后才能开始。", 409);
    }
    resetScores(state);
    state.phase = "playing";
    state.currentPlayerIndex = 0;
    state.completedTurns = 0;
    resetTurn(state);
    return;
  }

  if (type === "end") {
    requireHost(state, actorId);
    if (state.phase !== "playing") {
      throw new GameRuleError("game_not_playing", "当前没有可结束的比赛。", 409);
    }
    resetToLobby(state);
    return;
  }

  if (type === "restart") {
    requireHost(state, actorId);
    if (state.phase !== "ended") {
      throw new GameRuleError("game_not_ended", "只有比赛结束后才能返回大厅。", 409);
    }
    resetToLobby(state);
    return;
  }

  if (state.phase !== "playing") {
    throw new GameRuleError("game_not_playing", "比赛当前不在进行中。", 409);
  }
  const player = currentPlayer(state);
  if (!player || player.id !== String(actorId)) {
    throw new GameRuleError("not_your_turn", "现在还没有轮到你。", 409);
  }

  if (type === "roll") {
    if (state.rolls >= 3) {
      throw new GameRuleError("roll_limit", "本回合已经投掷三次。", 409);
    }
    state.dice = state.dice.map((value, index) => (
      state.held[index] && value != null ? value : rollDie(random)
    ));
    state.rolls += 1;
    return;
  }

  if (type === "hold") {
    const index = Number(action.index);
    if (state.rolls < 1 || state.rolls >= 3) {
      throw new GameRuleError("cannot_hold", "只能在第一次和第三次投掷之间保留骰子。", 409);
    }
    if (!Number.isInteger(index) || index < 0 || index >= state.dice.length) {
      throw new GameRuleError("invalid_die", "骰子位置无效。");
    }
    state.held[index] = !state.held[index];
    return;
  }

  if (type === "score") {
    if (state.rolls < 1) {
      throw new GameRuleError("roll_required", "至少投掷一次后才能计分。", 409);
    }
    const categoryId = String(action.category || "");
    if (!CATEGORIES.some((category) => category.id === categoryId)) {
      throw new GameRuleError("invalid_category", "计分类别无效。");
    }
    if (player.scorecard[categoryId] !== null) {
      throw new GameRuleError("category_used", "该计分格已经使用。", 409);
    }
    const extraYahtzee = isYahtzee(state.dice) && player.scorecard.yahtzee === 50;
    player.scorecard[categoryId] = categoryScore(categoryId, state.dice);
    if (extraYahtzee) player.yahtzeeBonus += 100;
    state.completedTurns += 1;
    if (state.completedTurns >= state.players.length * CATEGORIES.length) {
      state.phase = "ended";
      resetTurn(state);
    } else {
      state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
      resetTurn(state);
    }
    return;
  }

  throw new GameRuleError("unknown_action", "无法识别该操作。");
}

export function handleTimeout() {
  return false;
}

export function getDeadline() {
  return 0;
}

export function serializeState(state) {
  return structuredClone(state);
}

export function restoreState(serializedState) {
  if (serializedState?.stateVersion !== STATE_VERSION) {
    throw new Error(`Unsupported game3 state version: ${serializedState?.stateVersion}`);
  }
  return structuredClone(serializedState);
}

export function buildView(state, viewerId) {
  const viewer = state.players.find((player) => player.id === String(viewerId));
  if (!viewer) throw new GameRuleError("not_a_player", "你不属于这个房间。", 403);
  const round = state.phase === "lobby"
    ? 0
    : state.phase === "ended"
      ? CATEGORIES.length
      : Math.floor(state.completedTurns / state.players.length) + 1;
  return {
    selfId: viewer.id,
    phase: state.phase,
    playerCount: state.capacity,
    currentPlayerId: state.phase === "playing" ? currentPlayer(state)?.id || null : null,
    currentPlayerIndex: state.currentPlayerIndex,
    completedTurns: state.completedTurns,
    round,
    dice: [...state.dice],
    held: [...state.held],
    rolls: state.rolls,
    players: state.players.map((player) => ({
      ...player,
      scorecard: { ...player.scorecard },
      totals: totals(player)
    })),
    permissions: {
      canManage: viewer.isHost,
      canKick: viewer.isHost,
      canStart: viewer.isHost && state.phase === "lobby",
      canEnd: viewer.isHost && state.phase === "playing",
      canRestart: viewer.isHost && state.phase === "ended"
    }
  };
}
