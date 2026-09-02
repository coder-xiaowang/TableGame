import {
  createCodeDeck,
  isValidCode,
  lastEligiblePlayer,
  lockGuessDrafts,
  normalizeClue,
  otherTeam,
  outcomeForTeams,
  scoreTransmission,
  validateClues
} from "../rules.js";
import { KEYWORDS } from "../words.js";

export const ACTION_SECONDS = 150;
export const CLUE_SECONDS = 150;
export const GUESS_SECONDS = 100;
export const REVEAL_SECONDS = 8;
export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 8;
export const STATE_VERSION = 1;
export const SUPPORTS_SPECTATORS = true;

const TEAMS = ["white", "black"];

export class GameRuleError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "GameRuleError";
    this.code = code;
    this.status = status;
  }
}

function cleanName(value, fallback = "译码员") {
  return String(value ?? "").trim().slice(0, 12) || fallback;
}

function assertCapacity(capacity) {
  const value = Number(capacity);
  if (!Number.isInteger(value) || value < MIN_PLAYERS || value > MAX_PLAYERS) {
    throw new GameRuleError("invalid_capacity", "游戏人数必须为 4–8 人。");
  }
  return value;
}

function shuffle(items, random) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [items[index], items[target]] = [items[target], items[index]];
  }
  return items;
}

function makeTeam() {
  return {
    keywords: [],
    interceptions: 0,
    miscommunications: 0,
    codeDeck: [],
    encryptorCursor: 0
  };
}

function makePlayer({ id, name, isHost = false, connected = false }) {
  if (!id) throw new GameRuleError("player_id_required", "缺少玩家身份。");
  return {
    id: String(id),
    name: cleanName(name, isHost ? "情报主管" : "译码员"),
    isHost: Boolean(isHost),
    connected: Boolean(connected),
    team: null,
    seat: 0,
    usedClues: []
  };
}

function requireHost(state, actorId) {
  const actor = state.players.find((player) => player.id === String(actorId));
  if (!actor?.isHost) throw new GameRuleError("host_required", "只有房主可以执行此操作。", 403);
  return actor;
}

function sortedTeam(state, team) {
  return state.players
    .filter((player) => player.team === team)
    .sort((a, b) => a.seat - b.seat);
}

function normalizeSeats(state, team) {
  if (!TEAMS.includes(team)) return;
  sortedTeam(state, team).forEach((player, index) => { player.seat = index + 1; });
}

function submitterFor(state, team, encryptorId = "") {
  return lastEligiblePlayer(sortedTeam(state, team), team, encryptorId);
}

function guessRoleFor(state, playerId) {
  if (state.phase !== "guess") return null;
  const decodeBy = submitterFor(state, state.turnTeam, state.encryptorId);
  if (decodeBy?.id === String(playerId)) return "decode";
  const interceptBy = submitterFor(state, otherTeam(state.turnTeam));
  if (state.round > 1 && interceptBy?.id === String(playerId)) return "intercept";
  return null;
}

function beginDeadline(state, seconds, now) {
  state.deadline = now + seconds * 1000;
}

function drawCode(state, team) {
  const deck = state.teams[team].codeDeck;
  if (!deck.length) throw new Error(`game11 ${team} code deck exhausted unexpectedly`);
  return deck.pop();
}

function beginTransmission(state, team, now) {
  state.turnTeam = team;
  state.phase = "clue";
  state.clues = [];
  state.guesses = { decode: null, intercept: null };
  state.guessDrafts = { decode: null, intercept: null };
  state.code = drawCode(state, team);
  const members = sortedTeam(state, team);
  const teamState = state.teams[team];
  state.encryptorId = members[teamState.encryptorCursor % members.length].id;
  teamState.encryptorCursor += 1;
  beginDeadline(state, CLUE_SECONDS, now);
}

function finishGame(state, winners, tiebreakScores = null) {
  state.phase = "ended";
  state.deadline = 0;
  state.outcome = {
    winners: [...winners],
    tiebreakScores: tiebreakScores ? { ...tiebreakScores } : null
  };
}

function beginTiebreak(state, now) {
  state.phase = "tiebreak";
  state.tiebreakGuesses = { white: null, black: null };
  beginDeadline(state, GUESS_SECONDS, now);
}

function resolveTiebreak(state) {
  const scores = {};
  for (const team of TEAMS) {
    const target = state.teams[otherTeam(team)].keywords;
    const guess = state.tiebreakGuesses[team] || [];
    scores[team] = target.filter((word, index) => normalizeClue(word) === normalizeClue(guess[index])).length;
  }
  if (scores.white === scores.black) finishGame(state, TEAMS, scores);
  else finishGame(state, [scores.white > scores.black ? "white" : "black"], scores);
}

function resolveTransmission(state, now) {
  state.guesses = lockGuessDrafts(state.guesses, state.guessDrafts);
  const team = state.turnTeam;
  const opponent = otherTeam(team);
  const result = scoreTransmission({
    code: state.code,
    decodeGuess: state.guesses.decode,
    interceptGuess: state.guesses.intercept,
    allowIntercept: state.round > 1
  });
  if (result.intercepted) state.teams[opponent].interceptions += 1;
  if (result.miscommunicated) state.teams[team].miscommunications += 1;
  state.records.push({
    round: state.round,
    team,
    encryptorId: state.encryptorId,
    clues: [...state.clues],
    code: [...state.code],
    decodeGuess: state.guesses.decode ? [...state.guesses.decode] : null,
    interceptGuess: state.guesses.intercept ? [...state.guesses.intercept] : null,
    ...result
  });
  state.phase = "reveal";
  beginDeadline(state, REVEAL_SECONDS, now);
}

function advanceAfterReveal(state, now) {
  if (state.turnTeam === "white") {
    beginTransmission(state, "black", now);
    return;
  }
  const outcome = outcomeForTeams(state.teams, state.round);
  if (outcome?.needsKeywordGuess) {
    beginTiebreak(state, now);
    return;
  }
  if (outcome) {
    finishGame(state, outcome.winners);
    return;
  }
  state.round += 1;
  beginTransmission(state, "white", now);
}

function resetToLobby(state) {
  state.phase = "lobby";
  state.teams = { white: makeTeam(), black: makeTeam() };
  state.round = 0;
  state.turnTeam = "white";
  state.encryptorId = "";
  state.code = null;
  state.clues = [];
  state.guesses = { decode: null, intercept: null };
  state.guessDrafts = { decode: null, intercept: null };
  state.deadline = 0;
  state.records = [];
  state.outcome = null;
  state.tiebreakGuesses = { white: null, black: null };
  for (const player of state.players) player.usedClues = [];
}

export function createLobby({ capacity, host }) {
  return {
    stateVersion: STATE_VERSION,
    phase: "lobby",
    capacity: assertCapacity(capacity),
    players: [makePlayer({ ...host, isHost: true })],
    teams: { white: makeTeam(), black: makeTeam() },
    round: 0,
    turnTeam: "white",
    encryptorId: "",
    code: null,
    clues: [],
    guesses: { decode: null, intercept: null },
    guessDrafts: { decode: null, intercept: null },
    deadline: 0,
    records: [],
    outcome: null,
    tiebreakGuesses: { white: null, black: null }
  };
}

export function addPlayer(state, player) {
  if (state.phase !== "lobby") throw new GameRuleError("game_started", "行动已经开始，不能中途加入。", 409);
  if (state.players.length >= state.capacity) throw new GameRuleError("room_full", "房间人数已满。", 409);
  if (state.players.some((item) => item.id === String(player.id))) {
    throw new GameRuleError("player_exists", "该玩家已经在房间中。", 409);
  }
  const next = makePlayer(player);
  state.players.push(next);
  return next;
}

export function removePlayer(state, actorId, playerId) {
  requireHost(state, actorId);
  if (state.phase !== "lobby") throw new GameRuleError("game_started", "行动开始后不能移出玩家。", 409);
  const index = state.players.findIndex((player) => player.id === String(playerId));
  const target = state.players[index];
  if (!target || target.isHost) throw new GameRuleError("invalid_kick_target", "无法移出该玩家。");
  state.players.splice(index, 1);
  normalizeSeats(state, target.team);
  return target;
}

export function canChangeSeats(state) {
  return state.phase === "lobby";
}

export function vacateSeat(state, playerId) {
  if (!canChangeSeats(state)) {
    throw new GameRuleError("seat_change_unavailable", "行动开始后不能转入旁观席。", 409);
  }
  const index = state.players.findIndex((player) => player.id === String(playerId));
  const target = state.players[index];
  if (!target || target.isHost) {
    throw new GameRuleError("invalid_seat_target", "该成员不能转入旁观席。", 403);
  }
  state.players.splice(index, 1);
  normalizeSeats(state, target.team);
  return target;
}

export function setPresence(state, playerId, connected) {
  const player = state.players.find((item) => item.id === String(playerId));
  if (!player || player.connected === Boolean(connected)) return false;
  player.connected = Boolean(connected);
  return true;
}

export function applyAction(state, actorId, action, { now = Date.now(), random = Math.random } = {}) {
  const id = String(actorId);
  const actor = state.players.find((player) => player.id === id);
  if (!actor) throw new GameRuleError("not_a_player", "你不属于这个行动室。", 403);
  const type = action?.type;

  if (type === "sit") {
    if (state.phase !== "lobby") throw new GameRuleError("game_started", "行动开始后不能调整队伍。", 409);
    const team = action.team == null ? null : String(action.team);
    if (team !== null && !TEAMS.includes(team)) throw new GameRuleError("invalid_team", "队伍选择无效。");
    const oldTeam = actor.team;
    actor.team = team;
    actor.seat = team
      ? Math.max(0, ...sortedTeam(state, team).filter((player) => player.id !== id).map((player) => player.seat)) + 1
      : 0;
    normalizeSeats(state, oldTeam);
    normalizeSeats(state, team);
    return;
  }

  if (type === "move") {
    if (state.phase !== "lobby") throw new GameRuleError("game_started", "行动开始后不能调整座位。", 409);
    const direction = Number(action.direction);
    if (![-1, 1].includes(direction) || !actor.team) throw new GameRuleError("invalid_move", "座位调整无效。");
    const list = sortedTeam(state, actor.team);
    const index = list.findIndex((player) => player.id === id);
    const target = list[index + direction];
    if (!target) throw new GameRuleError("invalid_move", "已经无法继续向该方向移动。");
    [actor.seat, target.seat] = [target.seat, actor.seat];
    return;
  }

  if (type === "start") {
    requireHost(state, id);
    if (state.phase !== "lobby") throw new GameRuleError("already_started", "行动已经开始。", 409);
    const white = sortedTeam(state, "white");
    const black = sortedTeam(state, "black");
    if (state.players.length !== state.capacity) throw new GameRuleError("players_missing", `需要 ${state.capacity} 位玩家到齐。`, 409);
    if (state.players.some((player) => !player.connected || !player.team) || white.length < 2 || black.length < 2) {
      throw new GameRuleError("teams_not_ready", "需要所有玩家在线入座，且每队至少有 2 人。", 409);
    }
    const words = shuffle([...KEYWORDS], random);
    state.teams.white = { ...makeTeam(), keywords: words.splice(0, 4), codeDeck: shuffle(createCodeDeck(), random) };
    state.teams.black = { ...makeTeam(), keywords: words.splice(0, 4), codeDeck: shuffle(createCodeDeck(), random) };
    state.players.forEach((player) => { player.usedClues = []; });
    state.round = 1;
    state.records = [];
    state.outcome = null;
    state.tiebreakGuesses = { white: null, black: null };
    beginTransmission(state, "white", now);
    return;
  }

  if (type === "end") {
    requireHost(state, id);
    if (state.phase === "lobby") throw new GameRuleError("game_not_started", "行动尚未开始。", 409);
    resetToLobby(state);
    return;
  }

  if (type === "clues") {
    if (state.phase !== "clue" || state.encryptorId !== id) {
      throw new GameRuleError("not_encryptor", "只有当前传讯者可以提交提示。", 409);
    }
    const error = validateClues(action.clues, state.teams[actor.team].keywords, actor.usedClues);
    if (error) throw new GameRuleError("invalid_clues", error, 409);
    state.clues = action.clues.map((clue) => String(clue).trim());
    actor.usedClues.push(...state.clues);
    state.phase = "guess";
    beginDeadline(state, GUESS_SECONDS, now);
    return;
  }

  if (type === "guessDraft") {
    const role = guessRoleFor(state, id);
    const code = Array.isArray(action.code) ? action.code.map(Number) : [];
    if (!role) throw new GameRuleError("not_guess_submitter", "你不是本次猜码提交者。", 403);
    if (state.guesses[role]) throw new GameRuleError("guess_locked", "该猜测已经锁定。", 409);
    if (!isValidCode(code)) throw new GameRuleError("invalid_code", "三位密码必须由不重复的 1–4 组成。", 409);
    state.guessDrafts[role] = code;
    return;
  }

  if (type === "guess") {
    const role = guessRoleFor(state, id);
    const code = Array.isArray(action.code) ? action.code.map(Number) : [];
    if (!role) throw new GameRuleError("not_guess_submitter", "你不是本次猜码提交者。", 403);
    if (state.guesses[role]) throw new GameRuleError("guess_locked", "该猜测已经锁定。", 409);
    if (!isValidCode(code)) throw new GameRuleError("invalid_code", "三位密码必须由不重复的 1–4 组成。", 409);
    state.guesses[role] = code;
    if (state.guesses.decode && (state.round === 1 || state.guesses.intercept)) resolveTransmission(state, now);
    return;
  }

  if (type === "tiebreak") {
    if (state.phase !== "tiebreak" || !actor.team) throw new GameRuleError("not_tiebreak", "当前不在最终裁决阶段。", 409);
    const submitter = submitterFor(state, actor.team);
    if (submitter?.id !== id) throw new GameRuleError("not_tiebreak_submitter", "你不是本队最终裁决提交者。", 403);
    if (state.tiebreakGuesses[actor.team]) throw new GameRuleError("tiebreak_locked", "本队答案已经锁定。", 409);
    const words = Array.isArray(action.words) ? action.words.map((word) => String(word).trim()).slice(0, 4) : [];
    state.tiebreakGuesses[actor.team] = words;
    if (state.tiebreakGuesses.white && state.tiebreakGuesses.black) resolveTiebreak(state);
    return;
  }

  throw new GameRuleError("unknown_action", "无法识别该游戏操作。");
}

export function handleTimeout(state, { now = Date.now() } = {}) {
  if (!state.deadline || now < state.deadline) return false;
  if (state.phase === "clue") {
    state.clues = ["提示超时一", "提示超时二", "提示超时三"];
    state.phase = "guess";
    beginDeadline(state, GUESS_SECONDS, now);
    return true;
  }
  if (state.phase === "guess") {
    resolveTransmission(state, now);
    return true;
  }
  if (state.phase === "reveal") {
    advanceAfterReveal(state, now);
    return true;
  }
  if (state.phase === "tiebreak") {
    resolveTiebreak(state);
    return true;
  }
  return false;
}

export function getDeadline(state) {
  return ["clue", "guess", "reveal", "tiebreak"].includes(state.phase) ? state.deadline : 0;
}

function cloneRecord(record) {
  return {
    ...record,
    clues: [...record.clues],
    code: [...record.code],
    decodeGuess: record.decodeGuess ? [...record.decodeGuess] : null,
    interceptGuess: record.interceptGuess ? [...record.interceptGuess] : null
  };
}

function buildPublicView(state, viewer = null) {
  const ended = state.phase === "ended";
  const reveal = state.phase === "reveal";
  const guessRole = viewer ? guessRoleFor(state, viewer.id) : null;
  const ownDraft = guessRole && state.guessDrafts[guessRole] ? [...state.guessDrafts[guessRole]] : null;
  const tiebreakSubmitter = viewer?.team ? submitterFor(state, viewer.team) : null;
  const teams = {};
  for (const team of TEAMS) {
    teams[team] = {
      interceptions: state.teams[team].interceptions,
      miscommunications: state.teams[team].miscommunications,
      keywords: ended || viewer?.team === team ? [...state.teams[team].keywords] : []
    };
  }
  return {
    selfId: viewer?.id || null,
    phase: state.phase,
    capacity: state.capacity,
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      isHost: player.isHost,
      connected: player.connected,
      team: player.team,
      seat: player.seat,
      ...(player.id === viewer?.id ? { usedClues: [...player.usedClues] } : {})
    })),
    teams,
    round: state.round,
    turnTeam: state.turnTeam,
    encryptorId: state.encryptorId,
    code: (((viewer?.id === state.encryptorId) && state.phase === "clue") || reveal) && state.code
      ? [...state.code]
      : null,
    clues: [...state.clues],
    guessStatus: {
      decode: Boolean(state.guesses.decode),
      intercept: Boolean(state.guesses.intercept)
    },
    guessDraft: ownDraft,
    deadline: state.deadline,
    records: state.records.map(cloneRecord),
    outcome: state.outcome ? structuredClone(state.outcome) : null,
    tiebreakStatus: {
      white: Boolean(state.tiebreakGuesses.white),
      black: Boolean(state.tiebreakGuesses.black)
    },
    permissions: viewer ? {
      canManage: viewer.isHost,
      canKick: viewer.isHost && state.phase === "lobby",
      canStart: viewer.isHost && state.phase === "lobby",
      canEnd: viewer.isHost && state.phase !== "lobby",
      canSit: state.phase === "lobby",
      canMove: state.phase === "lobby" && Boolean(viewer.team),
      canSubmitClues: state.phase === "clue" && state.encryptorId === viewer.id,
      guessRole,
      canSubmitTiebreak: state.phase === "tiebreak"
        && tiebreakSubmitter?.id === viewer.id
        && !state.tiebreakGuesses[viewer.team]
    } : {
      canManage: false,
      canKick: false,
      canStart: false,
      canEnd: false,
      canSit: false,
      canMove: false,
      canSubmitClues: false,
      guessRole: null,
      canSubmitTiebreak: false
    }
  };
}

export function buildView(state, viewerId) {
  const viewer = state.players.find((player) => player.id === String(viewerId));
  if (!viewer) throw new GameRuleError("not_a_player", "你不属于这个行动室。", 403);
  return buildPublicView(state, viewer);
}

export function buildSpectatorView(state) {
  return buildPublicView(state);
}

export function serializeState(state) {
  return structuredClone(state);
}

export function restoreState(serializedState) {
  if (serializedState?.stateVersion !== STATE_VERSION) {
    throw new Error(`Unsupported game11 state version: ${serializedState?.stateVersion}`);
  }
  return structuredClone(serializedState);
}
