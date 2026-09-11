import {
  MASTER_ANSWERS, MAX_PLAYERS, MIN_PLAYERS, QUESTION_SECONDS, ROLE, SECRET_SECONDS,
  TIE_BREAK_SECONDS, VOTE_SECONDS, assertCapacity, assignRoles, chooseWord
} from "../rules.mjs";

export const STATE_VERSION = 1;
export const SUPPORTS_SPECTATORS = true;
export const ACTION_SECONDS = QUESTION_SECONDS;

const PHASES = new Set(["lobby", "secretReveal", "questioning", "discussion", "firstVote", "secondVote", "tieBreak", "roundEnd"]);
const clone = (value) => structuredClone(value);
const byId = (state, id) => state.players.find((player) => player.id === String(id)) || null;
const publicRole = (state, player) => state.phase === "roundEnd" || player.role === ROLE.MASTER ? player.role : null;

export class GameRuleError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "GameRuleError";
    this.code = code;
    this.status = status;
  }
}

function fail(condition, code, message, status = 400) {
  if (condition) throw new GameRuleError(code, message, status);
}

function checkedCapacity(value) {
  try { return assertCapacity(value); }
  catch { throw new GameRuleError("invalid_capacity", `人数必须为${MIN_PLAYERS}至${MAX_PLAYERS}人。`); }
}

function makePlayer({ id, name, isHost = false }) {
  fail(!id, "player_id_required", "缺少玩家身份。");
  return {
    id: String(id), name: String(name || "玩家").slice(0, 12), isHost: Boolean(isHost), connected: true,
    role: null, secretAcknowledged: false, readyToVote: false
  };
}

function requirePlayer(state, actorId) {
  const actor = byId(state, actorId);
  fail(!actor, "not_a_player", "你不在玩家席中。", 403);
  return actor;
}

function requireHost(state, actorId) {
  const actor = requirePlayer(state, actorId);
  fail(!actor.isHost, "host_required", "只有房主可以执行该操作。", 403);
  return actor;
}

function addLog(state, text, now) {
  state.logs.unshift({ id: ++state.logSequence, text, at: now });
  state.logs = state.logs.slice(0, 80);
}

function activeRoles(state) {
  return state.players.filter((player) => player.role);
}

function firstVoters(state) {
  return state.players.filter((player) => player.id !== state.guessedById);
}

function secondCandidates(state) {
  return state.players.filter((player) => player.id !== state.masterId && player.id !== state.guessedById);
}

function allSubmitted(players, votes) {
  return players.every((player) => Object.hasOwn(votes, player.id));
}

function beginQuestioning(state, now) {
  state.phase = "questioning";
  state.questionStartedAt = now;
  state.deadline = now + QUESTION_SECONDS * 1000;
  addLog(state, "身份确认完毕，开始限时猜词。", now);
}

function beginFirstVote(state, now) {
  state.phase = "firstVote";
  state.deadline = now + VOTE_SECONDS * 1000;
  state.firstVotes = {};
  state.players.forEach((player) => { player.readyToVote = false; });
  addLog(state, `开始审查猜中者 ${byId(state, state.guessedById)?.name || "玩家"}。`, now);
}

function finishRound(state, winnerSide, reason, now, accusedId = null) {
  state.phase = "roundEnd";
  state.deadline = 0;
  const winnerIds = winnerSide === "insider"
    ? [state.insiderId]
    : winnerSide === "common" ? state.players.filter((player) => player.id !== state.insiderId).map((player) => player.id) : [];
  state.result = {
    winnerSide, winnerIds, reason, accusedId, answer: state.word.text,
    masterId: state.masterId, insiderId: state.insiderId, guessedById: state.guessedById
  };
  if (winnerSide === "common") state.stats.commonWins += 1;
  else if (winnerSide === "insider") state.stats.insiderWins += 1;
  else state.stats.failedRounds += 1;
  const label = winnerSide === "common" ? "普通阵营获胜" : winnerSide === "insider" ? "局内人获胜" : "本轮全员失败";
  addLog(state, `${label}：${reason}`, now);
}

function resolveFirstVote(state, now) {
  const voters = firstVoters(state);
  const yesCount = voters.filter((player) => state.firstVotes[player.id] === true).length;
  const accused = yesCount > voters.length / 2;
  const guesserIsInsider = state.guessedById === state.insiderId;
  state.firstVoteResult = { votes: clone(state.firstVotes), yesCount, eligibleCount: voters.length, accused };
  if (accused) {
    if (guesserIsInsider) finishRound(state, "common", "多数玩家正确认出猜中者就是局内人。", now, state.guessedById);
    else finishRound(state, "insider", "多数玩家错误指控了一名普通猜中者。", now, state.guessedById);
    return;
  }
  if (guesserIsInsider) {
    finishRound(state, "insider", "局内人说出答案后成功避开了第一次指控。", now, state.guessedById);
    return;
  }
  state.phase = "secondVote";
  state.deadline = now + VOTE_SECONDS * 1000;
  state.secondVotes = {};
  addLog(state, "猜中者已被排除，开始寻找真正的局内人。", now);
}

function resolveAccusation(state, accusedId, now) {
  if (accusedId === state.insiderId) finishRound(state, "common", "最终指控命中了真正的局内人。", now, accusedId);
  else finishRound(state, "insider", "最终指控了错误的玩家。", now, accusedId);
}

function resolveSecondVote(state, now) {
  const candidates = secondCandidates(state);
  const counts = Object.fromEntries(candidates.map((player) => [player.id, 0]));
  for (const targetId of Object.values(state.secondVotes)) {
    if (Object.hasOwn(counts, targetId)) counts[targetId] += 1;
  }
  const maximum = Math.max(0, ...Object.values(counts));
  const leaders = candidates.filter((player) => counts[player.id] === maximum).map((player) => player.id);
  state.secondVoteResult = { votes: clone(state.secondVotes), counts: clone(counts), leaders: [...leaders], accusedId: leaders.length === 1 ? leaders[0] : null };
  if (leaders.length === 1) {
    resolveAccusation(state, leaders[0], now);
    return;
  }
  state.phase = "tieBreak";
  state.tieCandidates = leaders;
  state.deadline = now + TIE_BREAK_SECONDS * 1000;
  addLog(state, `最高票出现平票，由猜中者 ${byId(state, state.guessedById)?.name || "玩家"} 裁决。`, now);
}

function startRound(state, now, random) {
  const assignments = assignRoles(state.players.map((player) => player.id), random);
  for (const player of state.players) {
    player.role = assignments.get(player.id);
    player.secretAcknowledged = player.role === ROLE.COMMON;
    player.readyToVote = false;
  }
  state.round += 1;
  state.masterId = state.players.find((player) => player.role === ROLE.MASTER).id;
  state.insiderId = state.players.find((player) => player.role === ROLE.INSIDER).id;
  state.word = clone(chooseWord(state.recentWordIds, random));
  state.recentWordIds.push(state.word.id);
  state.recentWordIds = state.recentWordIds.slice(-30);
  state.phase = "secretReveal";
  state.deadline = now + SECRET_SECONDS * 1000;
  state.questionStartedAt = 0;
  state.guessElapsedMs = 0;
  state.guessedById = null;
  state.answerHistory = [];
  state.answerSequence = 0;
  state.firstVotes = {};
  state.secondVotes = {};
  state.firstVoteResult = null;
  state.secondVoteResult = null;
  state.tieCandidates = [];
  state.result = null;
  addLog(state, `第${state.round}轮身份已经分配，主持人为 ${byId(state, state.masterId).name}。`, now);
}

function resetToLobby(state) {
  state.phase = "lobby";
  state.deadline = 0;
  state.round = 0;
  state.masterId = null;
  state.insiderId = null;
  state.word = null;
  state.questionStartedAt = 0;
  state.guessElapsedMs = 0;
  state.guessedById = null;
  state.answerHistory = [];
  state.firstVotes = {};
  state.secondVotes = {};
  state.firstVoteResult = null;
  state.secondVoteResult = null;
  state.tieCandidates = [];
  state.result = null;
  state.stats = { commonWins: 0, insiderWins: 0, failedRounds: 0 };
  state.players.forEach((player) => Object.assign(player, { role: null, secretAcknowledged: false, readyToVote: false }));
}

export function createLobby({ capacity, host }) {
  return {
    stateVersion: STATE_VERSION, capacity: checkedCapacity(capacity), phase: "lobby", deadline: 0, round: 0,
    players: [makePlayer({ ...host, isHost: true })], masterId: null, insiderId: null, word: null, recentWordIds: [],
    questionStartedAt: 0, guessElapsedMs: 0, guessedById: null, answerHistory: [], answerSequence: 0,
    firstVotes: {}, secondVotes: {}, firstVoteResult: null, secondVoteResult: null, tieCandidates: [], result: null,
    stats: { commonWins: 0, insiderWins: 0, failedRounds: 0 }, logs: [], logSequence: 0
  };
}

export function addPlayer(state, player) {
  fail(state.phase !== "lobby", "game_started", "本轮已经开始，只能进入旁观席。", 409);
  fail(state.players.length >= state.capacity, "room_full", "玩家席已满。", 409);
  fail(byId(state, player.id), "duplicate_player", "该玩家已在房间中。", 409);
  const joined = makePlayer(player);
  state.players.push(joined);
  return joined;
}

export function removePlayer(state, actorId, playerId) {
  requireHost(state, actorId);
  fail(state.phase !== "lobby", "cannot_remove_active_player", "开局后不能移除正式玩家。", 409);
  const target = byId(state, playerId);
  fail(!target || target.isHost, "invalid_remove_target", "不能移除该玩家。");
  state.players.splice(state.players.indexOf(target), 1);
}

export function canChangeSeats(state) { return state.phase === "lobby"; }

export function vacateSeat(state, playerId) {
  fail(!canChangeSeats(state), "seat_change_unavailable", "游戏开始后不能转入旁观席。", 409);
  const player = byId(state, playerId);
  fail(!player, "not_a_player", "你不在玩家席中。", 403);
  fail(player.isHost, "host_cannot_spectate", "房主不能进入旁观席。", 409);
  state.players.splice(state.players.indexOf(player), 1);
  return player;
}

export function setPresence(state, playerId, connected) {
  const player = byId(state, playerId);
  if (player) player.connected = Boolean(connected);
  return player;
}

export function applyAction(state, actorId, action, { now = Date.now(), random = Math.random } = {}) {
  const actor = requirePlayer(state, actorId);
  const type = String(action?.type || "");

  if (type === "setCapacity") {
    requireHost(state, actorId);
    fail(state.phase !== "lobby", "capacity_locked", "开局后不能修改人数。", 409);
    const capacity = checkedCapacity(action.capacity);
    fail(capacity < state.players.length, "capacity_too_small", "人数不能少于已入座玩家。", 409);
    state.capacity = capacity;
    return;
  }
  if (type === "start") {
    requireHost(state, actorId);
    fail(state.phase !== "lobby", "already_started", "本轮已经开始。", 409);
    fail(state.players.length !== state.capacity, "room_not_full", `需要${state.capacity}名玩家才能开始。`, 409);
    fail(state.players.some((player) => !player.connected), "players_offline", "所有正式玩家在线后才能开始。", 409);
    startRound(state, now, random);
    return;
  }
  if (type === "nextRound") {
    requireHost(state, actorId);
    fail(state.phase !== "roundEnd", "next_round_unavailable", "当前不能开始下一轮。", 409);
    fail(state.players.some((player) => !player.connected), "players_offline", "所有正式玩家在线后才能开始下一轮。", 409);
    startRound(state, now, random);
    return;
  }
  if (type === "end") {
    requireHost(state, actorId);
    fail(state.phase === "lobby", "game_not_started", "当前没有进行中的游戏。", 409);
    resetToLobby(state);
    return;
  }

  if (type === "acknowledgeSecret") {
    fail(state.phase !== "secretReveal", "wrong_phase", "当前不在身份确认阶段。", 409);
    fail(![ROLE.MASTER, ROLE.INSIDER].includes(actor.role), "secret_not_required", "你的身份不需要秘密确认。", 403);
    fail(actor.secretAcknowledged, "already_acknowledged", "你已经确认过了。", 409);
    actor.secretAcknowledged = true;
    if (activeRoles(state).filter((player) => [ROLE.MASTER, ROLE.INSIDER].includes(player.role)).every((player) => player.secretAcknowledged)) beginQuestioning(state, now);
    return;
  }
  if (type === "showMasterAnswer") {
    fail(state.phase !== "questioning", "wrong_phase", "当前不在猜词阶段。", 409);
    fail(actor.id !== state.masterId, "master_required", "只有主持人可以同步回答。", 403);
    fail(!MASTER_ANSWERS.includes(action.answer), "invalid_answer", "回答必须是“是”“不是”或“不知道”。");
    state.answerHistory.unshift({ id: ++state.answerSequence, answer: action.answer, at: now });
    state.answerHistory = state.answerHistory.slice(0, 12);
    return;
  }
  if (type === "markCorrectGuesser") {
    fail(state.phase !== "questioning", "wrong_phase", "当前不在猜词阶段。", 409);
    fail(actor.id !== state.masterId, "master_required", "只有主持人可以确认猜中者。", 403);
    const guesser = byId(state, action.playerId);
    fail(!guesser || guesser.id === state.masterId, "invalid_guesser", "请选择一名非主持人玩家。", 409);
    state.guessedById = guesser.id;
    state.guessElapsedMs = Math.max(0, Math.min(QUESTION_SECONDS * 1000, now - state.questionStartedAt));
    state.phase = "discussion";
    state.deadline = now + state.guessElapsedMs;
    state.players.forEach((player) => { player.readyToVote = false; });
    addLog(state, `${guesser.name} 说出了正确答案，开始寻找局内人。`, now);
    return;
  }
  if (type === "readyToVote") {
    fail(state.phase !== "discussion", "wrong_phase", "当前不在讨论阶段。", 409);
    fail(actor.readyToVote, "already_ready", "你已经准备投票。", 409);
    actor.readyToVote = true;
    const online = state.players.filter((player) => player.connected);
    if (online.length && online.every((player) => player.readyToVote)) beginFirstVote(state, now);
    return;
  }
  if (type === "submitFirstVote") {
    fail(state.phase !== "firstVote", "wrong_phase", "当前不在第一次投票。", 409);
    fail(actor.id === state.guessedById, "guesser_cannot_vote", "猜中者不能参与第一次投票。", 403);
    fail(Object.hasOwn(state.firstVotes, actor.id), "already_voted", "你已经提交投票。", 409);
    fail(typeof action.accuse !== "boolean", "invalid_vote", "请选择是否指控猜中者。");
    state.firstVotes[actor.id] = action.accuse;
    if (allSubmitted(firstVoters(state), state.firstVotes)) resolveFirstVote(state, now);
    return;
  }
  if (type === "submitSecondVote") {
    fail(state.phase !== "secondVote", "wrong_phase", "当前不在第二次投票。", 409);
    fail(Object.hasOwn(state.secondVotes, actor.id), "already_voted", "你已经提交投票。", 409);
    const target = byId(state, action.targetId);
    fail(!target || !secondCandidates(state).some((player) => player.id === target.id), "invalid_vote_target", "该玩家不能成为本次候选人。", 409);
    state.secondVotes[actor.id] = target.id;
    if (allSubmitted(state.players, state.secondVotes)) resolveSecondVote(state, now);
    return;
  }
  if (type === "resolveTie") {
    fail(state.phase !== "tieBreak", "wrong_phase", "当前不在平票裁决阶段。", 409);
    fail(actor.id !== state.guessedById, "guesser_required", "只有猜中者可以裁决平票。", 403);
    fail(!state.tieCandidates.includes(String(action.targetId)), "invalid_tie_target", "请选择一名平票候选人。", 409);
    state.secondVoteResult.accusedId = String(action.targetId);
    resolveAccusation(state, String(action.targetId), now);
    return;
  }
  throw new GameRuleError("unknown_action", "无法识别这个操作。");
}

export function handleTimeout(state, { now = Date.now(), random = Math.random } = {}) {
  if (!state.deadline || now < state.deadline) return false;
  if (state.phase === "secretReveal") {
    state.players.forEach((player) => { if ([ROLE.MASTER, ROLE.INSIDER].includes(player.role)) player.secretAcknowledged = true; });
    beginQuestioning(state, now);
  } else if (state.phase === "questioning") {
    finishRound(state, null, "5分钟内没有人猜出正确答案。", now);
  } else if (state.phase === "discussion") {
    beginFirstVote(state, now);
  } else if (state.phase === "firstVote") {
    resolveFirstVote(state, now);
  } else if (state.phase === "secondVote") {
    resolveSecondVote(state, now);
  } else if (state.phase === "tieBreak") {
    const index = Math.min(state.tieCandidates.length - 1, Math.max(0, Math.floor(Number(random()) * state.tieCandidates.length)));
    const targetId = state.tieCandidates[index];
    state.secondVoteResult.accusedId = targetId;
    resolveAccusation(state, targetId, now);
  } else return false;
  return true;
}

export function getDeadline(state) { return Number(state.deadline) || 0; }

function permissionsFor(state, viewer) {
  const isHost = Boolean(viewer?.isHost);
  const firstEligible = Boolean(viewer && state.phase === "firstVote" && viewer.id !== state.guessedById);
  return {
    canManage: isHost,
    canSetCapacity: isHost && state.phase === "lobby",
    canStart: isHost && state.phase === "lobby",
    canNextRound: isHost && state.phase === "roundEnd",
    canEnd: isHost && state.phase !== "lobby",
    canAcknowledgeSecret: state.phase === "secretReveal" && [ROLE.MASTER, ROLE.INSIDER].includes(viewer?.role) && !viewer.secretAcknowledged,
    canShowMasterAnswer: state.phase === "questioning" && viewer?.id === state.masterId,
    canMarkCorrectGuesser: state.phase === "questioning" && viewer?.id === state.masterId,
    canReadyToVote: state.phase === "discussion" && viewer && !viewer.readyToVote,
    canFirstVote: firstEligible && !Object.hasOwn(state.firstVotes, viewer.id),
    canSecondVote: state.phase === "secondVote" && viewer && !Object.hasOwn(state.secondVotes, viewer.id),
    canResolveTie: state.phase === "tieBreak" && viewer?.id === state.guessedById
  };
}

function buildPublicView(state, viewer) {
  const revealAll = state.phase === "roundEnd";
  const mayKnowWord = revealAll || viewer?.id === state.masterId || viewer?.id === state.insiderId;
  return {
    stateVersion: state.stateVersion,
    phase: state.phase,
    capacity: state.capacity,
    round: state.round,
    deadline: state.deadline,
    selfId: viewer?.id || null,
    masterId: state.masterId,
    guessedById: state.guessedById,
    guessElapsedMs: state.guessElapsedMs,
    privateRole: viewer?.role || null,
    secretWord: mayKnowWord ? clone(state.word) : null,
    secretAcknowledged: Boolean(viewer?.secretAcknowledged),
    secretConfirmedCount: state.phase === "secretReveal"
      ? state.players.filter((player) => [ROLE.MASTER, ROLE.INSIDER].includes(player.role) && player.secretAcknowledged).length : 0,
    answerHistory: clone(state.answerHistory),
    readyIds: state.players.filter((player) => player.readyToVote).map((player) => player.id),
    submittedFirstVoteIds: Object.keys(state.firstVotes),
    submittedSecondVoteIds: Object.keys(state.secondVotes),
    myFirstVote: viewer && Object.hasOwn(state.firstVotes, viewer.id) ? state.firstVotes[viewer.id] : null,
    mySecondVote: viewer && Object.hasOwn(state.secondVotes, viewer.id) ? state.secondVotes[viewer.id] : null,
    firstVoteResult: state.phase !== "firstVote" ? clone(state.firstVoteResult) : null,
    secondVoteResult: ["tieBreak", "roundEnd"].includes(state.phase) ? clone(state.secondVoteResult) : null,
    tieCandidates: state.phase === "tieBreak" ? [...state.tieCandidates] : [],
    result: clone(state.result),
    stats: clone(state.stats),
    logs: clone(state.logs),
    players: state.players.map((player) => ({
      id: player.id, name: player.name, isHost: player.isHost, connected: player.connected,
      isMaster: player.id === state.masterId, isGuesser: player.id === state.guessedById,
      role: publicRole(state, player)
    })),
    permissions: permissionsFor(state, viewer)
  };
}

export function buildView(state, viewerId) { return buildPublicView(state, requirePlayer(state, viewerId)); }
export function buildSpectatorView(state) { return buildPublicView(state, null); }

export function validateState(state) {
  if (!state || state.stateVersion !== STATE_VERSION) throw new Error("Invalid game20 state version");
  if (!PHASES.has(state.phase)) throw new Error("Invalid game20 phase");
  if (!Number.isInteger(state.capacity) || state.capacity < MIN_PLAYERS || state.capacity > MAX_PLAYERS) throw new Error("Invalid game20 capacity");
  if (!Array.isArray(state.players) || state.players.length > state.capacity || !state.players.length) throw new Error("Invalid game20 players");
  if (new Set(state.players.map((player) => player.id)).size !== state.players.length) throw new Error("Duplicate game20 player id");
  if (state.players.filter((player) => player.isHost).length !== 1) throw new Error("Invalid game20 host");
  if (state.phase !== "lobby") {
    if (!byId(state, state.masterId) || !byId(state, state.insiderId) || state.masterId === state.insiderId) throw new Error("Invalid game20 secret roles");
    if (state.players.filter((player) => player.role === ROLE.MASTER).length !== 1 || state.players.filter((player) => player.role === ROLE.INSIDER).length !== 1) throw new Error("Invalid game20 role allocation");
    if (!state.word?.id || !state.word?.text) throw new Error("Invalid game20 word");
  }
  if (["discussion", "firstVote", "secondVote", "tieBreak", "roundEnd"].includes(state.phase) && state.result == null && !byId(state, state.guessedById)) throw new Error("Invalid game20 guesser");
  if (state.phase === "tieBreak" && (!state.tieCandidates.length || state.tieCandidates.some((id) => !secondCandidates(state).some((player) => player.id === id)))) throw new Error("Invalid game20 tie candidates");
  return true;
}

export function serializeState(state) { validateState(state); return clone(state); }

export function restoreState(serializedState) {
  if (serializedState?.stateVersion !== STATE_VERSION) throw new Error(`Unsupported game20 state version: ${serializedState?.stateVersion}`);
  const state = clone(serializedState);
  validateState(state);
  return state;
}
