import {
  PLAYER_COUNTS,
  createIdiomDeck,
  drawIdiom,
  normalizeText,
  roleForSeat,
  teamIndexForSeat
} from "../rules.mjs";

export const ACTION_SECONDS = 0;
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

function assertCapacity(capacity) {
  const value = Number(capacity);
  if (!PLAYER_COUNTS.includes(value)) {
    throw new GameRuleError("invalid_capacity", "人数必须为 2、4、6 或 8。", 400);
  }
  return value;
}

function cleanName(value, fallback = "玩家") {
  return String(value ?? "").trim().slice(0, 12) || fallback;
}

function makePlayer({ id, name, isHost = false, connected = false }) {
  if (!id) throw new GameRuleError("player_id_required", "缺少玩家身份。");
  return {
    id:String(id),
    name:cleanName(name, isHost ? "房主" : "玩家"),
    isHost:Boolean(isHost),
    connected:Boolean(connected),
    seatIndex:null
  };
}

function playerById(state, playerId) {
  return state.players.find((player) => player.id === String(playerId)) || null;
}

function requireActor(state, actorId) {
  const actor = playerById(state, actorId);
  if (!actor) throw new GameRuleError("not_a_player", "你不属于这个房间。", 403);
  return actor;
}

function requireHost(state, actorId) {
  const actor = requireActor(state, actorId);
  if (!actor.isHost) throw new GameRuleError("host_required", "只有房主可以执行此操作。", 403);
  return actor;
}

function addLog(state, entry) {
  state.log.unshift({ id:`log_${state.logSequence += 1}`, ...entry });
  if (state.log.length > 200) state.log.length = 200;
}

function seats(state) {
  const occupants = new Map(state.players
    .filter((player) => Number.isInteger(player.seatIndex))
    .map((player) => [player.seatIndex, player.id]));
  return Array.from({length:state.capacity}, (_, index) => ({
    index,
    playerId:occupants.get(index) || null
  }));
}

function teams(state) {
  const seatList = seats(state);
  return Array.from({length:state.capacity / 2}, (_, index) => ({
    index,
    captainSeat:index * 2,
    memberSeat:index * 2 + 1,
    captainId:seatList[index * 2].playerId,
    memberId:seatList[index * 2 + 1].playerId
  }));
}

function teamReady(state, team) {
  return Boolean(
    team?.captainId
    && team.memberId
    && playerById(state, team.captainId)?.connected
    && playerById(state, team.memberId)?.connected
  );
}

function currentTeam(state) {
  return teams(state)[state.turnTeamIndex] || null;
}

function currentActorId(state) {
  if (state.phase !== "playing") return null;
  const team = currentTeam(state);
  if (!teamReady(state, team)) return null;
  return state.turnPhase === "describe" ? team.captainId : team.memberId;
}

function resetTurn(state) {
  state.turnPhase = "describe";
  state.currentDescription = "";
}

function advanceTeam(state) {
  const teamCount = state.capacity / 2;
  let next = state.turnTeamIndex;
  let roundIncrease = 0;
  for (let attempt = 0; attempt < teamCount; attempt += 1) {
    next = (next + 1) % teamCount;
    if (next === state.wordStartTeamIndex) roundIncrease += 1;
    if (!teamReady(state, teams(state)[next])) continue;
    state.turnTeamIndex = next;
    state.round += roundIncrease;
    state.waitingForReadyTeam = false;
    resetTurn(state);
    return true;
  }
  state.waitingForReadyTeam = true;
  resetTurn(state);
  return false;
}

function nextReadyTeamIndex(state, fromIndex) {
  const teamCount = state.capacity / 2;
  const list = teams(state);
  for (let offset = 1; offset <= teamCount; offset += 1) {
    const index = (fromIndex + offset) % teamCount;
    if (teamReady(state, list[index])) return index;
  }
  return fromIndex;
}

function scoreText(state) {
  return state.scores.map((score, index) => `第 ${index + 1} 队 ${score} 分`).join("，");
}

function drawNext(state, random) {
  state.idiom = drawIdiom(state.idiomDeck, state.idiom, random);
}

function startNextWord(state, random, now) {
  const previousTeamIndex = state.turnTeamIndex;
  const nextTeamIndex = nextReadyTeamIndex(state, previousTeamIndex);
  drawNext(state, random);
  state.wordNumber += 1;
  state.turnTeamIndex = nextTeamIndex;
  state.wordStartTeamIndex = nextTeamIndex;
  state.round = 1;
  state.waitingForReadyTeam = false;
  resetTurn(state);
  addLog(state, {
    playerId:null,
    teamIndex:previousTeamIndex,
    text:`第 ${previousTeamIndex + 1} 队获得 1 分，开始第 ${state.wordNumber} 题`,
    detail:`当前比分：${scoreText(state)}；由第 ${nextTeamIndex + 1} 队先行动。`,
    at:now
  });
}

function finishGame(state, now, reason = "房主结束了大局") {
  state.phase = "ended";
  state.currentDescription = "";
  state.waitingForReadyTeam = false;
  addLog(state, {
    playerId:null,
    text:reason,
    detail:`最终比分：${scoreText(state)}`,
    at:now
  });
}

function resetToLobby(state) {
  state.phase = "lobby";
  state.idiom = "";
  state.idiomDeck = [];
  state.turnTeamIndex = 0;
  state.wordStartTeamIndex = 0;
  state.turnPhase = "describe";
  state.currentDescription = "";
  state.waitingForReadyTeam = false;
  state.round = 0;
  state.wordNumber = 0;
  state.winnerTeamIndex = null;
  state.winnerGuess = "";
  state.scores = Array(state.capacity / 2).fill(0);
  state.log = [];
  state.logSequence = 0;
}

function noticeFor(state) {
  if (state.phase === "lobby") {
    const seated = state.players.filter((player) => Number.isInteger(player.seatIndex)).length;
    return `房主选择了 ${state.capacity} 人局，当前 ${seated}/${state.capacity} 人落座。相邻两席为一队，前席队长，后席队员。`;
  }
  if (state.phase === "ended") {
    const highest = Math.max(...state.scores);
    const leaders = state.scores
      .map((score, index) => score === highest ? `第 ${index + 1} 队` : "")
      .filter(Boolean);
    return `大局结束，${leaders.join("、")}${leaders.length > 1 ? "并列第一" : "获胜"}，最高 ${highest} 分。最后一题答案是「${state.idiom}」。`;
  }
  const actorId = currentActorId(state);
  if (!actorId) return "当前没有完整在线的队伍，等待玩家恢复连接。";
  const actor = playerById(state, actorId)?.name || "玩家";
  return state.turnPhase === "describe"
    ? `轮到第 ${state.turnTeamIndex + 1} 队队长 ${actor} 描述成语。`
    : `轮到第 ${state.turnTeamIndex + 1} 队队员 ${actor} 根据描述猜成语。`;
}

function turnLabelFor(state) {
  const actorId = currentActorId(state);
  if (!actorId) return state.phase === "playing" ? "等待完整队伍" : "未开始";
  const actor = playerById(state, actorId)?.name || "玩家";
  return `第 ${state.turnTeamIndex + 1} 队 ${actor} ${state.turnPhase === "describe" ? "描述" : "猜词"}`;
}

export function createLobby({ capacity, host }) {
  const playerCount = assertCapacity(capacity);
  return {
    stateVersion:STATE_VERSION,
    phase:"lobby",
    capacity:playerCount,
    players:[makePlayer({...host,isHost:true})],
    idiom:"",
    idiomDeck:[],
    turnTeamIndex:0,
    wordStartTeamIndex:0,
    turnPhase:"describe",
    currentDescription:"",
    waitingForReadyTeam:false,
    round:0,
    wordNumber:0,
    winnerTeamIndex:null,
    winnerGuess:"",
    scores:Array(playerCount / 2).fill(0),
    log:[],
    logSequence:0
  };
}

export function addPlayer(state, player) {
  if (state.phase !== "lobby") throw new GameRuleError("game_started", "大局已经开始，无法中途加入。", 409);
  if (state.players.length >= state.capacity) throw new GameRuleError("room_full", "房间人数已满。", 409);
  if (playerById(state, player.id)) throw new GameRuleError("player_exists", "该玩家已经在房间中。", 409);
  const next = makePlayer(player);
  state.players.push(next);
  return next;
}

export function removePlayer(state, actorId, playerId, {now = Date.now()} = {}) {
  requireHost(state, actorId);
  const index = state.players.findIndex((player) => player.id === String(playerId));
  const target = state.players[index];
  if (!target || target.isHost) throw new GameRuleError("invalid_kick_target", "无法移出该玩家。");
  state.players.splice(index,1);
  if (state.phase === "playing") finishGame(state,now,`房主移出了 ${target.name}，大局结束`);
  return target;
}

export function canChangeSeats(state) {
  return state.phase === "lobby";
}

export function vacateSeat(state, playerId) {
  if (!canChangeSeats(state)) {
    throw new GameRuleError("seat_change_unavailable", "大局开始后不能转入旁观席。", 409);
  }
  const index = state.players.findIndex((player) => player.id === String(playerId));
  const target = state.players[index];
  if (!target || target.isHost) {
    throw new GameRuleError("invalid_seat_change", "房主必须留在玩家席。", 403);
  }
  state.players.splice(index,1);
  return target;
}

export function setPresence(state, playerId, connected) {
  const player = playerById(state,playerId);
  if (!player || player.connected === Boolean(connected)) return false;
  player.connected = Boolean(connected);
  if (state.phase === "playing" && !teamReady(state,currentTeam(state))) {
    if (!connected) {
      // A real mid-game disconnect forfeits the incomplete team's attempt.
      advanceTeam(state);
    } else if (state.waitingForReadyTeam && Number.isInteger(player.seatIndex)) {
      // Only a prior real disconnect sets this flag. A plain process recovery
      // therefore preserves an in-progress description regardless of reconnect order.
      const reconnectedTeamIndex = teamIndexForSeat(player.seatIndex);
      if (teamReady(state,teams(state)[reconnectedTeamIndex])) {
        if (reconnectedTeamIndex === state.turnTeamIndex) state.waitingForReadyTeam = false;
        else advanceTeam(state);
      }
    }
  }
  return true;
}

export function applyAction(state, actorId, action, {now = Date.now(), random = Math.random} = {}) {
  const actor = requireActor(state,actorId);
  const type = action?.type;

  if (type === "setCapacity") {
    requireHost(state,actorId);
    if (state.phase !== "lobby") throw new GameRuleError("game_started", "大局开始后不能修改人数。", 409);
    const capacity = assertCapacity(action.capacity);
    if (capacity < state.players.length) throw new GameRuleError("capacity_too_small", "新人数不能少于当前已加入人数。", 409);
    state.capacity = capacity;
    for (const player of state.players) {
      if (player.seatIndex >= capacity) player.seatIndex = null;
    }
    state.scores = Array(capacity / 2).fill(0);
    return;
  }

  if (type === "sit") {
    if (state.phase !== "lobby") throw new GameRuleError("game_started", "大局开始后不能调整座位。", 409);
    if (!actor.connected) throw new GameRuleError("not_connected", "连接房间后才能落座。", 409);
    const seatIndex = Number(action.seatIndex);
    if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= state.capacity) {
      throw new GameRuleError("invalid_seat", "座位编号无效。");
    }
    const occupant = state.players.find((player) => player.seatIndex === seatIndex && player.id !== actor.id);
    if (occupant) throw new GameRuleError("seat_taken", "该座位已经有人。", 409);
    actor.seatIndex = seatIndex;
    return;
  }

  if (type === "leaveSeat") {
    if (state.phase !== "lobby") throw new GameRuleError("game_started", "大局开始后不能离座。", 409);
    actor.seatIndex = null;
    return;
  }

  if (type === "start") {
    requireHost(state,actorId);
    if (state.phase !== "lobby") throw new GameRuleError("already_started", "大局已经开始。", 409);
    if (state.players.length !== state.capacity || seats(state).some((seat) => !seat.playerId)) {
      throw new GameRuleError("players_missing", `需要 ${state.capacity} 名玩家全部落座。`, 409);
    }
    if (state.players.some((player) => !player.connected)) {
      throw new GameRuleError("players_offline", "所有玩家在线后才能开始。", 409);
    }
    state.phase = "playing";
    state.scores = Array(state.capacity / 2).fill(0);
    state.idiomDeck = createIdiomDeck(random);
    state.idiom = "";
    drawNext(state,random);
    state.turnTeamIndex = 0;
    state.wordStartTeamIndex = 0;
    state.round = 1;
    state.wordNumber = 1;
    state.winnerTeamIndex = null;
    state.winnerGuess = "";
    state.waitingForReadyTeam = false;
    state.log = [];
    state.logSequence = 0;
    resetTurn(state);
    addLog(state,{
      playerId:null,
      text:"大局开始",
      detail:`本局共有 ${state.capacity / 2} 队，每猜中一题得 1 分，积分持续到房主手动结束。`,
      at:now
    });
    return;
  }

  if (type === "end") {
    requireHost(state,actorId);
    if (state.phase !== "playing") throw new GameRuleError("game_not_playing", "当前没有可结束的大局。", 409);
    finishGame(state,now);
    return;
  }

  if (type === "restart") {
    requireHost(state,actorId);
    if (state.phase !== "ended") throw new GameRuleError("game_not_ended", "大局结束后才能返回大厅。", 409);
    resetToLobby(state);
    return;
  }

  if (state.phase !== "playing") throw new GameRuleError("game_not_playing", "大局当前不在进行中。", 409);
  if (!actor.connected) throw new GameRuleError("not_connected", "重新连接房间后才能行动。", 409);
  const currentId = currentActorId(state);
  if (!currentId || currentId !== actor.id) throw new GameRuleError("not_your_turn", "现在还没有轮到你。", 409);

  if (type === "describe") {
    if (state.turnPhase !== "describe") throw new GameRuleError("description_unavailable", "当前不能提交描述。", 409);
    const text = String(action.text ?? "").trim();
    if (!text || text.length > 120) throw new GameRuleError("invalid_description", "描述必须为 1–120 个字符。", 409);
    state.currentDescription = text;
    state.turnPhase = "guess";
    addLog(state,{
      playerId:actor.id,
      teamIndex:state.turnTeamIndex,
      text:`${actor.name} 描述：${text}`,
      detail:`第 ${state.turnTeamIndex + 1} 队队长提交`,
      at:now
    });
    return;
  }

  if (type === "guess") {
    if (state.turnPhase !== "guess") throw new GameRuleError("guess_unavailable", "当前不能提交猜测。", 409);
    const guess = String(action.text ?? "").trim();
    if (!guess || guess.length > 12) throw new GameRuleError("invalid_guess", "猜测必须为 1–12 个字符。", 409);
    const correct = normalizeText(guess) === normalizeText(state.idiom);
    addLog(state,{
      playerId:actor.id,
      teamIndex:state.turnTeamIndex,
      text:`${actor.name} 猜：${guess}`,
      detail:correct ? `回答正确，第 ${state.turnTeamIndex + 1} 队获得 1 分。` : "回答错误，轮到下一队。",
      at:now
    });
    if (correct) {
      state.scores[state.turnTeamIndex] += 1;
      state.winnerTeamIndex = state.turnTeamIndex;
      state.winnerGuess = guess;
      startNextWord(state,random,now);
    } else {
      advanceTeam(state);
    }
    return;
  }

  throw new GameRuleError("unknown_action", "无法识别该游戏操作。");
}

export function handleTimeout() { return false; }
export function getDeadline() { return 0; }

function buildPublicView(state, {viewer = null, showIdiom = false, permissions}) {
  const seatIndex = viewer?.seatIndex;
  const role = Number.isInteger(seatIndex) ? roleForSeat(seatIndex) : null;
  const actorId = currentActorId(state);
  return {
    selfId:viewer?.id || null,
    phase:state.phase,
    capacity:state.capacity,
    playerCount:state.capacity,
    seats:seats(state),
    players:state.players.map((player) => ({
      id:player.id,name:player.name,isHost:player.isHost,connected:player.connected,seatIndex:player.seatIndex
    })),
    mySeatIndex:Number.isInteger(seatIndex) ? seatIndex : -1,
    myRole:role,
    idiom:showIdiom ? state.idiom : "",
    idiomHidden:state.phase === "playing" && !showIdiom,
    turnTeamIndex:state.turnTeamIndex,
    turnPhase:state.turnPhase,
    currentActorId:actorId,
    currentDescription:state.currentDescription,
    round:state.round,
    winnerTeamIndex:state.winnerTeamIndex,
    winnerGuess:state.winnerGuess,
    scores:[...state.scores],
    wordNumber:state.wordNumber,
    log:state.log.map((entry) => ({...entry})),
    notice:noticeFor(state),
    turnLabel:turnLabelFor(state),
    permissions
  };
}

export function buildView(state, viewerId) {
  const viewer = requireActor(state,viewerId);
  const role = Number.isInteger(viewer.seatIndex) ? roleForSeat(viewer.seatIndex) : null;
  const actorId = currentActorId(state);
  return buildPublicView(state, {
    viewer,
    showIdiom: state.phase === "ended" || (state.phase === "playing" && role === "captain"),
    permissions:{
      canManage:viewer.isHost,
      canKick:viewer.isHost,
      canSetCapacity:viewer.isHost && state.phase === "lobby",
      canStart:viewer.isHost && state.phase === "lobby",
      canEnd:viewer.isHost && state.phase === "playing",
      canRestart:viewer.isHost && state.phase === "ended",
      canDescribe:state.phase === "playing" && actorId === viewer.id && state.turnPhase === "describe",
      canGuess:state.phase === "playing" && actorId === viewer.id && state.turnPhase === "guess"
    }
  });
}

export function buildSpectatorView(state) {
  return buildPublicView(state, {
    viewer:null,
    showIdiom:state.phase === "ended",
    permissions:{
      canManage:false,
      canKick:false,
      canSetCapacity:false,
      canStart:false,
      canEnd:false,
      canRestart:false,
      canDescribe:false,
      canGuess:false
    }
  });
}

export function serializeState(state) { return structuredClone(state); }
export function restoreState(serializedState) {
  if (serializedState?.stateVersion !== STATE_VERSION) {
    throw new Error(`Unsupported game2 state version: ${serializedState?.stateVersion}`);
  }
  return structuredClone(serializedState);
}
