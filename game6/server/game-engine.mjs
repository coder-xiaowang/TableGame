import {
  ACTION_SECONDS, CAPTURE_ANIMATION_MS, HAND_SIZE, MAX_PLAYERS, MIN_PLAYERS,
  PLACE_ANIMATION_MS, REVEAL_MS, ROW_COUNT, ROW_LIMIT, SCORE_LIMIT, TURN_END_MS,
  rowBullheads, shuffledDeck, targetRowIndex
} from "../rules.mjs";

export { ACTION_SECONDS };
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
  return String(value ?? "").trim().slice(0,12) || fallback;
}

function assertCapacity(capacity) {
  const value = Number(capacity);
  if (!Number.isInteger(value) || value < MIN_PLAYERS || value > MAX_PLAYERS) {
    throw new GameRuleError("invalid_capacity", "游戏人数必须为 2～10 人。");
  }
  return value;
}

function makePlayer({id,name,isHost=false,connected=false}) {
  if (!id) throw new GameRuleError("player_id_required", "缺少玩家身份。");
  return {
    id:String(id),name:cleanName(name,isHost ? "房主" : "玩家"),
    isHost:Boolean(isHost),connected:Boolean(connected),hand:[],captured:[],score:0,selectedCard:null
  };
}

function playerById(state, playerId) {
  return state.players.find((player) => player.id === String(playerId)) || null;
}

function requireActor(state, actorId) {
  const actor = playerById(state,actorId);
  if (!actor) throw new GameRuleError("not_a_player", "你不属于这个房间。", 403);
  return actor;
}

function requireHost(state, actorId) {
  const actor = requireActor(state,actorId);
  if (!actor.isHost) throw new GameRuleError("host_required", "只有房主可以执行此操作。", 403);
  return actor;
}

function addLog(state, text, now) {
  state.logs.unshift({id:`log_${state.logSequence += 1}`,text,at:now});
  if (state.logs.length > 100) state.logs.length = 100;
}

function randomIndex(length, random) {
  const sample = Math.max(0,Math.min(0.999999999999,Number(random()) || 0));
  return Math.floor(sample * length);
}

function clearTurnPresentation(state) {
  state.revealedPlays = [];
  state.playQueue = [];
  state.pendingPlayerId = null;
  state.pendingCard = null;
  state.animation = null;
}

function resetToLobby(state) {
  state.phase = "lobby";
  state.round = 0;
  state.turn = 0;
  state.rows = [];
  clearTurnPresentation(state);
  state.deadline = 0;
  state.logs = [];
  state.logSequence = 0;
  state.animationSequence = 0;
  state.winners = [];
  for (const player of state.players) {
    player.hand = [];
    player.captured = [];
    player.score = 0;
    player.selectedCard = null;
  }
}

function capture(state, playerId, cards, now) {
  const player = playerById(state,playerId);
  const points = rowBullheads(cards);
  player.captured.push(...cards);
  player.score += points;
  addLog(state,`${player.name} 收走 ${cards.join("、")}，获得 ${points} 个牛头`,now);
}

function finishRound(state, now) {
  state.deadline = 0;
  clearTurnPresentation(state);
  if (state.players.some((player) => player.score >= SCORE_LIMIT)) {
    const best = Math.min(...state.players.map((player) => player.score));
    state.winners = state.players.filter((player) => player.score === best).map((player) => player.id);
    state.phase = "gameEnd";
    addLog(state,`游戏结束，${state.players.filter((player) => state.winners.includes(player.id)).map((player) => player.name).join("、")} 获胜`,now);
  } else {
    state.phase = "roundEnd";
    addLog(state,`第 ${state.round} 局结束，等待房主开始下一局`,now);
  }
}

function finishTurn(state, now) {
  for (const player of state.players) player.selectedCard = null;
  clearTurnPresentation(state);
  if (state.turn >= HAND_SIZE) return finishRound(state,now);
  state.turn += 1;
  state.phase = "selecting";
  state.deadline = now + ACTION_SECONDS * 1000;
}

function revealedPlay(state, playerId, card) {
  return state.revealedPlays.find((play) => play.playerId === playerId && play.card === card) || null;
}

function stageAnimation(state, play, rowIndex, now, forceCapture = false) {
  const capturedCards = forceCapture || state.rows[rowIndex].length === ROW_LIMIT ? [...state.rows[rowIndex]] : [];
  const duration = capturedCards.length ? CAPTURE_ANIMATION_MS : PLACE_ANIMATION_MS;
  const publicPlay = revealedPlay(state,play.playerId,play.card);
  if (publicPlay) publicPlay.status = "active";
  state.phase = "placing";
  state.pendingPlayerId = play.playerId;
  state.pendingCard = play.card;
  state.animation = {
    id:`animation_${state.animationSequence += 1}`,
    type:capturedCards.length ? "captureAndPlace" : "placeCard",
    playerId:play.playerId,
    card:play.card,
    rowIndex,
    capturedCards,
    points:rowBullheads(capturedCards),
    startedAt:now,
    endsAt:now + duration
  };
  state.deadline = state.animation.endsAt;
}

function stageNextPlay(state, now) {
  if (!state.playQueue.length) {
    state.phase = "turnEnding";
    state.pendingPlayerId = null;
    state.pendingCard = null;
    state.animation = null;
    state.deadline = now + TURN_END_MS;
    return;
  }
  const play = state.playQueue.shift();
  const rowIndex = targetRowIndex(state.rows,play.card);
  state.pendingPlayerId = play.playerId;
  state.pendingCard = play.card;
  if (rowIndex < 0) {
    const publicPlay = revealedPlay(state,play.playerId,play.card);
    if (publicPlay) publicPlay.status = "choosing";
    state.phase = "choosingRow";
    state.animation = null;
    state.deadline = now + ACTION_SECONDS * 1000;
    return;
  }
  stageAnimation(state,play,rowIndex,now);
}

function commitAnimation(state, now) {
  const animation = state.animation;
  if (!animation) throw new Error("Cannot commit a missing game6 animation");
  if (animation.capturedCards.length) {
    capture(state,animation.playerId,[...animation.capturedCards],now);
    state.rows[animation.rowIndex] = [animation.card];
  } else {
    state.rows[animation.rowIndex].push(animation.card);
  }
  const publicPlay = revealedPlay(state,animation.playerId,animation.card);
  if (publicPlay) publicPlay.status = "done";
  state.animation = null;
  state.pendingPlayerId = null;
  state.pendingCard = null;
  stageNextPlay(state,now);
}

function revealSelections(state, now) {
  state.playQueue = state.players
    .map((player) => ({playerId:player.id,card:player.selectedCard}))
    .sort((left,right) => left.card - right.card);
  for (const player of state.players) {
    const index = player.hand.indexOf(player.selectedCard);
    if (index < 0) throw new Error(`Selected card missing from ${player.id}'s hand`);
    player.hand.splice(index,1);
  }
  state.revealedPlays = state.playQueue.map((play) => ({...play,status:"waiting"}));
  state.phase = "revealing";
  state.pendingPlayerId = null;
  state.pendingCard = null;
  state.animation = null;
  state.deadline = now + REVEAL_MS;
  addLog(state,`本回合出牌：${state.playQueue.map((play) => `${playerById(state,play.playerId).name} ${play.card}`).join("，")}`,now);
}

function chooseRandomCard(state, player, random, now, reason) {
  if (player.selectedCard != null || !player.hand.length) return false;
  player.selectedCard = player.hand[randomIndex(player.hand.length,random)];
  addLog(state,`${player.name} ${reason}，系统已随机出牌`,now);
  return true;
}

function chooseRow(state, rowIndex, now) {
  const play = {playerId:state.pendingPlayerId,card:state.pendingCard};
  stageAnimation(state,play,rowIndex,now,true);
}

function startRound(state, random, now) {
  const deck = shuffledDeck(random);
  state.round += 1;
  state.turn = 1;
  state.rows = Array.from({length:ROW_COUNT},() => [deck.pop()]);
  clearTurnPresentation(state);
  state.winners = [];
  for (const player of state.players) {
    player.hand = deck.splice(-HAND_SIZE).sort((left,right) => left - right);
    player.captured = [];
    player.selectedCard = null;
  }
  state.phase = "selecting";
  state.deadline = now + ACTION_SECONDS * 1000;
  addLog(state,`第 ${state.round} 局开始`,now);
}

export function createLobby({capacity,host}) {
  return {
    stateVersion:STATE_VERSION,phase:"lobby",capacity:assertCapacity(capacity),
    round:0,turn:0,players:[makePlayer({...host,isHost:true})],rows:[],playQueue:[],
    revealedPlays:[],pendingPlayerId:null,pendingCard:null,animation:null,
    deadline:0,logs:[],logSequence:0,animationSequence:0,winners:[]
  };
}

export function addPlayer(state, player) {
  if (state.phase !== "lobby") throw new GameRuleError("game_started", "游戏已经开始，不能中途加入。", 409);
  if (state.players.length >= state.capacity) throw new GameRuleError("room_full", "房间人数已满。", 409);
  if (playerById(state,player.id)) throw new GameRuleError("player_exists", "该玩家已经在房间中。", 409);
  const next = makePlayer(player);
  state.players.push(next);
  return next;
}

export function removePlayer(state, actorId, playerId) {
  requireHost(state,actorId);
  const index = state.players.findIndex((player) => player.id === String(playerId));
  const target = state.players[index];
  if (!target || target.isHost) throw new GameRuleError("invalid_kick_target", "无法移出该玩家。");
  state.players.splice(index,1);
  if (state.phase !== "lobby") resetToLobby(state);
  return target;
}

export function setPresence(state, playerId, connected, {now=Date.now(),random=Math.random}={}) {
  const player = playerById(state,playerId);
  if (!player || player.connected === Boolean(connected)) return false;
  player.connected = Boolean(connected);
  if (!connected && state.phase === "selecting") {
    chooseRandomCard(state,player,random,now,"离线");
    if (state.players.every((item) => item.selectedCard != null)) revealSelections(state,now);
  } else if (!connected && state.phase === "choosingRow" && state.pendingPlayerId === player.id) {
    const rowIndex = randomIndex(state.rows.length,random);
    addLog(state,`${player.name} 离线，系统随机选择了第 ${rowIndex + 1} 列`,now);
    chooseRow(state,rowIndex,now);
  }
  return true;
}

export function applyAction(state, actorId, action, {now=Date.now(),random=Math.random}={}) {
  const actor = requireActor(state,actorId);
  const type = action?.type;
  if (type === "setCapacity") {
    requireHost(state,actorId);
    if (state.phase !== "lobby") throw new GameRuleError("game_started", "游戏开始后不能修改人数。", 409);
    const capacity = assertCapacity(action.capacity);
    if (capacity < state.players.length) throw new GameRuleError("capacity_too_small", "人数不能少于已经加入的玩家数。", 409);
    state.capacity = capacity;
    return;
  }
  if (type === "start") {
    requireHost(state,actorId);
    if (state.phase === "roundEnd") return startRound(state,random,now);
    if (state.phase !== "lobby") throw new GameRuleError("already_started", "游戏已经开始。", 409);
    if (state.players.length !== state.capacity) throw new GameRuleError("players_missing", `需要 ${state.capacity} 人到齐。`, 409);
    if (state.players.some((player) => !player.connected)) throw new GameRuleError("players_offline", "所有玩家在线后才能开始。", 409);
    for (const player of state.players) { player.score = 0; player.captured = []; }
    state.round = 0;
    state.logs = [];
    state.logSequence = 0;
    state.animationSequence = 0;
    return startRound(state,random,now);
  }
  if (type === "end") {
    requireHost(state,actorId);
    if (state.phase === "lobby") throw new GameRuleError("game_not_started", "当前没有可结束的游戏。", 409);
    resetToLobby(state);
    return;
  }
  if (!actor.connected) throw new GameRuleError("not_connected", "重新连接房间后才能行动。", 409);
  if (type === "selectCard") {
    if (state.phase !== "selecting") throw new GameRuleError("selection_unavailable", "当前不能选择手牌。", 409);
    if (actor.selectedCard != null) throw new GameRuleError("already_selected", "本回合已经锁定手牌。", 409);
    const card = Number(action.card);
    if (!Number.isInteger(card) || !actor.hand.includes(card)) throw new GameRuleError("card_not_in_hand", "所选牌不在你的手牌中。", 409);
    actor.selectedCard = card;
    if (state.players.every((player) => player.selectedCard != null)) revealSelections(state,now);
    return;
  }
  if (type === "chooseRow") {
    if (state.phase !== "choosingRow" || state.pendingPlayerId !== actor.id) throw new GameRuleError("row_choice_unavailable", "当前不需要你选择牌列。", 409);
    const rowIndex = Number(action.rowIndex);
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= ROW_COUNT) throw new GameRuleError("invalid_row", "牌列编号无效。");
    chooseRow(state,rowIndex,now);
    return;
  }
  throw new GameRuleError("unknown_action", "无法识别该游戏操作。");
}

export function handleTimeout(state, {now=Date.now(),random=Math.random}={}) {
  if (!state.deadline || now < state.deadline) return false;
  if (state.phase === "selecting") {
    for (const player of state.players) chooseRandomCard(state,player,random,now,"选牌超时");
    revealSelections(state,now);
    return true;
  }
  if (state.phase === "revealing") {
    stageNextPlay(state,now);
    return true;
  }
  if (state.phase === "placing") {
    commitAnimation(state,now);
    return true;
  }
  if (state.phase === "choosingRow") {
    const rowIndex = randomIndex(state.rows.length,random);
    addLog(state,`${playerById(state,state.pendingPlayerId).name} 选列超时，系统随机选择了第 ${rowIndex + 1} 列`,now);
    chooseRow(state,rowIndex,now);
    return true;
  }
  if (state.phase === "turnEnding") {
    finishTurn(state,now);
    return true;
  }
  return false;
}

export function getDeadline(state) { return Number(state.deadline) || 0; }

export function buildView(state, viewerId) {
  const viewer = requireActor(state,viewerId);
  return {
    selfId:viewer.id,phase:state.phase,capacity:state.capacity,round:state.round,turn:state.turn,
    rows:state.rows.map((row) => [...row]),
    revealedPlays:state.revealedPlays.map((play) => ({...play})),
    pendingPlayerId:state.pendingPlayerId,pendingCard:state.pendingCard,
    animation:state.animation ? {...state.animation,capturedCards:[...state.animation.capturedCards]} : null,
    deadline:state.deadline,logs:state.logs.map((entry) => ({...entry})),winners:[...state.winners],
    players:state.players.map((player) => ({
      id:player.id,name:player.name,isHost:player.isHost,connected:player.connected,
      score:player.score,captured:[...player.captured],hand:player.id === viewer.id ? [...player.hand] : player.hand.map(() => null),
      hasSelected:player.selectedCard != null,selectedCard:player.id === viewer.id ? player.selectedCard : null
    })),
    permissions:{
      canManage:viewer.isHost,canKick:viewer.isHost,
      canSetCapacity:viewer.isHost && state.phase === "lobby",
      canStart:viewer.isHost && (state.phase === "lobby" || state.phase === "roundEnd"),
      canEnd:viewer.isHost && state.phase !== "lobby",
      canSelect:state.phase === "selecting" && viewer.selectedCard == null,
      canChooseRow:state.phase === "choosingRow" && state.pendingPlayerId === viewer.id
    }
  };
}

export function serializeState(state) { return structuredClone(state); }

export function restoreState(serializedState) {
  if (serializedState?.stateVersion !== STATE_VERSION) throw new Error(`Unsupported game6 state version: ${serializedState?.stateVersion}`);
  const state = structuredClone(serializedState);
  state.revealedPlays ||= [];
  state.animation ??= null;
  state.animationSequence ||= 0;
  // Compatibility with the first protocol-v3 snapshot format. It never persisted
  // an automatic animation, so only a pending row choice needs reconstruction.
  if (state.phase === "choosingRow" && !state.revealedPlays.length) {
    const sorted = state.players
      .filter((player) => player.selectedCard != null)
      .map((player) => ({playerId:player.id,card:player.selectedCard,status:"done"}))
      .sort((left,right) => left.card-right.card);
    const pendingIndex = sorted.findIndex((play) => play.playerId === state.pendingPlayerId && play.card === state.pendingCard);
    if (pendingIndex >= 0) sorted[pendingIndex].status = "choosing";
    for (const queued of state.playQueue || []) {
      const play = sorted.find((item) => item.playerId === queued.playerId && item.card === queued.card);
      if (play) play.status = "waiting";
    }
    state.revealedPlays = sorted;
  }
  return state;
}
