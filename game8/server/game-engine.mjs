import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Engine = require("../rules.js");
const CARDS = require("../data/cards.json");
const CARD_BY_ID = Object.fromEntries(CARDS.map((card) => [card.id, card]));

export const ACTION_SECONDS = 0;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const STATE_VERSION = 1;
export const SUPPORTS_SPECTATORS = true;

export class GameRuleError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "GameRuleError";
    this.code = code;
    this.status = status;
  }
}

function cleanName(value, fallback = "训练家") {
  return String(value ?? "").trim().slice(0, 12) || fallback;
}

function assertCapacity(capacity) {
  const value = Number(capacity);
  if (!Number.isInteger(value) || value < MIN_PLAYERS || value > MAX_PLAYERS) {
    throw new GameRuleError("invalid_capacity", "游戏人数必须为 2～4 人。");
  }
  return value;
}

function makePlayer({ id, name, isHost = false, connected = false }) {
  if (!id) throw new GameRuleError("player_id_required", "缺少玩家身份。");
  return {
    id: String(id),
    name: cleanName(name, isHost ? "房主" : "训练家"),
    isHost: Boolean(isHost),
    connected: Boolean(connected)
  };
}

function requireHost(state, actorId) {
  const player = state.players.find((item) => item.id === actorId);
  if (!player?.isHost) {
    throw new GameRuleError("host_required", "只有房主可以执行此操作。", 403);
  }
  return player;
}

function resetToLobby(state) {
  state.phase = "lobby";
  state.game = null;
}

function staticGameData(game) {
  const restored = {
    ...game,
    cardDB: CARDS,
    byId: CARD_BY_ID,
    megaDB: [],
    pokemartDB: []
  };
  for (const player of restored.players || []) {
    player.reserveVisibility ||= {};
    for (const id of player.reserve || []) player.reserveVisibility[id] ||= "secret";
  }
  return restored;
}

function finishTurnWhenNoDecisionRemains(game, seat, actionType) {
  if (!game || game.phase === "gameover" || !game.acted) return;
  const pending = Engine.turnState(game);
  if (pending.mustDiscard > 0) return;
  const completedEvolution = actionType === "evolve" || actionType === "megaEvolve";
  const hasEvolutionChoice = pending.evolutions.length > 0 || pending.megaEvolutions.length > 0;
  if (!completedEvolution && hasEvolutionChoice) return;
  const ended = Engine.applyAction(game, { type: "endTurn" }, seat);
  if (!ended?.ok) throw new Error(`Unable to automatically end game8 turn: ${ended?.error || "unknown error"}`);
}

export function createLobby({ capacity, host }) {
  return {
    stateVersion: STATE_VERSION,
    phase: "lobby",
    capacity: assertCapacity(capacity),
    players: [makePlayer({ ...host, isHost: true })],
    game: null
  };
}

export function addPlayer(state, player) {
  if (state.phase !== "lobby") {
    throw new GameRuleError("game_started", "游戏已经开始，不能中途加入。", 409);
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
  if (state.phase !== "lobby") {
    throw new GameRuleError("game_started", "游戏开始后不能移出玩家。", 409);
  }
  const index = state.players.findIndex((player) => player.id === String(playerId));
  const target = state.players[index];
  if (!target || target.isHost) {
    throw new GameRuleError("invalid_kick_target", "无法移出该玩家。");
  }
  state.players.splice(index, 1);
  return target;
}

export function canChangeSeats(state) {
  return state.phase === "lobby";
}

export function vacateSeat(state, playerId) {
  if (!canChangeSeats(state)) {
    throw new GameRuleError("seat_change_unavailable", "游戏开始后不能转入旁观席。", 409);
  }
  const index = state.players.findIndex((player) => player.id === String(playerId));
  const target = state.players[index];
  if (!target || target.isHost) {
    throw new GameRuleError("invalid_seat_target", "该训练家不能转入旁观席。", 403);
  }
  state.players.splice(index, 1);
  return target;
}

export function setPresence(state, playerId, connected) {
  const player = state.players.find((item) => item.id === String(playerId));
  if (!player || player.connected === Boolean(connected)) return false;
  player.connected = Boolean(connected);
  return true;
}

export function applyAction(state, actorId, action, { random = Math.random } = {}) {
  const type = action?.type;

  if (type === "setCapacity") {
    requireHost(state, actorId);
    if (state.phase !== "lobby") {
      throw new GameRuleError("game_started", "游戏开始后不能修改人数。", 409);
    }
    const capacity = assertCapacity(action.capacity);
    if (capacity < state.players.length) {
      throw new GameRuleError("capacity_too_small", "人数不能少于已经加入的玩家数。", 409);
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
      throw new GameRuleError("players_missing", `需要 ${state.capacity} 位训练家到齐。`, 409);
    }
    if (state.players.some((player) => !player.connected)) {
      throw new GameRuleError("players_offline", "请等待所有训练家恢复连接。", 409);
    }
    const seed = Math.floor(Math.max(0, Math.min(0.999999999, random())) * 2 ** 31);
    state.game = Engine.createGame(CARDS, {
      numPlayers: state.capacity,
      names: state.players.map((player) => player.name),
      seed
    });
    state.phase = "playing";
    return;
  }

  if (type === "end") {
    requireHost(state, actorId);
    if (state.phase !== "playing") {
      throw new GameRuleError("game_not_playing", "当前没有可结束的游戏。", 409);
    }
    resetToLobby(state);
    return;
  }

  if (type === "restart") {
    requireHost(state, actorId);
    if (state.phase !== "ended") {
      throw new GameRuleError("game_not_ended", "只有结算后才能返回大厅。", 409);
    }
    resetToLobby(state);
    return;
  }

  if (state.phase !== "playing" || !state.game) {
    throw new GameRuleError("game_not_playing", "游戏当前不在进行中。", 409);
  }
  const seat = state.players.findIndex((player) => player.id === String(actorId));
  if (seat < 0) throw new GameRuleError("not_a_player", "你不属于这个房间。", 403);
  if (!type) throw new GameRuleError("unknown_action", "无法识别该操作。");
  const result = Engine.applyAction(state.game, action, seat);
  if (!result?.ok) {
    throw new GameRuleError("invalid_game_action", result?.error || "当前操作不合法。", 409);
  }
  if (type !== "endTurn") finishTurnWhenNoDecisionRemains(state.game, seat, type);
  if (state.game.phase === "gameover") state.phase = "ended";
}

export function handleTimeout() {
  return false;
}

export function getDeadline() {
  return 0;
}

function buildPublicView(state, { viewer = null, seat = -1, permissions } = {}) {
  const game = state.game ? Engine.redactFor(state.game, seat) : null;
  if (game && !viewer) game.viewerId = null;
  return {
    selfId: viewer?.id ?? null,
    viewerId: viewer?.id ?? null,
    phase: state.phase,
    capacity: state.capacity,
    players: state.players.map((player) => ({ ...player })),
    game,
    permissions
  };
}

export function buildView(state, viewerId) {
  const seat = state.players.findIndex((player) => player.id === String(viewerId));
  const viewer = state.players[seat];
  if (!viewer) throw new GameRuleError("not_a_player", "你不属于这个房间。", 403);
  return buildPublicView(state, {
    viewer,
    seat,
    permissions: {
      canManage: viewer.isHost,
      canKick: viewer.isHost && state.phase === "lobby",
      canStart: viewer.isHost && state.phase === "lobby",
      canEnd: viewer.isHost && state.phase === "playing",
      canRestart: viewer.isHost && state.phase === "ended"
    }
  });
}

export function buildSpectatorView(state) {
  return buildPublicView(state, {
    seat: -1,
    permissions: {
      canManage: false,
      canKick: false,
      canStart: false,
      canEnd: false,
      canRestart: false
    }
  });
}

export function serializeState(state) {
  const serialized = structuredClone({ ...state, game: null });
  if (!state.game) return serialized;
  const { cardDB, byId, megaDB, pokemartDB, ...dynamic } = state.game;
  serialized.game = structuredClone(dynamic);
  return serialized;
}

export function restoreState(serializedState) {
  const state = structuredClone(serializedState);
  if (state.stateVersion !== STATE_VERSION) {
    throw new Error(`Unsupported game8 state version ${state.stateVersion}`);
  }
  if (state.game) state.game = staticGameData(state.game);
  return state;
}

export const cardDatabase = CARDS;
