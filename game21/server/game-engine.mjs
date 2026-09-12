import {
  LOCATIONS, MATCH_ROUNDS, MAX_PLAYERS, MIN_PLAYERS, NOMINATION_SECONDS, ROLE,
  ROUND_SECONDS, SECRET_SECONDS, VOTE_SECONDS, assertCapacity, chooseLocation, dealRound, findLocation
} from "../rules.mjs";
import { appendPresentationEvent, normalizePresentationState, validatePresentationState } from "../../shared/server/presentation-events.mjs";

export const STATE_VERSION = 1;
export const SUPPORTS_SPECTATORS = true;
export const ACTION_SECONDS = ROUND_SECONDS;

const PHASES = new Set(["lobby", "secretReveal", "questioning", "accusationVote", "timeoutNomination", "timeoutVote", "roundEnd"]);
const clone = (value) => structuredClone(value);
const byId = (state, id) => state.players.find((player) => player.id === String(id)) || null;

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
    score: 0, role: null, locationRole: null, secretAcknowledged: false, accusationUsed: false
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
  state.logs = state.logs.slice(0, 100);
}

const PRESENTATION_PRIORITY = {
  "vote-submitted": 1,
  "question-ready": 2,
  question: 2,
  "answer-complete": 2,
  "vote-rejected": 3,
  "nomination-ready": 3,
  "nomination-next": 3,
  accusation: 4,
  nomination: 4,
  "location-reveal": 4,
  "round-result": 4
};

function decoratePresentation(state, event) {
  let sceneId = event.sceneId || state.activePresentationScene;
  if (!sceneId) {
    state.presentationSceneSequence = Number.isInteger(state.presentationSceneSequence) ? state.presentationSceneSequence + 1 : 1;
    sceneId = `spyfall_scene_${state.presentationSceneSequence}`;
  } else if (sceneId === state.activePresentationScene && Number.isInteger(state.activePresentationSceneNumber)) {
    state.presentationSceneSequence = Math.max(Number(state.presentationSceneSequence) || 0, state.activePresentationSceneNumber);
  }
  const priority = Number.isFinite(Number(event.priority)) ? Number(event.priority) : PRESENTATION_PRIORITY[event.kind] ?? 2;
  return { ...event, sceneId, priority };
}

function runPresentationScene(state, callback) {
  const previous = state.activePresentationScene;
  const previousNumber = state.activePresentationSceneNumber;
  const sceneNumber = (Number.isInteger(state.presentationSceneSequence) ? state.presentationSceneSequence : 0) + 1;
  state.activePresentationScene = `spyfall_scene_${sceneNumber}`;
  state.activePresentationSceneNumber = sceneNumber;
  try { return callback(); }
  finally {
    if (previous) {
      state.activePresentationScene = previous;
      state.activePresentationSceneNumber = previousNumber;
    } else {
      delete state.activePresentationScene;
      delete state.activePresentationSceneNumber;
    }
  }
}

function addPresentation(state, event, now) {
  return appendPresentationEvent(state, decoratePresentation(state, event), {
    now,
    eventsKey: "presentationEvents",
    sequenceKey: "presentationSequence",
    idPrefix: "spyfall_event",
    limit: 40
  });
}

function orderedFrom(state, playerId) {
  const index = Math.max(0, state.players.findIndex((player) => player.id === playerId));
  return [...state.players.slice(index), ...state.players.slice(0, index)].map((player) => player.id);
}

function votersExcept(state, targetId) {
  return state.players.filter((player) => player.id !== targetId);
}

function allSubmitted(players, votes) {
  return players.every((player) => Object.hasOwn(votes, player.id));
}

function addScores(state, winnerSide, bonusKind, accuserId) {
  const delta = Object.fromEntries(state.players.map((player) => [player.id, 0]));
  if (winnerSide === "operatives") {
    state.players.filter((player) => player.role === ROLE.OPERATIVE).forEach((player) => { delta[player.id] += 1; });
    if (bonusKind === "earlyCatch" && delta[accuserId] != null) delta[accuserId] += 1;
  } else {
    delta[state.spyId] += 2;
    if (["correctGuess", "wrongAccusation"].includes(bonusKind)) delta[state.spyId] += 2;
  }
  state.players.forEach((player) => { player.score += delta[player.id]; });
  return delta;
}

function finishRound(state, winnerSide, reason, now, { bonusKind = null, accuserId = null, accusedId = null, guessedLocationId = null } = {}) {
  const scoreDelta = addScores(state, winnerSide, bonusKind, accuserId);
  state.phase = "roundEnd";
  state.deadline = 0;
  state.nextDealerId = state.spyId;
  state.matchComplete = state.round >= MATCH_ROUNDS;
  state.result = {
    winnerSide, reason, bonusKind, accuserId, accusedId, guessedLocationId,
    location: clone(state.location), spyId: state.spyId, scoreDelta,
    winners: state.matchComplete ? state.players.filter((player) => player.score === Math.max(...state.players.map((item) => item.score))).map((player) => player.id) : []
  };
  addLog(state, `${winnerSide === "spy" ? "间谍" : "普通特工"}获胜：${reason}`, now);
  addPresentation(state, {
    kind: guessedLocationId ? "location-reveal" : "round-result",
    actorId: guessedLocationId ? state.spyId : accuserId,
    targetId: accusedId,
    text: guessedLocationId
      ? `${byId(state, state.spyId)?.name || "间谍"} 猜测“${findLocation(guessedLocationId)?.name || "未知地点"}”——${reason}`
      : `${winnerSide === "spy" ? "间谍" : "普通特工"}获胜：${reason}`,
    result: winnerSide
  }, now);
}

function startQuestioning(state, now) {
  state.phase = "questioning";
  state.deadline = now + ROUND_SECONDS * 1000;
  addLog(state, `第${state.round}轮问答开始，${byId(state, state.questionerId)?.name || "玩家"}首先提问。`, now);
  addPresentation(state, {
    kind: "question-ready", actorId: state.questionerId,
    text: `${byId(state, state.questionerId)?.name || "玩家"} 获得首个提问权`
  }, now);
}

function startRound(state, now, random) {
  const locationData = chooseLocation(state.recentLocationIds, random);
  const assignments = dealRound(state.players.map((player) => player.id), locationData, random);
  state.round += 1;
  state.location = clone(locationData);
  state.spyId = state.players.find((player) => assignments.get(player.id).role === ROLE.SPY).id;
  state.dealerId = byId(state, state.nextDealerId)?.id || state.players[Math.min(state.players.length - 1, Math.max(0, Math.floor(Number(random()) * state.players.length)))].id;
  state.questionerId = state.dealerId;
  state.questionTargetId = null;
  state.blockedTargetId = null;
  state.savedQuestion = null;
  state.roundRemainingMs = 0;
  state.accusation = null;
  state.accusationVotes = {};
  state.nominationOrder = [];
  state.nominationIndex = 0;
  state.nomination = null;
  state.timeoutVotes = {};
  state.matchComplete = false;
  state.result = null;
  state.recentLocationIds.push(locationData.id);
  state.recentLocationIds = state.recentLocationIds.slice(-12);
  for (const player of state.players) {
    const assignment = assignments.get(player.id);
    player.role = assignment.role;
    player.locationRole = assignment.locationRole;
    player.secretAcknowledged = false;
    player.accusationUsed = false;
  }
  state.phase = "secretReveal";
  state.deadline = now + SECRET_SECONDS * 1000;
  addLog(state, `第${state.round}/${MATCH_ROUNDS}轮秘密身份已经发放。`, now);
}

function resetToLobby(state) {
  state.phase = "lobby";
  state.deadline = 0;
  state.round = 0;
  state.location = null;
  state.spyId = null;
  state.dealerId = null;
  state.nextDealerId = null;
  state.questionerId = null;
  state.questionTargetId = null;
  state.blockedTargetId = null;
  state.savedQuestion = null;
  state.accusation = null;
  state.accusationVotes = {};
  state.nominationOrder = [];
  state.nominationIndex = 0;
  state.nomination = null;
  state.timeoutVotes = {};
  state.result = null;
  state.matchComplete = false;
  state.recentLocationIds = [];
  state.players.forEach((player) => Object.assign(player, {
    score: 0, role: null, locationRole: null, secretAcknowledged: false, accusationUsed: false
  }));
}

function resumeQuestioning(state, now, message) {
  const saved = state.savedQuestion || {};
  state.phase = "questioning";
  state.questionerId = saved.questionerId || state.questionerId;
  state.questionTargetId = saved.questionTargetId || null;
  state.blockedTargetId = saved.blockedTargetId || null;
  state.deadline = now + Math.max(1000, Number(state.roundRemainingMs) || 1000);
  state.savedQuestion = null;
  state.roundRemainingMs = 0;
  state.accusation = null;
  state.accusationVotes = {};
  addLog(state, message, now);
}

function resolveAccusationFailure(state, now) {
  const accusation = state.accusation;
  addPresentation(state, {
    kind: "vote-rejected",
    actorId: accusation?.accuserId || null,
    targetId: accusation?.targetId || null,
    text: "指认未获全票，问答继续"
  }, now);
  resumeQuestioning(state, now, "指认未获全票支持，恢复问答。");
}

function beginTimeoutNomination(state, now) {
  state.phase = "timeoutNomination";
  state.deadline = now + NOMINATION_SECONDS * 1000;
  state.nominationOrder = orderedFrom(state, state.dealerId);
  state.nominationIndex = 0;
  state.nomination = null;
  state.timeoutVotes = {};
  state.questionTargetId = null;
  addLog(state, "问答时间结束，开始依次提名间谍嫌疑人。", now);
  addPresentation(state, {
    kind: "nomination-ready", actorId: currentNominatorId(state),
    text: `问答时间结束，${byId(state, currentNominatorId(state))?.name || "玩家"} 获得提名权`
  }, now);
}

function advanceNomination(state, now, message = "本次提名未获全票支持。") {
  const previous = state.nomination;
  state.nominationIndex += 1;
  state.nomination = null;
  state.timeoutVotes = {};
  if (state.nominationIndex >= state.nominationOrder.length) {
    finishRound(state, "spy", "所有玩家均未能形成一致指认。", now);
    return;
  }
  state.phase = "timeoutNomination";
  state.deadline = now + NOMINATION_SECONDS * 1000;
  addLog(state, `${message} 轮到 ${byId(state, state.nominationOrder[state.nominationIndex])?.name || "下一名玩家"} 提名。`, now);
  addPresentation(state, {
    kind: "nomination-next",
    actorId: previous?.nominatorId || null,
    targetId: currentNominatorId(state),
    text: `${message} ${byId(state, currentNominatorId(state))?.name || "下一名玩家"} 接过提名权`
  }, now);
}

function currentNominatorId(state) {
  return state.nominationOrder[state.nominationIndex] || null;
}

export function createLobby({ capacity, host }) {
  return {
    stateVersion: STATE_VERSION, capacity: checkedCapacity(capacity), phase: "lobby", deadline: 0,
    round: 0, matchRounds: MATCH_ROUNDS, matchComplete: false,
    players: [makePlayer({ ...host, isHost: true })], location: null, spyId: null, dealerId: null, nextDealerId: null,
    questionerId: null, questionTargetId: null, blockedTargetId: null, savedQuestion: null, roundRemainingMs: 0,
    accusation: null, accusationVotes: {}, nominationOrder: [], nominationIndex: 0, nomination: null, timeoutVotes: {},
    recentLocationIds: [], result: null, logs: [], logSequence: 0,
    presentationEvents: [], presentationSequence: 0, presentationSceneSequence: 0
  };
}

export function addPlayer(state, player) {
  fail(state.phase !== "lobby", "game_started", "比赛已经开始，只能进入旁观席。", 409);
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
  fail(!canChangeSeats(state), "seat_change_unavailable", "比赛开始后不能转入旁观席。", 409);
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

function applyActionInternal(state, actorId, action, { now = Date.now(), random = Math.random } = {}) {
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
    fail(state.phase !== "lobby", "already_started", "比赛已经开始。", 409);
    fail(state.players.length !== state.capacity, "room_not_full", `需要${state.capacity}名玩家才能开始。`, 409);
    fail(state.players.some((player) => !player.connected), "players_offline", "所有正式玩家在线后才能开始。", 409);
    startRound(state, now, random);
    return;
  }
  if (type === "nextRound") {
    requireHost(state, actorId);
    fail(state.phase !== "roundEnd" || state.matchComplete, "next_round_unavailable", "当前不能开始下一轮。", 409);
    fail(state.players.some((player) => !player.connected), "players_offline", "所有正式玩家在线后才能开始下一轮。", 409);
    startRound(state, now, random);
    return;
  }
  if (type === "end") {
    requireHost(state, actorId);
    fail(state.phase === "lobby", "game_not_started", "当前没有进行中的比赛。", 409);
    resetToLobby(state);
    return;
  }
  if (type === "acknowledgeSecret") {
    fail(state.phase !== "secretReveal", "wrong_phase", "当前不在身份确认阶段。", 409);
    fail(actor.secretAcknowledged, "already_acknowledged", "你已经确认过身份。", 409);
    actor.secretAcknowledged = true;
    if (state.players.every((player) => player.secretAcknowledged)) startQuestioning(state, now);
    return;
  }
  if (type === "selectQuestionTarget") {
    fail(state.phase !== "questioning", "wrong_phase", "当前不在正常问答阶段。", 409);
    fail(state.questionTargetId, "question_in_progress", "当前问题尚未回答完成。", 409);
    fail(actor.id !== state.questionerId, "questioner_required", "现在不是你提问。", 403);
    const target = byId(state, action.targetId);
    fail(!target || target.id === actor.id || target.id === state.blockedTargetId, "invalid_question_target", "不能选择这名玩家作为当前提问对象。", 409);
    state.questionTargetId = target.id;
    addLog(state, `${actor.name} 正在询问 ${target.name}。`, now);
    addPresentation(state, {
      kind: "question", actorId: actor.id, targetId: target.id,
      text: `${actor.name} 向 ${target.name} 发起提问`
    }, now);
    return;
  }
  if (type === "completeAnswer") {
    fail(state.phase !== "questioning", "wrong_phase", "当前不在正常问答阶段。", 409);
    fail(actor.id !== state.questionTargetId, "respondent_required", "只有当前回答者可以确认回答完成。", 403);
    const previousQuestionerId = state.questionerId;
    state.questionerId = actor.id;
    state.questionTargetId = null;
    state.blockedTargetId = previousQuestionerId;
    addLog(state, `${actor.name} 已回答，现在由其选择下一位玩家。`, now);
    addPresentation(state, {
      kind: "answer-complete", actorId: previousQuestionerId, targetId: actor.id,
      text: `${actor.name} 完成回答并接过提问权`
    }, now);
    return;
  }
  if (type === "accuse") {
    fail(state.phase !== "questioning", "wrong_phase", "当前不能发起指认。", 409);
    fail(actor.accusationUsed, "accusation_used", "你本轮已经使用过主动指认机会。", 409);
    const target = byId(state, action.targetId);
    fail(!target || target.id === actor.id, "invalid_accusation_target", "请选择另一名玩家。", 409);
    actor.accusationUsed = true;
    state.savedQuestion = { questionerId: state.questionerId, questionTargetId: state.questionTargetId, blockedTargetId: state.blockedTargetId };
    state.roundRemainingMs = Math.max(1000, state.deadline - now);
    state.phase = "accusationVote";
    state.accusation = { accuserId: actor.id, targetId: target.id };
    state.accusationVotes = { [actor.id]: true };
    state.deadline = now + VOTE_SECONDS * 1000;
    addLog(state, `${actor.name} 指认 ${target.name} 是间谍，等待全票表决。`, now);
    addPresentation(state, {
      kind: "accusation", actorId: actor.id, targetId: target.id,
      text: `${actor.name} 指认 ${target.name} 是间谍`
    }, now);
    return;
  }
  if (type === "voteAccusation") {
    fail(state.phase !== "accusationVote", "wrong_phase", "当前不在指认表决阶段。", 409);
    fail(actor.id === state.accusation.targetId, "target_cannot_vote", "被指认者不能参与本次表决。", 403);
    fail(Object.hasOwn(state.accusationVotes, actor.id), "already_voted", "你已经提交表决。", 409);
    fail(typeof action.agree !== "boolean", "invalid_vote", "请选择赞成或反对。");
    state.accusationVotes[actor.id] = action.agree;
    if (action.agree) addPresentation(state, {
      kind: "vote-submitted", actorId: actor.id, targetId: state.accusation.targetId,
      text: `${actor.name} 已提交秘密表决`
    }, now);
    if (!action.agree) {
      resolveAccusationFailure(state, now);
    } else if (allSubmitted(votersExcept(state, state.accusation.targetId), state.accusationVotes)) {
      const { targetId, accuserId } = state.accusation;
      if (targetId === state.spyId) finishRound(state, "operatives", "全票指认出了真正的间谍。", now, { bonusKind: "earlyCatch", accuserId, accusedId: targetId });
      else finishRound(state, "spy", "普通玩家全票指认了一名无辜者。", now, { bonusKind: "wrongAccusation", accusedId: targetId });
    }
    return;
  }
  if (type === "spyGuess") {
    fail(state.phase !== "questioning", "wrong_phase", "只有正常问答期间可以猜测地点。", 409);
    fail(actor.id !== state.spyId, "spy_required", "只有间谍可以猜测地点。", 403);
    const guessed = findLocation(action.locationId);
    fail(!guessed, "invalid_location", "请选择地点列表中的地点。");
    if (guessed.id === state.location.id) finishRound(state, "spy", `间谍正确猜出地点“${guessed.name}”。`, now, { bonusKind: "correctGuess", guessedLocationId: guessed.id });
    else finishRound(state, "operatives", `间谍错误猜测了“${guessed.name}”。`, now, { guessedLocationId: guessed.id });
    return;
  }
  if (type === "nominate" || type === "skipNomination") {
    fail(state.phase !== "timeoutNomination", "wrong_phase", "当前不在超时提名阶段。", 409);
    fail(actor.id !== currentNominatorId(state), "nominator_required", "现在不是你提名。", 403);
    if (type === "skipNomination") {
      advanceNomination(state, now, `${actor.name} 放弃提名。`);
      return;
    }
    const target = byId(state, action.targetId);
    fail(!target || target.id === actor.id, "invalid_nomination_target", "请选择另一名玩家。", 409);
    state.phase = "timeoutVote";
    state.nomination = { nominatorId: actor.id, targetId: target.id };
    state.timeoutVotes = { [actor.id]: true };
    state.deadline = now + VOTE_SECONDS * 1000;
    addLog(state, `${actor.name} 提名 ${target.name}，等待全票表决。`, now);
    addPresentation(state, {
      kind: "nomination", actorId: actor.id, targetId: target.id,
      text: `${actor.name} 提名 ${target.name} 接受最终表决`
    }, now);
    return;
  }
  if (type === "voteTimeoutNomination") {
    fail(state.phase !== "timeoutVote", "wrong_phase", "当前不在最终表决阶段。", 409);
    fail(actor.id === state.nomination.targetId, "target_cannot_vote", "被提名者不能参与本次表决。", 403);
    fail(Object.hasOwn(state.timeoutVotes, actor.id), "already_voted", "你已经提交表决。", 409);
    fail(typeof action.agree !== "boolean", "invalid_vote", "请选择赞成或反对。");
    state.timeoutVotes[actor.id] = action.agree;
    if (action.agree) addPresentation(state, {
      kind: "vote-submitted", actorId: actor.id, targetId: state.nomination.targetId,
      text: `${actor.name} 已提交秘密表决`
    }, now);
    if (!action.agree) {
      advanceNomination(state, now);
    } else if (allSubmitted(votersExcept(state, state.nomination.targetId), state.timeoutVotes)) {
      const targetId = state.nomination.targetId;
      if (targetId === state.spyId) finishRound(state, "operatives", "超时提名全票抓到了间谍。", now, { accusedId: targetId });
      else finishRound(state, "spy", "超时提名全票指认了一名无辜者。", now, { bonusKind: "wrongAccusation", accusedId: targetId });
    }
    return;
  }
  throw new GameRuleError("unknown_action", "无法识别这个操作。");
}

export function applyAction(state, actorId, action, { now = Date.now(), random = Math.random } = {}) {
  return runPresentationScene(state, () => applyActionInternal(state, actorId, action, { now, random }));
}

export function handleTimeout(state, { now = Date.now() } = {}) {
  if (!state.deadline || now < state.deadline) return false;
  return runPresentationScene(state, () => {
    if (state.phase === "secretReveal") {
      state.players.forEach((player) => { player.secretAcknowledged = true; });
      startQuestioning(state, now);
    } else if (state.phase === "questioning") {
      beginTimeoutNomination(state, now);
    } else if (state.phase === "accusationVote") {
      resolveAccusationFailure(state, now);
    } else if (state.phase === "timeoutNomination") {
      advanceNomination(state, now, `${byId(state, currentNominatorId(state))?.name || "当前玩家"} 提名超时。`);
    } else if (state.phase === "timeoutVote") {
      advanceNomination(state, now, "最终表决未获全票支持。");
    } else return false;
    return true;
  });
}

export function getDeadline(state) { return Number(state.deadline) || 0; }

function permissionsFor(state, viewer) {
  const isHost = Boolean(viewer?.isHost);
  const canVoteAccusation = Boolean(viewer && state.phase === "accusationVote" && viewer.id !== state.accusation?.targetId && !Object.hasOwn(state.accusationVotes, viewer.id));
  const canVoteTimeout = Boolean(viewer && state.phase === "timeoutVote" && viewer.id !== state.nomination?.targetId && !Object.hasOwn(state.timeoutVotes, viewer.id));
  return {
    canManage: isHost,
    canSetCapacity: isHost && state.phase === "lobby",
    canStart: isHost && state.phase === "lobby",
    canNextRound: isHost && state.phase === "roundEnd" && !state.matchComplete,
    canEnd: isHost && state.phase !== "lobby",
    canAcknowledgeSecret: state.phase === "secretReveal" && viewer && !viewer.secretAcknowledged,
    canSelectQuestionTarget: state.phase === "questioning" && viewer?.id === state.questionerId && !state.questionTargetId,
    canCompleteAnswer: state.phase === "questioning" && viewer?.id === state.questionTargetId,
    canAccuse: state.phase === "questioning" && viewer && !viewer.accusationUsed,
    canVoteAccusation,
    canSpyGuess: state.phase === "questioning" && viewer?.id === state.spyId,
    canNominate: state.phase === "timeoutNomination" && viewer?.id === currentNominatorId(state),
    canVoteTimeout
  };
}

function buildPublicView(state, viewer) {
  const reveal = state.phase === "roundEnd";
  const privateLocation = viewer?.role === ROLE.OPERATIVE || reveal
    ? state.location ? { id: state.location.id, name: state.location.name } : null
    : null;
  return {
    stateVersion: state.stateVersion,
    phase: state.phase,
    capacity: state.capacity,
    round: state.round,
    matchRounds: state.matchRounds,
    matchComplete: state.matchComplete,
    deadline: state.deadline,
    selfId: viewer?.id || null,
    dealerId: state.dealerId,
    questionerId: state.questionerId,
    questionTargetId: state.questionTargetId,
    blockedTargetId: viewer?.id === state.questionerId ? state.blockedTargetId : null,
    privateRole: viewer?.role || null,
    privateLocation,
    privateLocationRole: viewer?.locationRole || null,
    locations: LOCATIONS.map(({ id, name }) => ({ id, name })),
    accusation: state.accusation ? clone(state.accusation) : null,
    submittedAccusationVoteIds: Object.keys(state.accusationVotes),
    myAccusationVote: viewer && Object.hasOwn(state.accusationVotes, viewer.id) ? state.accusationVotes[viewer.id] : null,
    currentNominatorId: currentNominatorId(state),
    nominationIndex: state.nominationIndex,
    nominationCount: state.nominationOrder.length,
    nomination: state.nomination ? clone(state.nomination) : null,
    submittedTimeoutVoteIds: Object.keys(state.timeoutVotes),
    myTimeoutVote: viewer && Object.hasOwn(state.timeoutVotes, viewer.id) ? state.timeoutVotes[viewer.id] : null,
    secretConfirmedCount: state.players.filter((player) => player.secretAcknowledged).length,
    players: state.players.map((player) => ({
      id: player.id, name: player.name, isHost: player.isHost, connected: player.connected, score: player.score,
      accusationUsed: player.accusationUsed,
      role: reveal ? player.role : null,
      locationRole: reveal ? player.locationRole : null
    })),
    result: state.result ? clone(state.result) : null,
    logs: clone(state.logs),
    presentationEvents: clone(state.presentationEvents),
    permissions: permissionsFor(state, viewer)
  };
}

export function buildView(state, viewerId) {
  return buildPublicView(state, byId(state, viewerId));
}

export function buildSpectatorView(state) {
  const view = buildPublicView(state, null);
  view.privateRole = null;
  view.privateLocation = state.phase === "roundEnd" && state.location ? { id: state.location.id, name: state.location.name } : null;
  view.privateLocationRole = null;
  return view;
}

export function validateState(state) {
  fail(!state || state.stateVersion !== STATE_VERSION, "invalid_state_version", "无法恢复不兼容的房间状态。");
  checkedCapacity(state.capacity);
  fail(!PHASES.has(state.phase), "invalid_phase", "房间阶段无效。");
  fail(!Array.isArray(state.players) || state.players.length < 1 || state.players.length > state.capacity, "invalid_players", "玩家数据无效。");
  fail(new Set(state.players.map((player) => player.id)).size !== state.players.length, "duplicate_players", "玩家身份重复。");
  fail(state.players.filter((player) => player.isHost).length !== 1, "invalid_host", "房间必须有且只有一名房主。");
  fail(!Number.isInteger(state.presentationSceneSequence) || state.presentationSceneSequence < 0, "invalid_presentation_scene", "演出场景序号无效。");
  if (state.phase !== "lobby") {
    fail(!state.location || !findLocation(state.location.id), "invalid_location", "当前地点无效。");
    fail(state.players.filter((player) => player.role === ROLE.SPY).length !== 1, "invalid_spy", "间谍身份数据无效。");
    fail(state.players.some((player) => ![ROLE.SPY, ROLE.OPERATIVE].includes(player.role)), "invalid_roles", "玩家身份数据无效。");
  }
  try { validatePresentationState(state); }
  catch { throw new Error("Invalid game21 presentation events"); }
  return true;
}

export function serializeState(state) {
  validateState(state);
  return clone(state);
}

export function restoreState(serializedState) {
  const state = clone(serializedState);
  state.presentationSceneSequence = Number.isInteger(state.presentationSceneSequence) && state.presentationSceneSequence >= 0 ? state.presentationSceneSequence : 0;
  normalizePresentationState(state);
  validateState(state);
  return state;
}
