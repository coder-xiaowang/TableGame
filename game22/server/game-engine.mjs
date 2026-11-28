import {
  ALIGNMENT, EXTENSION_VOTE_SECONDS, MAX_PLAYERS, MIN_PLAYERS, PACE, PRESET,
  PROPOSAL_EXTENSION_SECONDS, PROPOSAL_EXTENSION_WINDOW_SECONDS, ROLE,
  alignmentOf, assertCapacity, assertPace, assertPreset, dealRoles, failsRequired,
  normalizeTimers, questSize, shuffle
} from "../rules.mjs";
import { appendPresentationEvent, normalizePresentationState, validatePresentationState } from "../../shared/server/presentation-events.mjs";

export const STATE_VERSION = 1;
export const SUPPORTS_SPECTATORS = true;
export const SIMULTANEOUS_ACTIONS = new Set(["acknowledgeSecret", "voteDiscussionExtension", "submitTeamVote", "submitQuestCard"]);
export const ACTION_SECONDS = normalizeTimers(PACE.STANDARD).teamProposal;
const PHASES = new Set(["lobby", "secretReveal", "teamProposal", "teamVote", "questAction", "questReveal", "ladyInspect", "assassination", "assassinationReveal", "ended"]);
const QUEST_SEAL_MS = 1000, QUEST_CARD_MS = 650, QUEST_VERDICT_MS = 1400;
const ASSASSINATION_APPROACH_MS = 1800, ASSASSINATION_STRIKE_MS = 900, ASSASSINATION_VERDICT_MS = 1800;
const clone = (value) => structuredClone(value);
const byId = (state, id) => state.players.find((player) => player.id === String(id)) || null;

export class GameRuleError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = "GameRuleError"; this.code = code; this.status = status; }
}
function fail(condition, code, message, status = 400) { if (condition) throw new GameRuleError(code, message, status); }
function playerName(state, id) { return byId(state, id)?.name || "玩家"; }
function requirePlayer(state, id) { const player = byId(state, id); fail(!player, "not_a_player", "你不在玩家席中。", 403); return player; }
function requireHost(state, id) { const player = requirePlayer(state, id); fail(!player.isHost, "host_required", "只有房主可以执行该操作。", 403); return player; }
function addLog(state, text, now) { state.logs.unshift({ id: ++state.logSequence, text, at: now }); state.logs = state.logs.slice(0, 100); }
function scene(state) { state.presentationSceneSequence += 1; return `avalon_scene_${state.presentationSceneSequence}`; }
function present(state, kind, text, now, details = {}, sceneId = null) {
  return appendPresentationEvent(state, { kind, text, priority: 2, sceneId: sceneId || scene(state), ...details }, { now, idPrefix: "avalon_event", limit: 70 });
}
function nextPlayerId(state, id) { const index = state.players.findIndex((player) => player.id === id); return state.players[(index + 1) % state.players.length].id; }
function randomChoice(values, random) { return values[Math.min(values.length - 1, Math.floor(random() * values.length))]; }
function checkedCapacity(value) { try { return assertCapacity(value); } catch { throw new GameRuleError("invalid_capacity", `人数必须为${MIN_PLAYERS}至${MAX_PLAYERS}人。`); } }
function checkedPreset(value) { try { return assertPreset(value); } catch { throw new GameRuleError("invalid_preset", "角色预设无效。"); } }
function checkedPace(value) { try { return assertPace(value); } catch { throw new GameRuleError("invalid_pace", "节奏预设无效。"); } }
function checkedTimers(pace, values) { try { return normalizeTimers(pace, values); } catch { throw new GameRuleError("invalid_timers", "自定义时长无效，请检查各阶段允许的秒数范围。"); } }
function setDeadline(state, seconds, now) { state.deadlineDurationSeconds = seconds; state.deadline = now + seconds * 1000; }
function setDeadlineMs(state, milliseconds, now) { state.deadlineDurationSeconds = milliseconds / 1000; state.deadline = now + milliseconds; }
function clearDeadline(state) { state.deadline = 0; state.deadlineDurationSeconds = 0; }

function normalizeTimingState(state) {
  let pace;
  try { pace = assertPace(state.paceMode); } catch { pace = PACE.STANDARD; }
  try { state.timers = normalizeTimers(pace, state.timers); } catch { pace = PACE.STANDARD; state.timers = normalizeTimers(pace); }
  state.paceMode = pace;
  state.deadlineDurationSeconds = Number.isFinite(state.deadlineDurationSeconds) ? Math.max(0, Number(state.deadlineDurationSeconds)) : 0;
  if (state.deadline && !state.deadlineDurationSeconds) state.deadlineDurationSeconds = Number(state.timers[state.phase]) || 30;
  if (!state.proposalExtension || typeof state.proposalExtension !== "object") state.proposalExtension = { used: false, requested: false, granted: false, votes: {}, originalDeadline: 0 };
  state.proposalExtension.used = Boolean(state.proposalExtension.used);
  state.proposalExtension.requested = Boolean(state.proposalExtension.requested);
  state.proposalExtension.granted = Boolean(state.proposalExtension.granted);
  state.proposalExtension.votes = state.proposalExtension.votes && typeof state.proposalExtension.votes === "object" ? state.proposalExtension.votes : {};
  state.proposalExtension.originalDeadline = Number(state.proposalExtension.originalDeadline) || 0;
}

function makePlayer({ id, name, isHost = false }) {
  fail(!id, "player_id_required", "缺少玩家身份。");
  return { id: String(id), name: String(name || "玩家").slice(0, 12), isHost: Boolean(isHost), connected: true, role: null, secretAcknowledged: false };
}

function resetMatchState(state) {
  Object.assign(state, {
    phase: "lobby", deadline: 0, deadlineDurationSeconds: 0, matchNumber: state.matchNumber || 0, questIndex: 0,
    leaderId: null, startingLeaderId: null, proposalNumber: 1, proposedTeam: [], teamVotes: {},
    lastTeamVoteResult: null, questCards: {}, questResults: [], goodQuests: 0, evilQuests: 0,
    ladyHolderId: null, ladyHistory: [], ladyFindings: [], assassinId: null, merlinId: null,
    result: null, pendingCeremony: null, presentationEvents: [],
    proposalExtension: { used: false, requested: false, granted: false, votes: {}, originalDeadline: 0 }
  });
  state.players.forEach((player) => { player.role = null; player.secretAcknowledged = false; });
}

function beginProposal(state, now) {
  state.phase = "teamProposal";
  setDeadline(state, state.timers.teamProposal, now);
  state.proposalExtension = { used: false, requested: false, granted: false, votes: {}, originalDeadline: 0 };
  state.proposedTeam = [];
  state.teamVotes = {};
  state.questCards = {};
  addLog(state, `第${state.questIndex + 1}次远征：${playerName(state, state.leaderId)}成为队长。`, now);
  present(state, "leader-turn", `${playerName(state, state.leaderId)}开始组建远征队伍`, now, { priority: 2, actorId: state.leaderId, questNumber: state.questIndex + 1 });
}

function extensionMajority(state) { return Math.floor(state.players.length / 2) + 1; }
function resolveExtensionVote(state, now, timedOut = false) {
  const extension = state.proposalExtension;
  if (!extension.requested) return;
  const yes = Object.values(extension.votes).filter(Boolean).length;
  const no = Object.values(extension.votes).filter((vote) => vote === false).length;
  const required = extensionMajority(state);
  const remaining = state.players.length - yes - no;
  if (yes >= required) {
    extension.requested = false; extension.used = true; extension.granted = true;
    setDeadline(state, PROPOSAL_EXTENSION_SECONDS, now);
    addLog(state, `延长讨论获${yes}票支持，本次组队增加${PROPOSAL_EXTENSION_SECONDS}秒。`, now);
    present(state, "discussion-extension-granted", `圆桌同意延长讨论 ${PROPOSAL_EXTENSION_SECONDS} 秒`, now, { priority: 4, yes, required });
    return;
  }
  if (timedOut || yes + remaining < required || yes + no === state.players.length) {
    extension.requested = false; extension.used = true; extension.granted = false;
    const remainingOriginal = Math.max(0, extension.originalDeadline - now);
    const seconds = Math.max(5, Math.ceil(remainingOriginal / 1000));
    setDeadline(state, seconds, now);
    addLog(state, `延长讨论未获多数支持（${yes}/${required}）。`, now);
    present(state, "discussion-extension-rejected", "圆桌未同意延长讨论", now, { priority: 3, yes, required });
  }
}

function requestExtension(state, actorId, now) {
  fail(state.phase !== "teamProposal", "wrong_phase", "只有组队讨论阶段可以申请延长。", 409);
  const extension = state.proposalExtension;
  fail(extension.used || extension.requested, "extension_already_used", "本次组队已经使用过延长讨论申请。", 409);
  const remaining = state.deadline - now;
  fail(remaining <= 0 || remaining > PROPOSAL_EXTENSION_WINDOW_SECONDS * 1000, "extension_not_available", `仅可在组队倒计时最后${PROPOSAL_EXTENSION_WINDOW_SECONDS}秒申请延长。`, 409);
  extension.requested = true; extension.used = true; extension.granted = false;
  extension.votes = { [actorId]: true }; extension.originalDeadline = state.deadline;
  setDeadline(state, EXTENSION_VOTE_SECONDS, now);
  addLog(state, `${playerName(state, actorId)}申请延长本次组队讨论。`, now);
  present(state, "discussion-extension-requested", `${playerName(state, actorId)}申请延长讨论`, now, { priority: 4, actorId });
}

function finishGame(state, winner, reason, now, extra = {}, sceneId = null) {
  const { ceremony: presentationCeremony = null, ...resultExtra } = extra;
  state.phase = "ended"; clearDeadline(state);
  state.result = { winner, reason, ...resultExtra };
  state.stats[winner === ALIGNMENT.GOOD ? "goodWins" : "evilWins"] += 1;
  addLog(state, `${winner === ALIGNMENT.GOOD ? "正义" : "邪恶"}阵营获胜：${reason}`, now);
  present(state, "game-result", `${winner === ALIGNMENT.GOOD ? "正义" : "邪恶"}阵营获胜`, now,
    { priority: 5, winner, reason, ...resultExtra, ...(presentationCeremony ? { ceremony: presentationCeremony } : {}) }, sceneId);
}

function submitTeam(state, actorId, memberIds, now, automatic = false) {
  fail(state.phase !== "teamProposal", "wrong_phase", "现在不能提交远征队伍。", 409);
  fail(actorId !== state.leaderId, "leader_required", "只有当前队长可以提交队伍。", 403);
  const ids = [...new Set((memberIds || []).map(String))];
  const required = questSize(state.capacity, state.questIndex);
  fail(ids.length !== required, "invalid_team_size", `本次远征必须选择${required}人。`);
  fail(ids.some((id) => !byId(state, id)), "invalid_team_member", "队伍中包含无效玩家。");
  state.proposedTeam = ids; state.teamVotes = {}; state.phase = "teamVote"; setDeadline(state, state.timers.teamVote, now);
  const sid = scene(state);
  addLog(state, `${playerName(state, actorId)}提议由${ids.map((id) => playerName(state, id)).join("、")}执行远征。`, now);
  present(state, "team-proposed", `${playerName(state, actorId)}提交了远征队伍`, now, { priority: 3, actorId, targetIds: ids, automatic }, sid);
}

function resolveTeamVote(state, now) {
  const yes = state.players.filter((player) => state.teamVotes[player.id] === true).length;
  const approved = yes > state.players.length / 2;
  state.lastTeamVoteResult = { votes: clone(state.teamVotes), yes, no: state.players.length - yes, approved };
  const sid = scene(state);
  present(state, "team-vote-result", `组队投票${approved ? "通过" : "被否决"}（${yes}/${state.players.length}同意）`, now, { priority: 4, approved, yes, targetIds: state.proposedTeam }, sid);
  if (approved) {
    state.phase = "questAction"; setDeadline(state, state.timers.questAction, now); state.questCards = {};
    addLog(state, `组队以${yes}票同意通过，远征队员秘密提交任务牌。`, now);
    return;
  }
  addLog(state, `组队仅获${yes}票同意，第${state.proposalNumber}次提案被否决。`, now);
  if (state.proposalNumber >= 5) return finishGame(state, ALIGNMENT.EVIL, "同一任务连续五次组队被否决。", now, {}, sid);
  state.proposalNumber += 1;
  state.leaderId = nextPlayerId(state, state.leaderId);
  beginProposal(state, now);
}

function ladyTargets(state) {
  const held = new Set(state.ladyHistory);
  return state.players.filter((player) => player.id !== state.ladyHolderId && !held.has(player.id));
}

function continueAfterQuest(state, now) {
  state.proposalNumber = 1;
  state.leaderId = nextPlayerId(state, state.leaderId);
  beginProposal(state, now);
}

function beginQuestReveal(state, now, random) {
  const cards = shuffle(Object.values(state.questCards), random);
  const failCount = cards.filter((card) => card === "fail").length;
  const required = failsRequired(state.capacity, state.questIndex);
  const success = failCount < required;
  state.phase = "questReveal";
  state.pendingCeremony = { id: `quest_${state.matchNumber}_${state.questIndex + 1}`, kind: "quest", stage: "sealed", questIndex: state.questIndex,
    questNumber: state.questIndex + 1, teamIds: [...state.proposedTeam], cards, revealedCount: 0, failCount, success, requiredFails: required };
  setDeadlineMs(state, QUEST_SEAL_MS, now);
}

function finishQuestReveal(state, now) {
  const ceremony = state.pendingCeremony;
  const { cards, failCount, success } = ceremony;
  const completedIndex = ceremony.questIndex;
  state.questResults.push({ questNumber: completedIndex + 1, success, failCount, successCount: cards.length - failCount, team: [...state.proposedTeam] });
  if (success) state.goodQuests += 1; else state.evilQuests += 1;
  state.questIndex += 1;
  clearDeadline(state);
  const sid = scene(state);
  addLog(state, `第${completedIndex + 1}次远征${success ? "成功" : "失败"}：${failCount}张失败牌。`, now);
  present(state, "quest-result", `第${completedIndex + 1}次远征${success ? "成功" : "失败"}`, now, { priority: 5, success, failCount, targetIds: state.proposedTeam, questNumber: completedIndex + 1, ceremony: "quest" }, sid);
  if (state.evilQuests >= 3) return finishGame(state, ALIGNMENT.EVIL, "三次远征失败。", now, { ceremony: "quest" }, sid);
  if (state.goodQuests >= 3) {
    state.pendingCeremony = null;
    state.phase = "assassination"; setDeadline(state, state.timers.assassination, now);
    addLog(state, `三次远征成功，刺客${playerName(state, state.assassinId)}现身并寻找梅林。`, now);
    present(state, "assassination-start", `${playerName(state, state.assassinId)}以刺客身份现身`, now, { priority: 5, actorId: state.assassinId }, sid);
    return;
  }
  if (state.ladyEnabled && [1, 2, 3].includes(completedIndex) && ladyTargets(state).length) {
    state.pendingCeremony = null;
    state.phase = "ladyInspect"; setDeadline(state, state.timers.ladyInspect, now);
    addLog(state, `湖中仙女由${playerName(state, state.ladyHolderId)}持有，等待秘密查验。`, now);
    present(state, "lady-ready", `${playerName(state, state.ladyHolderId)}即将使用湖中仙女`, now, { priority: 3, actorId: state.ladyHolderId }, sid);
    return;
  }
  state.pendingCeremony = null;
  continueAfterQuest(state, now);
}

function advanceQuestReveal(state, now) {
  const ceremony = state.pendingCeremony;
  fail(state.phase !== "questReveal" || ceremony?.kind !== "quest", "invalid_quest_reveal", "远征揭晓状态无效。", 409);
  if (ceremony.stage === "sealed") { ceremony.stage = "cards"; ceremony.revealedCount = 1; setDeadlineMs(state, QUEST_CARD_MS, now); return; }
  if (ceremony.stage === "cards" && ceremony.revealedCount < ceremony.cards.length) { ceremony.revealedCount += 1; setDeadlineMs(state, QUEST_CARD_MS, now); return; }
  if (ceremony.stage === "cards") { ceremony.stage = "verdict"; setDeadlineMs(state, QUEST_VERDICT_MS, now); return; }
  finishQuestReveal(state, now);
}

function beginAssassinationReveal(state, target, now) {
  state.phase = "assassinationReveal";
  state.pendingCeremony = { id: `assassination_${state.matchNumber}`, kind: "assassination", stage: "approach", assassinId: state.assassinId,
    targetId: target.id, hit: target.id === state.merlinId };
  setDeadlineMs(state, ASSASSINATION_APPROACH_MS, now);
  addLog(state, `刺客${playerName(state, state.assassinId)}锁定了${target.name}，王国等待最终裁决。`, now);
  present(state, "assassination-targeted", `${playerName(state, state.assassinId)}锁定了${target.name}`, now,
    { priority: 5, actorId: state.assassinId, targetId: target.id, ceremony: "assassination" });
}

function advanceAssassinationReveal(state, now) {
  const ceremony = state.pendingCeremony;
  fail(state.phase !== "assassinationReveal" || ceremony?.kind !== "assassination", "invalid_assassination_reveal", "刺杀揭晓状态无效。", 409);
  if (ceremony.stage === "approach") { ceremony.stage = "strike"; setDeadlineMs(state, ASSASSINATION_STRIKE_MS, now); return; }
  if (ceremony.stage === "strike") { ceremony.stage = "verdict"; setDeadlineMs(state, ASSASSINATION_VERDICT_MS, now); return; }
  const hit = ceremony.hit;
  finishGame(state, hit ? ALIGNMENT.EVIL : ALIGNMENT.GOOD, hit ? "刺客成功辨认并刺杀了梅林。" : "刺客未能找出梅林。", now,
    { assassinTargetId: ceremony.targetId, merlinId: state.merlinId, ceremony: "assassination" });
}

function inspectLady(state, actorId, targetId, now, automatic = false) {
  fail(state.phase !== "ladyInspect", "wrong_phase", "现在不能使用湖中仙女。", 409);
  fail(actorId !== state.ladyHolderId, "lady_holder_required", "只有湖中仙女持有者可以查验。", 403);
  const target = ladyTargets(state).find((player) => player.id === String(targetId));
  fail(!target, "invalid_lady_target", "该玩家不能成为本次查验目标。");
  const displayedAlignment = target.role === ROLE.OBERON ? ALIGNMENT.GOOD : alignmentOf(target.role);
  state.ladyFindings.push({ viewerId: actorId, targetId: target.id, displayedAlignment, questNumber: state.questIndex, automatic });
  state.ladyHolderId = target.id; state.ladyHistory.push(target.id);
  addLog(state, `${playerName(state, actorId)}查验了${target.name}，湖中仙女令牌随之转移。`, now);
  present(state, "lady-inspect", `${playerName(state, actorId)}查验了${target.name}`, now, { priority: 4, actorId, targetId: target.id, automatic });
  continueAfterQuest(state, now);
}

function startMatch(state, now, random) {
  fail(state.players.length !== state.capacity, "room_not_full", `需要${state.capacity}名玩家才能开始。`, 409);
  state.matchNumber += 1;
  const dealt = dealRoles(state.players.map((player) => player.id), state.preset, random);
  state.players.forEach((player) => { player.role = dealt[player.id]; player.secretAcknowledged = false; });
  state.merlinId = state.players.find((player) => player.role === ROLE.MERLIN).id;
  state.assassinId = state.players.find((player) => player.role === ROLE.ASSASSIN).id;
  state.startingLeaderId = randomChoice(state.players, random).id;
  state.leaderId = state.startingLeaderId;
  state.questIndex = 0; state.proposalNumber = 1; state.proposedTeam = []; state.teamVotes = {}; state.questCards = {};
  state.lastTeamVoteResult = null; state.questResults = []; state.goodQuests = 0; state.evilQuests = 0; state.result = null;
  state.ladyFindings = [];
  state.ladyHolderId = state.ladyEnabled ? nextPlayerId(state, state.startingLeaderId) : null;
  state.ladyHistory = state.ladyHolderId ? [state.ladyHolderId] : [];
  state.phase = "secretReveal"; setDeadline(state, state.timers.secretReveal, now);
  addLog(state, `第${state.matchNumber}局开始，身份与誓约已经秘密发放。`, now);
  present(state, "match-start", "卡美洛议会开启，秘密身份已经发放", now, { priority: 4 });
}

export function createLobby({ capacity, host }) {
  const state = {
    stateVersion: STATE_VERSION, capacity: checkedCapacity(capacity), preset: PRESET.CLASSIC, ladyEnabled: false,
    paceMode: PACE.STANDARD, timers: normalizeTimers(PACE.STANDARD),
    players: [makePlayer({ ...host, isHost: true })], matchNumber: 0, stats: { goodWins: 0, evilWins: 0 },
    logs: [], logSequence: 0, presentationEvents: [], presentationSequence: 0, presentationSceneSequence: 0
  };
  resetMatchState(state); return state;
}
export function addPlayer(state, player) { fail(state.phase !== "lobby", "game_started", "游戏开始后只能旁观。", 409); fail(state.players.length >= state.capacity, "room_full", "玩家席已满。", 409); fail(byId(state, player.id), "duplicate_player", "玩家已经在房间中。", 409); state.players.push(makePlayer(player)); }
export function removePlayer(state, actorId, playerId) { requireHost(state, actorId); fail(state.phase !== "lobby", "game_started", "游戏开始后不能移出正式玩家。", 409); const target = byId(state, playerId); fail(!target || target.isHost, "invalid_remove", "不能移出该玩家。"); state.players = state.players.filter((player) => player.id !== target.id); }
export function canChangeSeats(state) { return state.phase === "lobby"; }
export function vacateSeat(state, playerId) { fail(state.phase !== "lobby", "seat_locked", "游戏开始后不能离开玩家席。", 409); const player = requirePlayer(state, playerId); fail(player.isHost, "host_must_play", "房主必须留在玩家席。", 403); state.players = state.players.filter((item) => item.id !== player.id); }
export function setPresence(state, playerId, connected) { const player = byId(state, playerId); if (player) player.connected = Boolean(connected); }

export function applyAction(state, actorId, action, { now = Date.now(), random = Math.random } = {}) {
  const actor = requirePlayer(state, actorId); fail(!action || typeof action.type !== "string", "invalid_action", "操作无效。");
  switch (action.type) {
    case "setCapacity": {
      requireHost(state, actorId); fail(state.phase !== "lobby", "wrong_phase", "只能在准备阶段修改人数。", 409);
      const capacity = checkedCapacity(action.capacity);
      fail(capacity < state.players.length, "capacity_too_small", "人数不能少于当前玩家数。");
      state.capacity = capacity;
      if (capacity < 7) state.ladyEnabled = false;
      break;
    }
    case "setPreset": requireHost(state, actorId); fail(state.phase !== "lobby", "wrong_phase", "只能在准备阶段修改角色预设。", 409); state.preset = checkedPreset(action.preset); break;
    case "setPace": {
      requireHost(state, actorId); fail(state.phase !== "lobby", "wrong_phase", "只能在准备阶段修改对局节奏。", 409);
      const pace = checkedPace(action.paceMode);
      state.timers = checkedTimers(pace, action.timers);
      state.paceMode = pace;
      break;
    }
    case "setLadyEnabled": requireHost(state, actorId); fail(state.phase !== "lobby", "wrong_phase", "只能在准备阶段设置湖中仙女。", 409); fail(Boolean(action.enabled) && state.capacity < 7, "lady_requires_seven", "湖中仙女仅支持7人及以上。"); state.ladyEnabled = Boolean(action.enabled); break;
    case "start": requireHost(state, actorId); fail(state.phase !== "lobby", "wrong_phase", "游戏已经开始。", 409); startMatch(state, now, random); break;
    case "acknowledgeSecret": fail(state.phase !== "secretReveal", "wrong_phase", "现在无需确认身份。", 409); actor.secretAcknowledged = true; if (state.players.every((player) => player.secretAcknowledged)) beginProposal(state, now); break;
    case "requestDiscussionExtension": requestExtension(state, actorId, now); break;
    case "voteDiscussionExtension": {
      fail(state.phase !== "teamProposal" || !state.proposalExtension.requested, "wrong_phase", "当前没有待表决的延长讨论申请。", 409);
      fail(Object.hasOwn(state.proposalExtension.votes, actorId), "already_voted", "你已经提交了延时表决。", 409);
      state.proposalExtension.votes[actorId] = Boolean(action.approve);
      resolveExtensionVote(state, now);
      break;
    }
    case "proposeTeam": submitTeam(state, actorId, action.memberIds, now); break;
    case "submitTeamVote": fail(state.phase !== "teamVote", "wrong_phase", "现在不能进行组队投票。", 409); fail(Object.hasOwn(state.teamVotes, actorId), "already_voted", "你已经提交了投票。", 409); state.teamVotes[actorId] = Boolean(action.approve); present(state, "team-vote-sealed", `${actor.name}封存了组队票`, now, { priority: 1, actorId }); if (state.players.every((player) => Object.hasOwn(state.teamVotes, player.id))) resolveTeamVote(state, now); break;
    case "submitQuestCard": {
      fail(state.phase !== "questAction", "wrong_phase", "现在不能提交任务牌。", 409);
      fail(!state.proposedTeam.includes(actorId), "not_on_quest", "你不在本次远征队伍中。", 403);
      fail(Object.hasOwn(state.questCards, actorId), "already_submitted", "你已经提交了任务牌。", 409);
      const card = action.card === "fail" ? "fail" : "success";
      fail(card === "fail" && alignmentOf(actor.role) !== ALIGNMENT.EVIL, "good_cannot_fail", "正义角色只能提交成功。", 403);
      state.questCards[actorId] = card;
      present(state, "quest-card-sealed", `${actor.name}将任务牌投入圣杯`, now, { priority: 1, actorId });
      if (state.proposedTeam.every((id) => Object.hasOwn(state.questCards, id))) beginQuestReveal(state, now, random);
      break;
    }
    case "ladyInspect": inspectLady(state, actorId, action.targetId, now); break;
    case "assassinate": {
      fail(state.phase !== "assassination", "wrong_phase", "现在不能进行刺杀。", 409);
      fail(actorId !== state.assassinId, "assassin_required", "只有刺客可以选择目标。", 403);
      const target = byId(state, action.targetId); fail(!target || target.id === actorId, "invalid_assassination_target", "刺杀目标无效。");
      beginAssassinationReveal(state, target, now);
      break;
    }
    case "end": requireHost(state, actorId); fail(state.phase === "lobby", "game_not_started", "当前没有可结束的游戏。", 409); resetMatchState(state); addLog(state, "房主结束了当前密议，所有骑士返回准备大厅。", now); break;
    case "nextMatch": requireHost(state, actorId); fail(state.phase !== "ended", "wrong_phase", "当前对局尚未结束。", 409); resetMatchState(state); break;
    default: throw new GameRuleError("unknown_action", "未知操作。");
  }
  validateState(state);
}

export function handleTimeout(state, { now = Date.now(), random = Math.random } = {}) {
  if (!state.deadline || now < state.deadline) return false;
  if (state.phase === "secretReveal") { state.players.forEach((player) => { player.secretAcknowledged = true; }); beginProposal(state, now); }
  else if (state.phase === "teamProposal" && state.proposalExtension.requested) resolveExtensionVote(state, now, true);
  else if (state.phase === "teamProposal") submitTeam(state, state.leaderId, shuffle(state.players.map((player) => player.id), random).slice(0, questSize(state.capacity, state.questIndex)), now, true);
  else if (state.phase === "teamVote") { state.players.forEach((player) => { if (!Object.hasOwn(state.teamVotes, player.id)) state.teamVotes[player.id] = false; }); resolveTeamVote(state, now); }
  else if (state.phase === "questAction") { state.proposedTeam.forEach((id) => { if (!Object.hasOwn(state.questCards, id)) state.questCards[id] = "success"; }); beginQuestReveal(state, now, random); }
  else if (state.phase === "questReveal") advanceQuestReveal(state, now);
  else if (state.phase === "ladyInspect") { const target = randomChoice(ladyTargets(state), random); if (target) inspectLady(state, state.ladyHolderId, target.id, now, true); else continueAfterQuest(state, now); }
  else if (state.phase === "assassination") { const targets = state.players.filter((player) => player.id !== state.assassinId); const target = randomChoice(targets, random); applyAction(state, state.assassinId, { type: "assassinate", targetId: target.id }, { now, random }); }
  else if (state.phase === "assassinationReveal") advanceAssassinationReveal(state, now);
  else return false;
  validateState(state); return true;
}
export function getDeadline(state) { return Number(state.deadline) || 0; }

function knowledgeFor(state, viewer) {
  if (!viewer?.role) return { knownEvilIds: [], percivalCandidates: [] };
  if (viewer.role === ROLE.MERLIN) return { knownEvilIds: state.players.filter((player) => alignmentOf(player.role) === ALIGNMENT.EVIL && ![ROLE.MORDRED, ROLE.OBERON].includes(player.role)).map((player) => player.id), percivalCandidates: [] };
  if (viewer.role === ROLE.PERCIVAL) return { knownEvilIds: [], percivalCandidates: state.players.filter((player) => [ROLE.MERLIN, ROLE.MORGANA].includes(player.role)).map((player) => player.id) };
  if (alignmentOf(viewer.role) === ALIGNMENT.EVIL && viewer.role !== ROLE.OBERON) return { knownEvilIds: state.players.filter((player) => alignmentOf(player.role) === ALIGNMENT.EVIL && player.role !== ROLE.OBERON && player.id !== viewer.id).map((player) => player.id), percivalCandidates: [] };
  return { knownEvilIds: [], percivalCandidates: [] };
}

function buildPublicView(state, viewer = null) {
  const ended = state.phase === "ended";
  const teamVoteDone = state.lastTeamVoteResult;
  const myFinding = viewer ? [...state.ladyFindings].reverse().find((item) => item.viewerId === viewer.id) || null : null;
  const knowledge = knowledgeFor(state, viewer);
  const ceremony = state.pendingCeremony ? { id: state.pendingCeremony.id, kind: state.pendingCeremony.kind, stage: state.pendingCeremony.stage } : null;
  if (ceremony?.kind === "quest") Object.assign(ceremony, { questNumber: state.pendingCeremony.questNumber, teamIds: [...state.pendingCeremony.teamIds], cardCount: state.pendingCeremony.cards.length,
    revealedCards: state.pendingCeremony.stage === "sealed" ? [] : state.pendingCeremony.cards.slice(0, state.pendingCeremony.revealedCount), requiredFails: state.pendingCeremony.requiredFails,
    success: state.pendingCeremony.stage === "verdict" ? state.pendingCeremony.success : null, failCount: state.pendingCeremony.stage === "verdict" ? state.pendingCeremony.failCount : null });
  if (ceremony?.kind === "assassination") Object.assign(ceremony, { assassinId: state.pendingCeremony.assassinId, targetId: state.pendingCeremony.targetId,
    hit: state.pendingCeremony.stage === "verdict" ? state.pendingCeremony.hit : null });
  return {
    stateVersion: state.stateVersion, capacity: state.capacity, preset: state.preset, ladyEnabled: state.ladyEnabled,
    paceMode: state.paceMode, timers: clone(state.timers),
    phase: state.phase, deadline: state.deadline, deadlineDurationSeconds: state.deadlineDurationSeconds, matchNumber: state.matchNumber, questIndex: state.questIndex,
    leaderId: state.leaderId, proposalNumber: state.proposalNumber, proposedTeam: [...state.proposedTeam],
    teamVoteProgress: Object.keys(state.teamVotes), lastTeamVoteResult: teamVoteDone ? clone(teamVoteDone) : null,
    questProgress: Object.keys(state.questCards), questResults: clone(state.questResults), goodQuests: state.goodQuests, evilQuests: state.evilQuests,
    requiredTeamSize: state.questIndex < 5 ? questSize(state.capacity, state.questIndex) : 0,
    requiredFails: state.questIndex < 5 ? failsRequired(state.capacity, state.questIndex) : 0,
    ladyHolderId: state.ladyHolderId, ladyHistory: [...state.ladyHistory], assassinId: ["assassination", "assassinationReveal"].includes(state.phase) || ended ? state.assassinId : null,
    ceremony,
    players: state.players.map((player) => ({ id: player.id, name: player.name, isHost: player.isHost, connected: player.connected, role: ended ? player.role : ["assassination", "assassinationReveal"].includes(state.phase) && player.id === state.assassinId ? ROLE.ASSASSIN : null, alignment: ended ? alignmentOf(player.role) : null, secretAcknowledged: player.secretAcknowledged })),
    selfId: viewer?.id || null, selfRole: viewer?.role || null, selfAlignment: viewer?.role ? alignmentOf(viewer.role) : null,
    knownEvilIds: knowledge.knownEvilIds, percivalCandidates: knowledge.percivalCandidates,
    myTeamVote: viewer && Object.hasOwn(state.teamVotes, viewer.id) ? state.teamVotes[viewer.id] : null,
    myQuestCard: viewer && Object.hasOwn(state.questCards, viewer.id) ? state.questCards[viewer.id] : null,
    myLadyFinding: myFinding ? clone(myFinding) : null,
    proposalExtension: {
      requested: state.proposalExtension.requested, used: state.proposalExtension.used, granted: state.proposalExtension.granted,
      voteProgress: Object.keys(state.proposalExtension.votes), yes: Object.values(state.proposalExtension.votes).filter(Boolean).length,
      no: Object.values(state.proposalExtension.votes).filter((vote) => vote === false).length,
      required: extensionMajority(state)
    },
    result: ended ? clone(state.result) : null, stats: clone(state.stats), logs: clone(state.logs), presentationEvents: clone(state.presentationEvents),
    permissions: {
      canManage: Boolean(viewer?.isHost),
      canConfigure: Boolean(viewer?.isHost && state.phase === "lobby"),
      canStart: Boolean(viewer?.isHost && state.phase === "lobby" && state.players.length === state.capacity),
      canAcknowledge: Boolean(viewer && state.phase === "secretReveal" && !viewer.secretAcknowledged),
      canPropose: Boolean(viewer && state.phase === "teamProposal" && state.leaderId === viewer.id),
      canRequestExtension: Boolean(viewer && state.phase === "teamProposal" && !state.proposalExtension.used && !state.proposalExtension.requested),
      canVoteExtension: Boolean(viewer && state.phase === "teamProposal" && state.proposalExtension.requested && !Object.hasOwn(state.proposalExtension.votes, viewer.id)),
      canTeamVote: Boolean(viewer && state.phase === "teamVote" && !Object.hasOwn(state.teamVotes, viewer.id)),
      canQuest: Boolean(viewer && state.phase === "questAction" && state.proposedTeam.includes(viewer.id) && !Object.hasOwn(state.questCards, viewer.id)),
      canFailQuest: Boolean(viewer && alignmentOf(viewer.role) === ALIGNMENT.EVIL),
      canUseLady: Boolean(viewer && state.phase === "ladyInspect" && state.ladyHolderId === viewer.id),
      ladyTargetIds: viewer && state.phase === "ladyInspect" && state.ladyHolderId === viewer.id ? ladyTargets(state).map((player) => player.id) : [],
      canAssassinate: Boolean(viewer && state.phase === "assassination" && state.assassinId === viewer.id),
      canNextMatch: Boolean(viewer?.isHost && state.phase === "ended"),
      canEnd: Boolean(viewer?.isHost && state.phase !== "lobby")
    }
  };
}
export function buildView(state, viewerId) { return buildPublicView(state, requirePlayer(state, viewerId)); }
export function buildSpectatorView(state) { return buildPublicView(state, null); }

export function validateState(state) {
  fail(!state || state.stateVersion !== STATE_VERSION, "invalid_state_version", "房间状态版本不兼容.");
  fail(!PHASES.has(state.phase), "invalid_phase", "房间阶段无效。");
  checkedCapacity(state.capacity); checkedPreset(state.preset); checkedPace(state.paceMode); checkedTimers(state.paceMode, state.timers);
  fail(!Number.isFinite(state.deadlineDurationSeconds) || state.deadlineDurationSeconds < 0, "invalid_deadline_duration", "倒计时窗口无效。");
  fail(!state.proposalExtension || typeof state.proposalExtension.votes !== "object", "invalid_extension_state", "延长讨论状态无效。");
  fail(!Array.isArray(state.players) || new Set(state.players.map((player) => player.id)).size !== state.players.length, "invalid_players", "玩家状态无效。");
  fail(state.players.length > state.capacity, "too_many_players", "玩家数量超过容量。");
  fail(!Array.isArray(state.questResults) || state.questResults.length > 5, "invalid_quests", "任务记录无效。");
  fail(["questReveal", "assassinationReveal"].includes(state.phase) && !state.pendingCeremony, "missing_ceremony", "关键演出状态缺失。");
  fail(!Number.isInteger(state.presentationSceneSequence) || state.presentationSceneSequence < 0, "invalid_presentation_scene", "演出场景无效。");
  if (state.phase !== "lobby") {
    fail(!byId(state, state.leaderId), "invalid_leader", "队长无效。");
    fail(state.players.some((player) => !player.role), "missing_roles", "角色状态不完整。");
  }
  try { validatePresentationState(state); } catch { throw new Error("Invalid game22 presentation events"); }
  return true;
}
export function serializeState(state) { validateState(state); return clone(state); }
export function restoreState(serialized) {
  fail(serialized?.stateVersion !== STATE_VERSION, "invalid_state_version", "无法恢复不兼容的房间状态。");
  const state = clone(serialized); normalizePresentationState(state, { idPrefix: "avalon_event", limit: 70 });
  normalizeTimingState(state);
  if (!("pendingCeremony" in state)) state.pendingCeremony = null;
  state.presentationSceneSequence = Number.isInteger(state.presentationSceneSequence) ? state.presentationSceneSequence : 0;
  validateState(state); return state;
}
