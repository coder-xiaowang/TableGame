import { applyMoves, commitTurn, completedColumns, rollOptions } from "../rules.js";
import { initializeDicePhysicsSimulation, simulateDiceRollReady } from "../dice-physics.js";

export const ACTION_SECONDS = 30;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const STATE_VERSION = 1;

const COLORS = ["#ef5b4c", "#2589bd", "#f5b82e", "#7557a8"];

export class GameRuleError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "GameRuleError";
    this.code = code;
    this.status = status;
  }
}

export async function initialize() {
  await initializeDicePhysicsSimulation();
}

function cleanName(value, fallback = "玩家") {
  return String(value ?? "").trim().slice(0, 12) || fallback;
}

function assertCapacity(capacity) {
  const value = Number(capacity);
  if (!Number.isInteger(value) || value < MIN_PLAYERS || value > MAX_PLAYERS) {
    throw new GameRuleError("invalid_capacity", "游戏人数必须为 2–4 人。");
  }
  return value;
}

function makePlayer({ id, name, isHost = false, connected = false }, index) {
  if (!id) throw new GameRuleError("player_id_required", "缺少玩家身份。");
  return {
    id: String(id),
    name: cleanName(name, isHost ? "房主" : "玩家"),
    isHost: Boolean(isHost),
    connected: Boolean(connected),
    color: COLORS[index],
    progress: {},
    claimed: []
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
  const actor = state.players.find((player) => player.id === String(actorId));
  if (!actor?.isHost) throw new GameRuleError("host_required", "只有房主可以执行此操作。", 403);
  return actor;
}

function currentPlayer(state) {
  return state.players[state.currentIndex] || null;
}

function requireTurn(state, actorId) {
  if (state.phase !== "playing") {
    throw new GameRuleError("game_not_playing", "游戏当前不在进行中。", 409);
  }
  const player = currentPlayer(state);
  if (!player || player.id !== String(actorId)) {
    throw new GameRuleError("not_your_turn", "现在还没有轮到你行动。", 409);
  }
  return player;
}

function beginStage(state, stage, now) {
  state.turnStage = stage;
  state.deadline = now + ACTION_SECONDS * 1000;
  state.revealAt = 0;
}

function clearRoll(state) {
  state.turnProgress = {};
  state.dice = [];
  state.pendingDice = [];
  state.options = [];
  state.revealAt = 0;
  state.physicsSeed = 0;
  state.rollFromTimeout = false;
}

function resetToLobby(state) {
  state.phase = "lobby";
  state.turnStage = "";
  state.currentIndex = 0;
  state.closed = {};
  state.deadline = 0;
  state.rollId = 0;
  state.winnerId = null;
  state.logs = [];
  state.logSequence = 0;
  clearRoll(state);
  for (const player of state.players) {
    player.progress = {};
    player.claimed = [];
  }
}

function randomSeed(random) {
  return (Math.floor(Math.max(0, Math.min(0.999999999999, random())) * 0x100000000) >>> 0) || 1;
}

function startRoll(state, { now, random, fromTimeout = false }) {
  const seed = randomSeed(random);
  let simulation;
  try {
    simulation = simulateDiceRollReady(seed);
  } catch {
    const fallback = Array.from({ length: 4 }, () => Math.floor(random() * 6) + 1);
    simulation = { results: fallback, durationMs: 900 };
    state.physicsSeed = 0;
  }
  state.turnStage = "rolling";
  state.rollId += 1;
  state.rollFromTimeout = fromTimeout;
  state.physicsSeed = state.physicsSeed === 0 ? 0 : seed;
  if (simulation.frames) state.physicsSeed = seed;
  state.dice = [];
  state.pendingDice = [...simulation.results];
  state.options = [];
  state.deadline = 0;
  state.revealAt = now + simulation.durationMs;
}

function nextTurn(state, now) {
  clearRoll(state);
  state.currentIndex = (state.currentIndex + 1) % state.players.length;
  beginStage(state, "roll", now);
}

function bustTurn(state, now) {
  addLog(state, `${currentPlayer(state).name} 无路可走，本回合攀登成果全部丢失`, now);
  nextTurn(state, now);
}

function chooseOption(state, key, { now, fromTimeout = false }) {
  if (state.turnStage !== "choose") {
    throw new GameRuleError("wrong_stage", "当前不能选择骰子组合。", 409);
  }
  const option = state.options.find((item) => item.key === String(key));
  if (!option) throw new GameRuleError("invalid_option", "该骰子组合已经不可用。", 409);
  const player = currentPlayer(state);
  state.turnProgress = applyMoves(state.turnProgress, player.progress, option.moves);
  addLog(state, `${player.name}${fromTimeout ? "超时，自动" : ""}推进 ${option.moves.join("、")} 号路线`, now);
  state.options = [];
  beginStage(state, "decision", now);
}

function stopTurn(state, { now, fromTimeout = false }) {
  if (state.turnStage !== "decision") {
    throw new GameRuleError("wrong_stage", "当前还不能扎营。", 409);
  }
  const player = currentPlayer(state);
  player.progress = commitTurn(player.progress, state.turnProgress);
  const newlyClaimed = completedColumns(player.progress).filter((column) => !state.closed[column]);
  for (const column of newlyClaimed) {
    state.closed[column] = player.id;
    player.claimed.push(column);
  }
  addLog(
    state,
    `${player.name}${fromTimeout ? "超时，自动" : ""}选择扎营${newlyClaimed.length ? `，占领 ${newlyClaimed.join("、")} 号路线` : ""}`,
    now
  );
  if (player.claimed.length >= 3) {
    state.phase = "ended";
    state.turnStage = "";
    state.deadline = 0;
    state.revealAt = 0;
    state.winnerId = player.id;
    addLog(state, `${player.name} 占领三条路线，赢得游戏`, now);
    return;
  }
  nextTurn(state, now);
}

export function createLobby({ capacity, host }) {
  return {
    stateVersion: STATE_VERSION,
    phase: "lobby",
    turnStage: "",
    capacity: assertCapacity(capacity),
    players: [makePlayer({ ...host, isHost: true }, 0)],
    currentIndex: 0,
    turnProgress: {},
    dice: [],
    pendingDice: [],
    options: [],
    closed: {},
    deadline: 0,
    revealAt: 0,
    rollId: 0,
    physicsSeed: 0,
    rollFromTimeout: false,
    winnerId: null,
    logs: [],
    logSequence: 0
  };
}

export function addPlayer(state, player, { now = Date.now() } = {}) {
  if (state.phase !== "lobby") throw new GameRuleError("game_started", "游戏已经开始，暂时不能加入新玩家。", 409);
  if (state.players.length >= state.capacity) throw new GameRuleError("room_full", "房间人数已满。", 409);
  if (state.players.some((item) => item.id === String(player.id))) {
    throw new GameRuleError("player_exists", "该玩家已经在房间中。", 409);
  }
  const next = makePlayer(player, state.players.length);
  state.players.push(next);
  addLog(state, `${next.name} 加入了房间`, now);
  return next;
}

export function removePlayer(state, actorId, playerId, { now = Date.now() } = {}) {
  requireHost(state, actorId);
  if (state.phase !== "lobby") throw new GameRuleError("game_started", "游戏开始后不能移出玩家。", 409);
  const index = state.players.findIndex((player) => player.id === String(playerId));
  const target = state.players[index];
  if (!target || target.isHost) throw new GameRuleError("invalid_kick_target", "无法移出该玩家。");
  state.players.splice(index, 1);
  state.players.forEach((player, playerIndex) => { player.color = COLORS[playerIndex]; });
  addLog(state, `${target.name} 被移出房间`, now);
  return target;
}

export function setPresence(state, playerId, connected, { now = Date.now(), announce = true } = {}) {
  const player = state.players.find((item) => item.id === String(playerId));
  if (!player || player.connected === Boolean(connected)) return false;
  player.connected = Boolean(connected);
  if (announce) addLog(state, `${player.name} ${connected ? "重新连接" : "暂时离线"}`, now);
  return true;
}

export function applyAction(state, actorId, action, { now = Date.now(), random = Math.random } = {}) {
  const type = action?.type;
  if (type === "setCapacity") {
    requireHost(state, actorId);
    if (state.phase !== "lobby") throw new GameRuleError("game_started", "游戏开始后不能修改人数。", 409);
    const capacity = assertCapacity(action.capacity);
    if (capacity < state.players.length) throw new GameRuleError("capacity_too_small", "人数不能少于当前已加入的玩家数。", 409);
    state.capacity = capacity;
    return;
  }
  if (type === "start") {
    requireHost(state, actorId);
    if (state.phase !== "lobby") throw new GameRuleError("already_started", "游戏已经开始。", 409);
    if (state.players.length !== state.capacity) throw new GameRuleError("players_missing", `需要 ${state.capacity} 位玩家到齐。`, 409);
    if (state.players.some((player) => !player.connected)) throw new GameRuleError("players_offline", "请等待所有玩家恢复连接后再开始。", 409);
    for (const player of state.players) {
      player.progress = {};
      player.claimed = [];
    }
    state.phase = "playing";
    state.currentIndex = Math.floor(random() * state.players.length);
    state.closed = {};
    state.winnerId = null;
    state.logs = [];
    state.logSequence = 0;
    state.rollId = 0;
    clearRoll(state);
    addLog(state, `游戏开始，${currentPlayer(state).name} 首先攀登`, now);
    beginStage(state, "roll", now);
    return;
  }
  if (type === "end") {
    requireHost(state, actorId);
    if (state.phase !== "playing") throw new GameRuleError("game_not_playing", "当前没有可结束的游戏。", 409);
    resetToLobby(state);
    return;
  }
  if (type === "restart") {
    requireHost(state, actorId);
    if (state.phase !== "ended") throw new GameRuleError("game_not_ended", "只有游戏结束后才能返回大厅。", 409);
    resetToLobby(state);
    return;
  }

  requireTurn(state, actorId);
  if (type === "roll") {
    if (!["roll", "decision"].includes(state.turnStage)) throw new GameRuleError("wrong_stage", "当前不能投掷骰子。", 409);
    startRoll(state, { now, random });
    return;
  }
  if (type === "choose") {
    chooseOption(state, action.key, { now });
    return;
  }
  if (type === "stop") {
    stopTurn(state, { now });
    return;
  }
  throw new GameRuleError("unknown_action", "无法识别该游戏操作。");
}

export function handleTimeout(state, { now = Date.now(), random = Math.random } = {}) {
  if (state.phase !== "playing") return false;
  if (state.turnStage === "rolling" && state.revealAt && now >= state.revealAt) {
    state.dice = [...state.pendingDice];
    state.pendingDice = [];
    state.options = rollOptions(state.dice, state.turnProgress, Object.keys(state.closed).map(Number));
    addLog(state, `${currentPlayer(state).name}${state.rollFromTimeout ? "超时，自动" : ""}掷出了 ${state.dice.join("、")}`, now);
    state.rollFromTimeout = false;
    state.turnStage = "settled";
    state.revealAt = now + 700;
    return true;
  }
  if (state.turnStage === "settled" && state.revealAt && now >= state.revealAt) {
    if (!state.options.length) bustTurn(state, now);
    else beginStage(state, "choose", now);
    return true;
  }
  if (!state.deadline || now < state.deadline) return false;
  if (state.turnStage === "choose" && state.options.length) {
    chooseOption(state, state.options[0].key, { now, fromTimeout: true });
    return true;
  }
  if (state.turnStage === "decision") {
    stopTurn(state, { now, fromTimeout: true });
    return true;
  }
  if (state.turnStage === "roll") {
    startRoll(state, { now, random, fromTimeout: true });
    return true;
  }
  return false;
}

export function getDeadline(state) {
  if (state.phase !== "playing") return 0;
  if (["rolling", "settled"].includes(state.turnStage)) return state.revealAt;
  return state.deadline;
}

export function buildView(state, viewerId) {
  const viewer = state.players.find((player) => player.id === String(viewerId));
  if (!viewer) throw new GameRuleError("not_a_player", "你不属于这个游戏房间。", 403);
  return {
    selfId: viewer.id,
    phase: state.phase,
    turnStage: state.turnStage,
    capacity: state.capacity,
    currentIndex: state.currentIndex,
    turnProgress: { ...state.turnProgress },
    dice: [...state.dice],
    options: state.options.map((option) => ({ key: option.key, pair: [...option.pair], moves: [...option.moves] })),
    closed: { ...state.closed },
    deadline: state.deadline,
    revealAt: state.revealAt,
    rollId: state.rollId,
    physicsSeed: state.physicsSeed,
    winnerId: state.winnerId,
    logs: state.logs.map((entry) => ({ ...entry })),
    permissions: {
      canManage: viewer.isHost,
      canKick: viewer.isHost && state.phase === "lobby",
      canStart: viewer.isHost && state.phase === "lobby",
      canEnd: viewer.isHost && state.phase === "playing",
      canRestart: viewer.isHost && state.phase === "ended"
    },
    players: state.players.map((player) => ({
      ...player,
      progress: { ...player.progress },
      claimed: [...player.claimed]
    }))
  };
}

export function serializeState(state) {
  return structuredClone(state);
}

export function restoreState(serializedState) {
  if (serializedState?.stateVersion !== STATE_VERSION) {
    throw new Error(`Unsupported game10 state version: ${serializedState?.stateVersion}`);
  }
  return structuredClone(serializedState);
}
