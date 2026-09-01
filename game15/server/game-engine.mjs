import {
  INITIAL_HAND_SIZE,
  INITIAL_MELD_SCORE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  createTileSet,
  rackScore,
  shuffleTiles,
  validateMeld
} from "../rules.mjs";

export const ACTION_SECONDS = 90;
export const STATE_VERSION = 1;
export const SUPPORTS_SPECTATORS = true;
const CHANGE_NOTICE_MS = 8000;

export class GameRuleError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const cleanText = (value, fallback = "玩家") => String(value ?? "").trim().slice(0, 12) || fallback;
const playerById = (state, id) => state.players.find((player) => player.id === String(id)) || null;
const currentPlayer = (state) => state.players[state.currentIndex] || null;

function assertCapacity(value) {
  const capacity = Number(value);
  if (!Number.isInteger(capacity) || capacity < MIN_PLAYERS || capacity > MAX_PLAYERS) {
    throw new GameRuleError("invalid_capacity", "经典拉密支持2至4名玩家。");
  }
  return capacity;
}

function requireActor(state, id) {
  const actor = playerById(state, id);
  if (!actor) throw new GameRuleError("not_a_player", "你不属于这个房间。", 403);
  return actor;
}

function requireHost(state, id) {
  const actor = requireActor(state, id);
  if (!actor.isHost) throw new GameRuleError("host_required", "只有房主可以执行这个操作。", 403);
  return actor;
}

function requireTurn(state, actor) {
  if (state.phase !== "playing") throw new GameRuleError("action_unavailable", "当前不在牌局行动阶段。", 409);
  if (!actor.connected) throw new GameRuleError("not_connected", "重新连接后才能行动。", 409);
  if (currentPlayer(state)?.id !== actor.id) throw new GameRuleError("not_your_turn", "现在不是你的回合。", 409);
}

function makePlayer({ id, name, isHost = false, connected = false }) {
  return {
    id: String(id), name: cleanText(name), isHost, connected: Boolean(connected),
    hand: [], opened: false, score: 0, wins: 0
  };
}

function addLog(state, text, now) {
  state.logs.unshift({ id: ++state.logSequence, text, at: now });
  state.logs = state.logs.slice(0, 80);
}

function setDeadline(state, now) {
  state.deadline = now + ACTION_SECONDS * 1000;
}

function resetTurn(state, now) {
  state.turnEdited = false;
  state.turnId += 1;
  setDeadline(state, now);
}

function drawTiles(state, player, count) {
  const drawn = [];
  while (drawn.length < count && state.pool.length) {
    const tile = state.pool.pop();
    player.hand.push(tile);
    drawn.push(tile);
  }
  return drawn;
}

function resetToLobby(state) {
  state.phase = "lobby";
  state.gameNumber = 0;
  state.currentIndex = 0;
  state.startingPlayerId = null;
  state.pool = [];
  state.table = [];
  state.deadline = 0;
  state.turnEdited = false;
  state.consecutivePasses = 0;
  state.lastChange = null;
  state.gameResult = null;
  for (const player of state.players) {
    player.hand = [];
    player.opened = false;
    player.score = 0;
    player.wins = 0;
  }
}

function beginGame(state, now, random) {
  state.gameNumber += 1;
  const tiles = shuffleTiles(createTileSet(), random);
  state.table = [];
  state.pool = tiles;
  state.meldSequence = 0;
  state.consecutivePasses = 0;
  state.lastChange = null;
  state.gameResult = null;
  for (const player of state.players) {
    player.hand = [];
    player.opened = false;
  }
  for (let count = 0; count < INITIAL_HAND_SIZE; count += 1) {
    for (const player of state.players) player.hand.push(state.pool.pop());
  }
  state.currentIndex = (state.gameNumber - 1) % state.players.length;
  state.startingPlayerId = state.players[state.currentIndex].id;
  state.phase = "playing";
  resetTurn(state, now);
  addLog(state, `第${state.gameNumber}局开始，由${currentPlayer(state).name}先手。`, now);
}

function beginMatch(state, now, random) {
  state.gameNumber = 0;
  state.logs = [];
  state.logSequence = 0;
  for (const player of state.players) {
    player.score = 0;
    player.wins = 0;
  }
  beginGame(state, now, random);
}

function finishTurn(state, now, { resetPasses = true } = {}) {
  if (resetPasses) state.consecutivePasses = 0;
  state.currentIndex = (state.currentIndex + 1) % state.players.length;
  resetTurn(state, now);
}

function scoreNormalGame(state, winner, now) {
  let reward = 0;
  const scores = state.players.map((player) => {
    const remaining = player.id === winner.id ? 0 : rackScore(player.hand);
    if (player.id !== winner.id) {
      player.score -= remaining;
      reward += remaining;
    }
    return { playerId: player.id, remaining, delta: player.id === winner.id ? 0 : -remaining };
  });
  winner.score += reward;
  winner.wins += 1;
  scores.find((entry) => entry.playerId === winner.id).delta = reward;
  return { reason: "rummikub", winnerIds: [winner.id], scores, message: `${winner.name} 打空手牌，获得 ${reward} 分。`, at: now };
}

function blockedWinner(state) {
  const start = Math.max(0, state.players.findIndex((player) => player.id === state.startingPlayerId));
  const order = Array.from({ length: state.players.length }, (_, offset) => state.players[(start + offset) % state.players.length]);
  return order.reduce((best, player) => rackScore(player.hand) < rackScore(best.hand) ? player : best, order[0]);
}

function scoreBlockedGame(state, now) {
  const winner = blockedWinner(state);
  const winnerValue = rackScore(winner.hand);
  let reward = 0;
  const scores = state.players.map((player) => {
    if (player.id === winner.id) return { playerId: player.id, remaining: winnerValue, delta: 0 };
    const difference = Math.max(0, rackScore(player.hand) - winnerValue);
    player.score -= difference;
    reward += difference;
    return { playerId: player.id, remaining: rackScore(player.hand), delta: -difference };
  });
  winner.score += reward;
  winner.wins += 1;
  scores.find((entry) => entry.playerId === winner.id).delta = reward;
  return { reason: "blocked", winnerIds: [winner.id], scores, message: `牌池耗尽，${winner.name} 手牌点数最低，获得 ${reward} 分。`, at: now };
}

function endGame(state, result, now) {
  state.gameResult = result;
  state.deadline = 0;
  state.turnEdited = false;
  state.phase = state.gameNumber >= state.totalGames ? "matchEnd" : "gameEnd";
  addLog(state, result.message, now);
}

function normalizeLayout(state, actor, layout) {
  if (!Array.isArray(layout) || layout.length > 60) throw new GameRuleError("invalid_layout", "牌桌布局格式无效。");
  const known = new Map([
    ...state.table.flatMap((meld) => meld.tiles),
    ...actor.hand
  ].map((tile) => [tile.id, tile]));
  const seen = new Set();
  return layout.map((entry) => {
    const ids = Array.isArray(entry?.tileIds) ? entry.tileIds.map(String) : [];
    if (!ids.length || ids.length > 13) throw new GameRuleError("invalid_layout", "牌组不能为空且不能超过13张。", 409);
    const tiles = ids.map((id) => {
      if (seen.has(id)) throw new GameRuleError("duplicate_tile", "同一张牌不能在牌桌出现两次。", 409);
      const tile = known.get(id);
      if (!tile) throw new GameRuleError("unknown_tile", "布局包含不属于当前牌桌或你手牌的牌。", 409);
      seen.add(id);
      return tile;
    });
    const checked = validateMeld({ kind: entry.kind, tiles });
    if (!checked.valid) throw new GameRuleError("invalid_meld", checked.error, 409);
    return { requestedId: String(entry.id || ""), kind: entry.kind, tiles, checked };
  });
}

const tileIds = (meld) => meld.tiles.map((tile) => tile.id);
const sameMeld = (left, right) => left.kind === right.kind && JSON.stringify(tileIds(left)) === JSON.stringify(tileIds(right));

function changedTileIds(before, after, handIds) {
  const signature = (meld, index) => meld.tiles.map((tile, tileIndex) => [tile.id, `${meld.kind}:${index}:${tileIndex}:${meld.tiles.map((item) => item.id).join(",")}`]);
  const oldMap = new Map(before.flatMap(signature));
  const nextMap = new Map(after.flatMap(signature));
  return [...nextMap.keys()].filter((id) => handIds.has(id) || oldMap.get(id) !== nextMap.get(id));
}

function commitLayout(state, actor, action, now) {
  const proposed = normalizeLayout(state, actor, action.layout);
  const oldTableIds = new Set(state.table.flatMap(tileIds));
  const handIds = new Set(actor.hand.map((tile) => tile.id));
  const proposedIds = new Set(proposed.flatMap(tileIds));
  if ([...oldTableIds].some((id) => !proposedIds.has(id))) {
    throw new GameRuleError("table_tile_missing", "不能从牌桌拿走牌或把牌收回手中。", 409);
  }
  const usedHandIds = new Set([...proposedIds].filter((id) => handIds.has(id)));
  if (!usedHandIds.size) throw new GameRuleError("hand_tile_required", "每次有效出牌至少要使用一张自己的手牌。", 409);

  if (!actor.opened) {
    const unmatched = [...proposed];
    for (const oldMeld of state.table) {
      const index = unmatched.findIndex((meld) => sameMeld(oldMeld, meld));
      if (index < 0) throw new GameRuleError("initial_table_locked", "首次开牌不能移动或利用桌面已有牌。", 409);
      unmatched.splice(index, 1);
    }
    if (unmatched.some((meld) => meld.tiles.some((tile) => oldTableIds.has(tile.id)))) {
      throw new GameRuleError("initial_table_locked", "首次开牌只能使用自己的手牌组成新牌组。", 409);
    }
    const score = unmatched.reduce((total, meld) => total + meld.checked.score, 0);
    if (score < INITIAL_MELD_SCORE) throw new GameRuleError("initial_score_low", `首次开牌合计至少需要${INITIAL_MELD_SCORE}分，当前为${score}分。`, 409);
    actor.opened = true;
  }

  const nextTable = proposed.map((meld) => ({
    id: `m${++state.meldSequence}`,
    kind: meld.kind,
    tiles: meld.tiles.map((tile) => ({ ...tile })),
    assignments: meld.checked.assignments.map((item) => ({ ...item }))
  }));
  const changed = changedTileIds(state.table, nextTable, usedHandIds);
  actor.hand = actor.hand.filter((tile) => !usedHandIds.has(tile.id));
  state.table = nextTable;
  state.lastChange = { actorId: actor.id, tileIds: changed, until: now + CHANGE_NOTICE_MS };
  state.turnEdited = false;
  addLog(state, `${actor.name} 打出 ${usedHandIds.size} 张牌并确认了新牌桌。`, now);
  if (!actor.hand.length) return endGame(state, scoreNormalGame(state, actor, now), now);
  finishTurn(state, now);
}

export function createLobby({ capacity, host }) {
  return {
    stateVersion: STATE_VERSION,
    phase: "lobby",
    capacity: assertCapacity(capacity),
    totalGames: assertCapacity(capacity),
    gameNumber: 0,
    players: [makePlayer({ ...host, isHost: true })],
    pool: [], table: [], currentIndex: 0, startingPlayerId: null, deadline: 0, turnId: 0, turnEdited: false,
    consecutivePasses: 0, meldSequence: 0, lastChange: null, gameResult: null,
    logs: [], logSequence: 0
  };
}

export function addPlayer(state, player) {
  if (state.phase !== "lobby") throw new GameRuleError("game_started", "牌局已经开始。", 409);
  if (state.players.length >= state.capacity) throw new GameRuleError("room_full", "房间人数已满。", 409);
  if (playerById(state, player.id)) throw new GameRuleError("duplicate_player", "玩家身份已经存在。", 409);
  const created = makePlayer(player);
  state.players.push(created);
  return created;
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
  if (!canChangeSeats(state)) {
    throw new GameRuleError("seat_change_unavailable", "比赛开始后不能转入旁观席。", 409);
  }
  const index = state.players.findIndex((player) => player.id === String(playerId));
  const target = state.players[index];
  if (!target || target.isHost) {
    throw new GameRuleError("invalid_seat_target", "该玩家不能转入旁观席。", 403);
  }
  state.players.splice(index, 1);
  addLog(state, `${target.name} 转入了旁观席。`, now);
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
    if (capacity < state.players.length) throw new GameRuleError("capacity_too_small", "人数不能少于已经加入的玩家数。", 409);
    state.capacity = capacity;
    state.totalGames = capacity;
    return;
  }
  if (type === "start" || type === "restartMatch") {
    requireHost(state, actorId);
    if (type === "start" && state.phase !== "lobby") throw new GameRuleError("already_started", "比赛已经开始。", 409);
    if (type === "restartMatch" && state.phase !== "matchEnd") throw new GameRuleError("restart_unavailable", "当前不能开始新比赛。", 409);
    if (state.players.length !== state.capacity) throw new GameRuleError("players_missing", `需要${state.capacity}名玩家到齐。`, 409);
    if (state.players.some((player) => !player.connected)) throw new GameRuleError("players_offline", "所有玩家在线后才能开始。", 409);
    return beginMatch(state, now, random);
  }
  if (type === "nextGame") {
    requireHost(state, actorId);
    if (state.phase !== "gameEnd") throw new GameRuleError("next_game_unavailable", "当前不能开始下一局。", 409);
    if (state.players.some((player) => !player.connected)) throw new GameRuleError("players_offline", "所有玩家在线后才能开始下一局。", 409);
    return beginGame(state, now, random);
  }
  if (type === "end") {
    requireHost(state, actorId);
    if (state.phase === "lobby") throw new GameRuleError("game_not_started", "当前没有可结束的比赛。", 409);
    return resetToLobby(state);
  }

  requireTurn(state, actor);
  if (type === "beginEdit") {
    state.turnEdited = true;
    return;
  }
  if (type === "resetEdit") {
    state.turnEdited = false;
    return;
  }
  if (type === "commitLayout") return commitLayout(state, actor, action, now);
  if (type === "draw") {
    if (!state.pool.length) throw new GameRuleError("pool_empty", "牌池已经耗尽，请声明无法出牌。", 409);
    const drawn = drawTiles(state, actor, 1);
    state.turnEdited = false;
    addLog(state, `${actor.name} 摸了1张牌并结束回合。`, now);
    finishTurn(state, now);
    return drawn;
  }
  if (type === "passEmpty") {
    if (state.pool.length) throw new GameRuleError("pool_not_empty", "牌池尚未耗尽，应摸1张牌结束回合。", 409);
    state.turnEdited = false;
    state.consecutivePasses += 1;
    addLog(state, `${actor.name} 声明无法出牌。`, now);
    if (state.consecutivePasses >= state.players.length) return endGame(state, scoreBlockedGame(state, now), now);
    finishTurn(state, now, { resetPasses: false });
    return;
  }
  throw new GameRuleError("unknown_action", "无法识别这个操作。");
}

export function handleTimeout(state, { now = Date.now() } = {}) {
  if (state.phase !== "playing" || !state.deadline || now < state.deadline) return false;
  const actor = currentPlayer(state);
  if (!state.pool.length) {
    state.turnEdited = false;
    state.consecutivePasses += 1;
    addLog(state, `${actor.name} 超时，牌池已空，记为无法出牌。`, now);
    if (state.consecutivePasses >= state.players.length) endGame(state, scoreBlockedGame(state, now), now);
    else finishTurn(state, now, { resetPasses: false });
    return true;
  }
  const penalty = state.turnEdited ? 3 : 1;
  const drawn = drawTiles(state, actor, penalty);
  addLog(state, `${actor.name} ${state.turnEdited ? "留下未完成草稿" : "尚未操作"}并超时，摸取${drawn.length}张罚牌。`, now);
  state.turnEdited = false;
  finishTurn(state, now);
  return true;
}

export function getDeadline(state) {
  return state.phase === "playing" ? Number(state.deadline) || 0 : 0;
}

function buildPublicView(state, { viewer = null, permissions } = {}) {
  const current = currentPlayer(state);
  return {
    selfId: viewer?.id || null,
    phase: state.phase,
    capacity: state.capacity,
    totalGames: state.totalGames,
    gameNumber: state.gameNumber,
    currentPlayerId: current?.id || null,
    startingPlayerId: state.startingPlayerId,
    poolCount: state.pool.length,
    deadline: state.deadline,
    turnId: state.turnId,
    turnEdited: state.turnEdited,
    consecutivePasses: state.consecutivePasses,
    table: state.table.map((meld) => ({
      id: meld.id,
      kind: meld.kind,
      tiles: meld.tiles.map((tile) => ({ ...tile })),
      assignments: meld.assignments.map((item) => ({ ...item }))
    })),
    lastChange: state.lastChange ? structuredClone(state.lastChange) : null,
    gameResult: state.gameResult ? structuredClone(state.gameResult) : null,
    logs: state.logs.map((entry) => ({ ...entry })),
    players: state.players.map((player) => ({
      id: player.id, name: player.name, isHost: player.isHost, connected: player.connected,
      handCount: player.hand.length, opened: player.opened, score: player.score, wins: player.wins
    })),
    hand: (viewer?.hand || []).map((tile) => ({ ...tile })),
    permissions
  };
}

export function buildView(state, viewerId) {
  const viewer = requireActor(state, viewerId);
  const current = currentPlayer(state);
  const myTurn = state.phase === "playing" && current?.id === viewer.id;
  return buildPublicView(state, {
    viewer,
    permissions: {
      canManage: viewer.isHost,
      canKick: viewer.isHost,
      canSetCapacity: viewer.isHost && state.phase === "lobby",
      canStart: viewer.isHost && state.phase === "lobby",
      canNextGame: viewer.isHost && state.phase === "gameEnd",
      canRestartMatch: viewer.isHost && state.phase === "matchEnd",
      canEnd: viewer.isHost && state.phase !== "lobby",
      canAct: myTurn,
      canDraw: myTurn && state.pool.length > 0,
      canPassEmpty: myTurn && state.pool.length === 0
    }
  });
}

export function buildSpectatorView(state) {
  return buildPublicView(state, {
    viewer: null,
    permissions: {
      canManage: false,
      canKick: false,
      canSetCapacity: false,
      canStart: false,
      canNextGame: false,
      canRestartMatch: false,
      canEnd: false,
      canAct: false,
      canDraw: false,
      canPassEmpty: false
    }
  });
}

export function validateState(state) {
  if (!state || !Array.isArray(state.players)) throw new Error("Invalid game15 state");
  if (state.phase === "lobby") return true;
  const tiles = [
    ...state.pool,
    ...state.table.flatMap((meld) => meld.tiles),
    ...state.players.flatMap((player) => player.hand)
  ];
  const ids = tiles.map((tile) => tile.id);
  if (tiles.length !== 106 || new Set(ids).size !== 106) throw new Error(`Tile conservation failed: ${tiles.length}/${new Set(ids).size}`);
  for (const meld of state.table) {
    const checked = validateMeld(meld);
    if (!checked.valid) throw new Error(`Invalid persisted meld: ${checked.error}`);
  }
  return true;
}

export function serializeState(state) {
  validateState(state);
  return structuredClone(state);
}

export function restoreState(serializedState) {
  if (serializedState?.stateVersion !== STATE_VERSION) throw new Error(`Unsupported game15 state version: ${serializedState?.stateVersion}`);
  const state = structuredClone(serializedState);
  validateState(state);
  return state;
}
