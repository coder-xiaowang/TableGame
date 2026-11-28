import {
  CLUE_MODE, DECOY_SECONDS, DISCUSSION_SECONDS, MAX_PLAYERS, MIN_PLAYERS, RESOLUTION_SECONDS,
  STORYTELLER_SECONDS, TARGET_SCORE, VOTE_SECONDS, assertCapacity, createDeck,
  decoyCount, handSize, normalizeClue, scoreRound, shuffle
} from "../rules.mjs";
import { appendPresentationEvent, normalizePresentationState, validatePresentationState } from "../../shared/server/presentation-events.mjs";

export const STATE_VERSION = 1;
export const SUPPORTS_SPECTATORS = true;
export const SIMULTANEOUS_ACTIONS = new Set(["submitDecoys", "submitVote"]);
export const ACTION_SECONDS = STORYTELLER_SECONDS;
const PHASES = new Set(["lobby", "storytellerChoosing", "playersChoosing", "voting", "resolution", "discussion", "ended"]);
const clone = (value) => structuredClone(value);
const byId = (state, id) => state.players.find((player) => player.id === String(id)) || null;

export class GameRuleError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = "GameRuleError"; this.code = code; this.status = status; }
}
function fail(condition, code, message, status = 400) { if (condition) throw new GameRuleError(code, message, status); }
function requirePlayer(state, id) { const player = byId(state, id); fail(!player, "not_a_player", "你不在玩家席中。", 403); return player; }
function requireHost(state, id) { const player = requirePlayer(state, id); fail(!player.isHost, "host_required", "只有房主可以执行该操作。", 403); return player; }
function checkedCapacity(value) { try { return assertCapacity(value); } catch { throw new GameRuleError("invalid_capacity", `人数必须为${MIN_PLAYERS}至${MAX_PLAYERS}人。`); } }
function playerName(state, id) { return byId(state, id)?.name || "玩家"; }
function addLog(state, text, now) { state.logs.unshift({ id: ++state.logSequence, text, at: now }); state.logs = state.logs.slice(0, 120); }
function nextPlayerId(state, id) { const index = state.players.findIndex((player) => player.id === id); return state.players[(index + 1) % state.players.length].id; }
function randomChoice(values, random) { return values[Math.min(values.length - 1, Math.floor(random() * values.length))]; }
function scene(state) { state.presentationSceneSequence += 1; return `dixit_scene_${state.presentationSceneSequence}`; }
function present(state, kind, text, now, details = {}, sceneId = null) {
  return appendPresentationEvent(state, { kind, text, priority: 2, sceneId: sceneId || scene(state), ...details }, { now, idPrefix: "dixit_event", limit: 80 });
}
function makePlayer({ id, name, isHost = false }) {
  fail(!id, "player_id_required", "缺少玩家身份。");
  return { id: String(id), name: String(name || "玩家").slice(0, 12), isHost: Boolean(isHost), connected: true, score: 0, hand: [] };
}
function ensureUniqueCards(cards, expected, message) {
  const ids = cards.map((card) => card.id);
  fail(cards.length !== expected || new Set(ids).size !== ids.length, "invalid_card_count", message);
}
function takeCards(player, cardIds, expected) {
  const ids = [...new Set((cardIds || []).map(String))];
  fail(ids.length !== expected, "invalid_card_count", `必须选择${expected}张牌。`);
  const cards = ids.map((id) => player.hand.find((card) => card.id === id));
  fail(cards.some((card) => !card), "card_not_in_hand", "选择中包含不属于你的牌。", 409);
  ensureUniqueCards(cards, expected, `必须选择${expected}张不同的牌。`);
  player.hand = player.hand.filter((card) => !ids.includes(card.id));
  return cards;
}
function drawCard(state, random) {
  if (!state.deck.length && state.discard.length) {
    state.deck = shuffle(state.discard, random); state.discard = [];
  }
  return state.deck.pop() || null;
}
function fillHands(state, random) {
  const size = handSize(state.capacity);
  for (const player of state.players) while (player.hand.length < size) {
    const card = drawCard(state, random); if (!card) break; player.hand.push(card);
  }
}
function resetRound(state) {
  state.clue = null; state.storytellerSubmission = null; state.submissions = {};
  state.displayCards = []; state.votes = {}; state.roundResult = null;
}
function resetMatch(state) {
  state.phase = "lobby"; state.deadline = 0; state.round = 0; state.storytellerId = null;
  state.startingStorytellerId = null; state.deck = []; state.discard = []; state.result = null;
  state.presentationEvents = [];
  state.players.forEach((player) => { player.score = 0; player.hand = []; }); resetRound(state);
}
function beginStorytellerTurn(state, now) {
  resetRound(state); state.round += 1; state.phase = "storytellerChoosing";
  state.deadline = now + STORYTELLER_SECONDS * 1000;
  addLog(state, `第${state.round}轮：${playerName(state, state.storytellerId)}成为叙述者。`, now);
  present(state, "storyteller-turn", `${playerName(state, state.storytellerId)}走向梦境画框`, now, { actorId: state.storytellerId, round: state.round });
}
function startMatch(state, now, random) {
  fail(state.players.length !== state.capacity, "room_not_full", `需要${state.capacity}名玩家才能开始。`, 409);
  state.matchNumber += 1; state.players.forEach((player) => { player.score = 0; player.hand = []; });
  state.deck = createDeck(random); state.discard = []; state.round = 0; state.result = null;
  fillHands(state, random); state.storytellerId = randomChoice(state.players, random).id;
  state.startingStorytellerId = state.storytellerId;
  addLog(state, `第${state.matchNumber}场梦境旅程开启，84扇画门已经洗混。`, now);
  present(state, "match-start", "梦境画廊开启，画门已经分发", now, { priority: 4 });
  beginStorytellerTurn(state, now);
}
function submitStory(state, actorId, cardId, clueMode, clueText, now, automatic = false) {
  fail(state.phase !== "storytellerChoosing", "wrong_phase", "现在不能给出线索。", 409);
  fail(actorId !== state.storytellerId, "storyteller_required", "只有本轮叙述者可以给出线索。", 403);
  const player = requirePlayer(state, actorId);
  const card = takeCards(player, [cardId], 1)[0];
  let clue;
  try { clue = normalizeClue(clueMode, clueText); }
  catch { throw new GameRuleError("invalid_clue", "文字线索不能为空，且不能超过80个字符。"); }
  state.storytellerSubmission = { ownerId: actorId, cards: [card], automatic };
  state.clue = clue; state.phase = "playersChoosing"; state.deadline = now + DECOY_SECONDS * 1000;
  const publicClue = clue.mode === CLUE_MODE.VOICE ? (clue.text || "线索已通过语音给出") : clue.text;
  addLog(state, `${player.name}给出线索：“${publicClue}”。`, now);
  present(state, "clue-given", `线索：${publicClue}`, now, { priority: 4, actorId, clue: clone(clue), automatic });
}
function submitDecoys(state, actorId, cardIds, now, automatic = false, random = Math.random) {
  fail(state.phase !== "playersChoosing", "wrong_phase", "现在不能提交干扰牌。", 409);
  fail(actorId === state.storytellerId, "storyteller_cannot_decoy", "叙述者不提交干扰牌。", 403);
  fail(state.submissions[actorId], "already_submitted", "你已经提交了干扰牌。", 409);
  const player = requirePlayer(state, actorId); const count = decoyCount(state.capacity);
  state.submissions[actorId] = { ownerId: actorId, cards: takeCards(player, cardIds, count), automatic };
  present(state, "decoy-sealed", `${player.name}将画面封入梦匣`, now, { actorId, priority: 1, automatic });
  if (state.players.filter((item) => item.id !== state.storytellerId).every((item) => state.submissions[item.id])) revealGallery(state, now, random);
}
function revealGallery(state, now, random = Math.random) {
  const entries = [state.storytellerSubmission, ...state.players.filter((player) => player.id !== state.storytellerId).map((player) => state.submissions[player.id])]
    .flatMap((submission) => submission.cards.map((card) => ({ ownerId: submission.ownerId, card })));
  state.displayCards = shuffle(entries, random).map((entry, index) => ({ ...entry, displayId: `display_${index + 1}` }));
  state.phase = "voting"; state.deadline = now + VOTE_SECONDS * 1000; state.votes = {};
  addLog(state, `${entries.length}幅梦境画面已经洗混并公开。`, now);
  present(state, "gallery-reveal", "梦匣开启，所有画面同时显现", now, { priority: 4, count: entries.length });
}
function legalVoteCards(state, playerId) { return state.displayCards.filter((entry) => entry.ownerId !== playerId); }
function submitVote(state, actorId, displayId, now, automatic = false) {
  fail(state.phase !== "voting", "wrong_phase", "现在不能投票。", 409);
  fail(actorId === state.storytellerId, "storyteller_cannot_vote", "叙述者不参与投票。", 403);
  fail(state.votes[actorId], "already_voted", "你已经提交了投票。", 409);
  const target = legalVoteCards(state, actorId).find((entry) => entry.displayId === String(displayId));
  fail(!target, "invalid_vote", "不能投给自己的画面或无效位置。", 409);
  state.votes[actorId] = target.displayId;
  present(state, "vote-sealed", `${playerName(state, actorId)}留下了一枚兔子印记`, now, { actorId, priority: 1, automatic });
  if (state.players.filter((player) => player.id !== state.storytellerId).every((player) => state.votes[player.id])) resolveRound(state, now);
}
function resolveRound(state, now) {
  const storytellerCard = state.displayCards.find((entry) => entry.ownerId === state.storytellerId);
  const scored = scoreRound({ playerIds: state.players.map((player) => player.id), storytellerId: state.storytellerId, storytellerDisplayId: storytellerCard.displayId, displayCards: state.displayCards, votes: state.votes });
  state.players.forEach((player) => { player.score += scored.gains[player.id] || 0; });
  state.roundResult = { storytellerDisplayId: storytellerCard.displayId, gains: scored.gains, correctVoters: scored.correctVoters, allOrNone: scored.allOrNone, votes: clone(state.votes), owners: Object.fromEntries(state.displayCards.map((entry) => [entry.displayId, entry.ownerId])) };
  state.phase = "resolution"; state.deadline = now + RESOLUTION_SECONDS * 1000;
  const sid = scene(state); const outcome = scored.allOrNone ? (scored.correctVoters.length ? "所有人都找到了答案" : "没有人找到答案") : "只有部分旅人找到了答案";
  addLog(state, `${outcome}；本轮得分已经结算。`, now);
  present(state, "answer-reveal", `${outcome}`, now, { priority: 5, targetDisplayId: storytellerCard.displayId }, sid);
  present(state, "score-travel", "兔子沿星轨记录本轮得分", now, { priority: 4, gains: clone(scored.gains) }, sid);
}
function beginDiscussion(state, now) {
  fail(state.phase !== "resolution", "wrong_phase", "当前没有可以进入讨论的结算。", 409);
  state.phase = "discussion";
  state.deadline = now + DISCUSSION_SECONDS * 1000;
  addLog(state, `第${state.round}轮进入讨论时间，旅人可以交流各自的联想。`, now);
  present(state, "discussion-open", "答案已经揭晓，旅人开始分享彼此的联想", now, { priority: 3, round: state.round });
}
function finishOrContinue(state, now, random) {
  fail(state.phase !== "discussion", "wrong_phase", "当前不在讨论阶段。", 409);
  state.discard.push(...state.displayCards.map((entry) => entry.card)); state.storytellerSubmission = null; state.submissions = {}; fillHands(state, random);
  const leaders = state.players.filter((player) => player.score >= TARGET_SCORE);
  if (leaders.length) {
    const best = Math.max(...state.players.map((player) => player.score)); const winnerIds = state.players.filter((player) => player.score === best).map((player) => player.id);
    state.phase = "ended"; state.deadline = 0; state.result = { winnerIds, score: best, rankings: [...state.players].sort((a, b) => b.score - a.score).map((player) => ({ playerId: player.id, score: player.score })) };
    addLog(state, `梦境旅程结束：${winnerIds.map((id) => playerName(state, id)).join("、")}获得最高分。`, now);
    present(state, "game-result", "梦境旅程抵达终点", now, { priority: 5, winnerIds, score: best });
    return;
  }
  state.storytellerId = nextPlayerId(state, state.storytellerId); beginStorytellerTurn(state, now);
}

export function createLobby({ capacity, host }) {
  const state = { stateVersion: STATE_VERSION, capacity: checkedCapacity(capacity), players: [makePlayer({ ...host, isHost: true })], matchNumber: 0, logs: [], logSequence: 0, presentationEvents: [], presentationSequence: 0, presentationSceneSequence: 0 };
  resetMatch(state); return state;
}
export function addPlayer(state, player) { fail(state.phase !== "lobby", "game_started", "游戏开始后只能旁观。", 409); fail(state.players.length >= state.capacity, "room_full", "玩家席已满。", 409); fail(byId(state, player.id), "duplicate_player", "玩家已经在房间中。", 409); state.players.push(makePlayer(player)); }
export function removePlayer(state, actorId, playerId) { requireHost(state, actorId); fail(state.phase !== "lobby", "game_started", "游戏开始后不能移出正式玩家。", 409); const target = byId(state, playerId); fail(!target || target.isHost, "invalid_remove", "不能移出该玩家。"); state.players = state.players.filter((player) => player.id !== target.id); }
export function canChangeSeats(state) { return state.phase === "lobby"; }
export function vacateSeat(state, playerId) { fail(state.phase !== "lobby", "seat_locked", "游戏开始后不能离开玩家席。", 409); const player = requirePlayer(state, playerId); fail(player.isHost, "host_must_play", "房主必须留在玩家席。", 403); state.players = state.players.filter((item) => item.id !== player.id); }
export function setPresence(state, playerId, connected) { const player = byId(state, playerId); if (!player || player.connected === Boolean(connected)) return false; player.connected = Boolean(connected); return true; }

export function applyAction(state, actorId, action, { now = Date.now(), random = Math.random } = {}) {
  requirePlayer(state, actorId); fail(!action || typeof action.type !== "string", "invalid_action", "操作无效。");
  switch (action.type) {
    case "setCapacity": { requireHost(state, actorId); fail(state.phase !== "lobby", "wrong_phase", "只能在准备阶段修改人数。", 409); const capacity = checkedCapacity(action.capacity); fail(capacity < state.players.length, "capacity_too_small", "人数不能少于当前玩家数。"); state.capacity = capacity; break; }
    case "start": requireHost(state, actorId); fail(state.phase !== "lobby", "wrong_phase", "游戏已经开始。", 409); startMatch(state, now, random); break;
    case "submitStory": submitStory(state, actorId, action.cardId, action.clueMode, action.clueText, now); break;
    case "submitDecoys": submitDecoys(state, actorId, action.cardIds, now, false, random); break;
    case "submitVote": submitVote(state, actorId, action.displayId, now); break;
    case "continue": {
      requireHost(state, actorId);
      if (state.phase === "resolution") beginDiscussion(state, now);
      else finishOrContinue(state, now, random);
      break;
    }
    case "end": requireHost(state, actorId); fail(state.phase === "lobby", "game_not_started", "当前没有可结束的游戏。", 409); resetMatch(state); addLog(state, "房主结束了当前梦境旅程，所有旅人返回准备大厅。", now); break;
    case "nextMatch": requireHost(state, actorId); fail(state.phase !== "ended", "wrong_phase", "当前对局尚未结束。", 409); resetMatch(state); break;
    default: throw new GameRuleError("unknown_action", "未知操作。");
  }
  validateState(state);
}

export function handleTimeout(state, { now = Date.now(), random = Math.random } = {}) {
  if (!state.deadline || now < state.deadline) return false;
  if (state.phase === "storytellerChoosing") {
    const storyteller = byId(state, state.storytellerId); submitStory(state, state.storytellerId, randomChoice(storyteller.hand, random).id, CLUE_MODE.TEXT, "一个没有说完的梦", now, true);
  } else if (state.phase === "playersChoosing") {
    const count = decoyCount(state.capacity);
    for (const player of state.players.filter((item) => item.id !== state.storytellerId && !state.submissions[item.id])) submitDecoys(state, player.id, shuffle(player.hand, random).slice(0, count).map((card) => card.id), now, true, random);
  } else if (state.phase === "voting") {
    for (const player of state.players.filter((item) => item.id !== state.storytellerId && !state.votes[item.id])) submitVote(state, player.id, randomChoice(legalVoteCards(state, player.id), random).displayId, now, true);
  } else if (state.phase === "resolution") beginDiscussion(state, now);
  else if (state.phase === "discussion") finishOrContinue(state, now, random);
  else return false;
  validateState(state); return true;
}
export function getDeadline(state) { return Number(state.deadline) || 0; }

function publicPlayers(state, ended) { return state.players.map((player) => ({ id: player.id, name: player.name, isHost: player.isHost, connected: player.connected, score: player.score, handCount: player.hand.length })); }
function buildPublicView(state, viewer = null) {
  const reveal = ["voting", "resolution", "discussion", "ended"].includes(state.phase); const resolved = ["resolution", "discussion", "ended"].includes(state.phase);
  const ownDisplayIds = viewer && reveal ? state.displayCards.filter((entry) => entry.ownerId === viewer.id).map((entry) => entry.displayId) : [];
  return {
    stateVersion: state.stateVersion, capacity: state.capacity, phase: state.phase, deadline: state.deadline, round: state.round, matchNumber: state.matchNumber,
    storytellerId: state.storytellerId, clue: state.clue ? clone(state.clue) : null, submissionCount: Object.keys(state.submissions).length,
    requiredSubmissions: state.phase === "playersChoosing" ? state.players.length - 1 : 0, voteCount: Object.keys(state.votes).length,
    displayCards: reveal ? state.displayCards.map((entry) => ({ displayId: entry.displayId, card: clone(entry.card), ownerId: resolved ? entry.ownerId : null })) : [],
    roundResult: resolved ? clone(state.roundResult) : null, players: publicPlayers(state), selfId: viewer?.id || null,
    hand: viewer ? clone(viewer.hand) : [], ownDisplayIds, mySubmittedCardIds: viewer && state.submissions[viewer.id] ? state.submissions[viewer.id].cards.map((card) => card.id) : [],
    hasVoted: Boolean(viewer && state.votes[viewer.id]), result: state.phase === "ended" ? clone(state.result) : null,
    targetScore: TARGET_SCORE, handSize: handSize(state.capacity), decoyCount: decoyCount(state.capacity), logs: clone(state.logs), presentationEvents: clone(state.presentationEvents),
    permissions: {
      canManage: Boolean(viewer?.isHost), canConfigure: Boolean(viewer?.isHost && state.phase === "lobby"),
      canStart: Boolean(viewer?.isHost && state.phase === "lobby" && state.players.length === state.capacity),
      canTell: Boolean(viewer && state.phase === "storytellerChoosing" && viewer.id === state.storytellerId),
      canSubmitDecoys: Boolean(viewer && state.phase === "playersChoosing" && viewer.id !== state.storytellerId && !state.submissions[viewer.id]),
      canVote: Boolean(viewer && state.phase === "voting" && viewer.id !== state.storytellerId && !state.votes[viewer.id]),
      canContinue: Boolean(viewer?.isHost && ["resolution", "discussion"].includes(state.phase)), canNextMatch: Boolean(viewer?.isHost && state.phase === "ended"),
      canEnd: Boolean(viewer?.isHost && state.phase !== "lobby")
    }
  };
}
export function buildView(state, viewerId) { return buildPublicView(state, requirePlayer(state, viewerId)); }
export function buildSpectatorView(state) { return buildPublicView(state, null); }

export function validateState(state) {
  fail(!state || state.stateVersion !== STATE_VERSION, "invalid_state_version", "房间状态版本不兼容。");
  fail(!PHASES.has(state.phase), "invalid_phase", "房间阶段无效。"); checkedCapacity(state.capacity);
  fail(!Array.isArray(state.players) || new Set(state.players.map((player) => player.id)).size !== state.players.length, "invalid_players", "玩家状态无效。");
  fail(state.players.length > state.capacity, "too_many_players", "玩家数量超过容量。");
  const allCards = [...state.deck, ...state.discard, ...state.players.flatMap((player) => player.hand), ...(state.storytellerSubmission?.cards || []), ...Object.values(state.submissions || {}).flatMap((entry) => entry.cards || [])];
  fail(new Set(allCards.map((card) => card.id)).size !== allCards.length, "duplicate_cards", "牌组中出现重复卡牌。");
  if (state.phase !== "lobby") fail(!byId(state, state.storytellerId), "invalid_storyteller", "叙述者无效。");
  try { validatePresentationState(state); } catch { throw new Error("Invalid game23 presentation events"); }
  return true;
}
export function serializeState(state) { validateState(state); return clone(state); }
export function restoreState(serialized) {
  fail(serialized?.stateVersion !== STATE_VERSION, "invalid_state_version", "无法恢复不兼容的房间状态。");
  const state = clone(serialized); normalizePresentationState(state, { idPrefix: "dixit_event", limit: 80 });
  state.presentationSceneSequence = Number.isInteger(state.presentationSceneSequence) ? state.presentationSceneSequence : 0;
  validateState(state); return state;
}
