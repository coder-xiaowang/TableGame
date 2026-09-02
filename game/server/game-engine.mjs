import {
  TOPICS,
  createDerangement,
  normalizeSubmission,
  normalizeWord,
  shuffle,
  uniqueTopicWords
} from "../rules.mjs";

export const ACTION_SECONDS = 0;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 32;
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

function cleanName(value, fallback = "玩家") {
  return String(value ?? "").trim().slice(0, 12) || fallback;
}

function assertCapacity(capacity) {
  const value = Number(capacity);
  if (!Number.isInteger(value) || value < MIN_PLAYERS || value > MAX_PLAYERS) {
    throw new GameRuleError("invalid_capacity", `房间人数上限必须为 ${MIN_PLAYERS}–${MAX_PLAYERS}。`);
  }
  return value;
}

function makePlayer({ id, name, isHost = false, connected = false }) {
  if (!id) throw new GameRuleError("player_id_required", "缺少玩家身份。");
  return {
    id: String(id),
    name: cleanName(name, isHost ? "房主" : "玩家"),
    isHost: Boolean(isHost),
    connected: Boolean(connected),
    word: "",
    trapWord: "",
    wordExtra: "",
    status: "waiting"
  };
}

function requireHost(state, actorId) {
  const actor = state.players.find((player) => player.id === String(actorId));
  if (!actor?.isHost) throw new GameRuleError("host_required", "只有房主可以执行此操作。", 403);
  return actor;
}

function addLog(state, entry) {
  state.log.unshift({ id:`log_${state.logSequence += 1}`, ...entry });
  if (state.log.length > 200) state.log.length = 200;
}

function activePlayers(state) {
  return state.players.filter((player) => player.status === "playing" && player.connected);
}

function currentPlayer(state) {
  return state.phase === "playing"
    ? state.players.find((player) => player.id === state.currentPlayerId) || null
    : null;
}

function questionComplete(state) {
  const question = state.currentQuestion;
  if (!question) return false;
  return activePlayers(state)
    .filter((player) => player.id !== question.askerId)
    .every((player) => Boolean(question.answers[player.id]));
}

function finishWithLastPlayer(state) {
  if (state.phase !== "playing") return false;
  const active = activePlayers(state);
  if (active.length > 1) return false;
  if (active.length === 1) {
    active[0].status = "left";
    addLog(state, {
      playerId:active[0].id,
      text:`${active[0].name} 留到最后，游戏结束。`,
      detail:"所有其他玩家已经猜中、出局或离线。"
    });
  }
  state.phase = "ended";
  state.currentPlayerId = "";
  state.currentQuestion = null;
  state.turnQuestionAsked = false;
  return true;
}

function chooseNextPlayer(state, afterPlayerId, originIndexOverride = null) {
  const active = activePlayers(state);
  if (active.length <= 1) return finishWithLastPlayer(state);
  const originIndex = Number.isInteger(originIndexOverride)
    ? originIndexOverride
    : state.players.findIndex((player) => player.id === afterPlayerId);
  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const nextIndex = (originIndex + offset + state.players.length) % state.players.length;
    const candidate = state.players[nextIndex];
    if (!active.some((player) => player.id === candidate.id)) continue;
    if (nextIndex <= originIndex) state.round += 1;
    state.currentPlayerId = candidate.id;
    state.currentQuestion = null;
    state.turnQuestionAsked = false;
    return false;
  }
  return finishWithLastPlayer(state);
}

function resetToLobby(state) {
  state.phase = "lobby";
  state.submittedEntries = {};
  state.currentPlayerId = "";
  state.round = 0;
  state.turnQuestionAsked = false;
  state.currentQuestion = null;
  state.log = [];
  state.logSequence = 0;
  state.winners = [];
  for (const player of state.players) {
    player.word = "";
    player.trapWord = "";
    player.wordExtra = "";
    player.status = "waiting";
  }
}

function startPlaying(state, now, description) {
  state.phase = "playing";
  state.round = 1;
  state.currentPlayerId = activePlayers(state)[0]?.id || "";
  state.turnQuestionAsked = false;
  state.currentQuestion = null;
  addLog(state, { playerId:null, text:description.text, detail:description.detail, at:now });
  finishWithLastPlayer(state);
}

function assignSubmittedWords(state, random, now) {
  const sourceOrder = createDerangement(state.players.length, random);
  state.players.forEach((player, targetIndex) => {
    const source = state.players[sourceOrder[targetIndex]];
    const entry = state.submittedEntries[source.id];
    player.word = entry.word;
    player.trapWord = entry.trapWord;
    player.wordExtra = entry.extra;
    player.status = "playing";
  });
  startPlaying(state, now, {
    text:"词语已分配，游戏开始。",
    detail:state.playerWordMode === "trap"
      ? "每位玩家拿到的答案和陷阱词都不是自己提交的；猜中陷阱词会立即出局。"
      : "每位玩家拿到的都不是自己提交的词。"
  });
}

function cloneQuestion(question) {
  if (!question) return null;
  return { ...question, answers:{ ...question.answers } };
}

function cloneLog(entry) {
  const cloned = { ...entry };
  if (entry.answers) {
    cloned.answers = Object.fromEntries(Object.entries(entry.answers).map(([id, answer]) => [id, { ...answer }]));
  }
  return cloned;
}

function noticeFor(state) {
  if (state.phase === "lobby") {
    if (state.gameMode !== "playerWords") return "等待玩家落座，房主开始后会自动分配同主题词语。";
    return state.playerWordMode === "trap"
      ? "等待玩家落座，房主开始后每位玩家提交一个正确答案和一个陷阱词。"
      : "等待玩家落座，房主开始后每位玩家提交一个词语。";
  }
  if (state.phase === "collectingWords") {
    return `正在收集词语：${Object.keys(state.submittedEntries).length}/${state.players.length} 名玩家已提交。`;
  }
  if (state.phase === "ended") return "游戏结束。";
  const current = currentPlayer(state);
  if (!current) return "等待下一轮。";
  if (state.currentQuestion) return `${current.name} 正在等待其他玩家回答。`;
  if (state.turnQuestionAsked) return `轮到 ${current.name} 猜词或跳过。`;
  return `轮到 ${current.name} 提问或猜词。`;
}

export function createLobby({ capacity, host }) {
  return {
    stateVersion:STATE_VERSION,
    phase:"lobby",
    capacity:assertCapacity(capacity),
    gameMode:"library",
    wordExtraMode:"none",
    playerWordMode:"single",
    topic:Object.keys(TOPICS)[0],
    submittedEntries:{},
    players:[makePlayer({ ...host, isHost:true })],
    currentPlayerId:"",
    round:0,
    turnQuestionAsked:false,
    currentQuestion:null,
    log:[],
    logSequence:0,
    winners:[]
  };
}

export function addPlayer(state, player) {
  if (state.phase !== "lobby") throw new GameRuleError("game_started", "游戏已经开始，无法中途加入。", 409);
  if (state.players.length >= state.capacity) throw new GameRuleError("room_full", "房间人数已满。", 409);
  if (state.players.some((item) => item.id === String(player.id))) throw new GameRuleError("player_exists", "该玩家已经在房间中。", 409);
  const next = makePlayer(player);
  state.players.push(next);
  return next;
}

export function removePlayer(state, actorId, playerId, { now = Date.now(), random = Math.random } = {}) {
  requireHost(state, actorId);
  const index = state.players.findIndex((player) => player.id === String(playerId));
  const target = state.players[index];
  if (!target || target.isHost) throw new GameRuleError("invalid_kick_target", "无法移出该玩家。");
  const wasCurrent = state.currentPlayerId === target.id;
  const wasAsker = state.currentQuestion?.askerId === target.id;
  state.players.splice(index, 1);
  delete state.submittedEntries[target.id];
  state.winners = state.winners.filter((id) => id !== target.id);
  if (state.phase === "collectingWords" && state.players.length >= 2
    && state.players.every((player) => state.submittedEntries[player.id])) {
    assignSubmittedWords(state, random, now);
  }
  if (state.phase === "playing") {
    if (wasAsker) {
      state.currentQuestion = null;
      state.turnQuestionAsked = false;
    } else if (questionComplete(state)) {
      state.currentQuestion = null;
    }
    // The target has already been removed. Starting immediately before its old
    // slot preserves the original seating order and round-wrap semantics.
    if (!finishWithLastPlayer(state) && wasCurrent) chooseNextPlayer(state, target.id, index - 1);
  }
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
    throw new GameRuleError("invalid_seat_change", "房主必须留在玩家席。", 403);
  }
  state.players.splice(index, 1);
  return target;
}

export function setPresence(state, playerId, connected) {
  const player = state.players.find((item) => item.id === String(playerId));
  if (!player || player.connected === Boolean(connected)) return false;
  player.connected = Boolean(connected);
  if (state.phase === "playing" && !connected) {
    const wasCurrent = state.currentPlayerId === player.id;
    if (state.currentQuestion?.askerId === player.id) {
      state.currentQuestion = null;
      state.turnQuestionAsked = false;
    } else if (questionComplete(state)) {
      state.currentQuestion = null;
    }
    if (!finishWithLastPlayer(state) && wasCurrent) chooseNextPlayer(state, player.id);
  }
  return true;
}

export function applyAction(state, actorId, action, { now = Date.now(), random = Math.random } = {}) {
  const id = String(actorId);
  const actor = state.players.find((player) => player.id === id);
  if (!actor) throw new GameRuleError("not_a_player", "你不属于这个房间。", 403);
  const type = action?.type;

  if (type === "configure") {
    requireHost(state, id);
    if (state.phase !== "lobby") throw new GameRuleError("game_started", "游戏开始后不能修改模式。", 409);
    const gameMode = String(action.gameMode || "");
    const wordExtraMode = String(action.wordExtraMode || "none");
    const playerWordMode = String(action.playerWordMode || "single");
    const topic = String(action.topic || "");
    if (!["library","playerWords"].includes(gameMode)) throw new GameRuleError("invalid_game_mode", "出词模式无效。");
    if (!["none","forbidden","hint"].includes(wordExtraMode)) throw new GameRuleError("invalid_extra_mode", "附加规则无效。");
    if (!["single","trap"].includes(playerWordMode)) throw new GameRuleError("invalid_word_mode", "玩家出词玩法无效。");
    if (gameMode === "library" && !TOPICS[topic]) throw new GameRuleError("invalid_topic", "词库主题无效。");
    if (playerWordMode === "trap" && wordExtraMode === "hint") throw new GameRuleError("incompatible_modes", "陷阱词模式不能使用开局提示。", 409);
    state.gameMode = gameMode;
    state.wordExtraMode = gameMode === "playerWords" ? wordExtraMode : "none";
    state.playerWordMode = gameMode === "playerWords" ? playerWordMode : "single";
    state.topic = gameMode === "library" ? topic : "";
    return;
  }

  if (type === "start") {
    requireHost(state, id);
    if (state.phase !== "lobby") throw new GameRuleError("already_started", "游戏已经开始。", 409);
    if (state.players.length < MIN_PLAYERS) throw new GameRuleError("players_missing", "至少需要 2 名玩家。", 409);
    if (state.players.some((player) => !player.connected)) throw new GameRuleError("players_offline", "所有玩家在线后才能开始。", 409);
    state.submittedEntries = {};
    state.log = [];
    state.logSequence = 0;
    state.winners = [];
    if (state.gameMode === "playerWords") {
      state.phase = "collectingWords";
      return;
    }
    const words = shuffle(uniqueTopicWords(state.topic), random);
    if (words.length < state.players.length) throw new GameRuleError("topic_too_small", "当前词库不够分配所有玩家。", 409);
    state.players.forEach((player, index) => {
      player.word = words[index];
      player.trapWord = "";
      player.wordExtra = "";
      player.status = "playing";
    });
    startPlaying(state, now, {
      text:`游戏开始，主题是「${state.topic}」。`,
      detail:"每个人都能看到别人额头上的词，但看不到自己的词。"
    });
    return;
  }

  if (type === "end") {
    requireHost(state, id);
    if (state.phase === "lobby") throw new GameRuleError("game_not_started", "游戏尚未开始。", 409);
    resetToLobby(state);
    return;
  }

  if (type === "submitWord") {
    if (state.phase !== "collectingWords") throw new GameRuleError("not_collecting_words", "当前不在收集词语。", 409);
    if (!actor.connected) throw new GameRuleError("not_active", "重新连接房间后才能提交词语。", 409);
    let entry;
    try {
      entry = normalizeSubmission(action, state);
    } catch (error) {
      throw new GameRuleError("invalid_submission", error.message, 409);
    }
    state.submittedEntries[id] = entry;
    if (state.players.every((player) => state.submittedEntries[player.id])) assignSubmittedWords(state, random, now);
    return;
  }

  if (state.phase !== "playing") throw new GameRuleError("game_not_playing", "游戏当前不在进行中。", 409);
  if (actor.status !== "playing" || !actor.connected) {
    throw new GameRuleError("not_active", "你当前不在可行动的在线玩家中。", 409);
  }
  const current = currentPlayer(state);
  if (!current) throw new GameRuleError("no_current_player", "当前没有可行动玩家。", 409);

  if (type === "question") {
    if (current.id !== id) throw new GameRuleError("not_your_turn", "现在还没有轮到你。", 409);
    if (state.currentQuestion || state.turnQuestionAsked) throw new GameRuleError("question_unavailable", "本回合已经不能继续提问。", 409);
    const text = String(action.text || "").trim().slice(0, 200);
    if (!text) throw new GameRuleError("question_required", "问题不能为空。", 409);
    const questionId = `question_${state.logSequence + 1}`;
    state.turnQuestionAsked = true;
    state.currentQuestion = { id:questionId, askerId:id, askerName:actor.name, text, answers:{} };
    addLog(state, {
      type:"question", questionId, playerId:id,
      text:`${actor.name} 提问：${text}`,
      wordExtraMode:state.wordExtraMode,
      wordExtra:actor.wordExtra,
      answers:{}, at:now
    });
    return;
  }

  if (type === "answer") {
    const question = state.currentQuestion;
    if (!question || question.askerId === id) throw new GameRuleError("answer_unavailable", "当前没有需要你回答的问题。", 409);
    if (actor.status !== "playing" || !actor.connected) throw new GameRuleError("not_active", "你当前不能回答。", 409);
    if (question.answers[id]) throw new GameRuleError("already_answered", "你已经回答过这个问题。", 409);
    const answer = String(action.answer);
    if (!["yes","no","maybe"].includes(answer)) throw new GameRuleError("invalid_answer", "回答选项无效。");
    question.answers[id] = answer;
    const questionLog = state.log.find((entry) => entry.questionId === question.id);
    if (questionLog) questionLog.answers[id] = { playerName:actor.name, answer };
    if (questionComplete(state)) state.currentQuestion = null;
    return;
  }

  if (type === "guess") {
    if (current.id !== id) throw new GameRuleError("not_your_turn", "现在还没有轮到你。", 409);
    if (state.currentQuestion) throw new GameRuleError("question_pending", "请等待其他玩家完成回答。", 409);
    const guess = String(action.text || "").trim().slice(0, 30);
    if (!guess) throw new GameRuleError("guess_required", "猜词不能为空。", 409);
    const correct = normalizeWord(guess) === normalizeWord(actor.word);
    const hitTrap = state.playerWordMode === "trap" && normalizeWord(guess) === normalizeWord(actor.trapWord);
    if (correct) {
      actor.status = "won";
      state.winners.push(actor.id);
      addLog(state, { playerId:id, text:`${actor.name} 猜中了：${actor.word}`, detail:`名次：第 ${state.winners.length} 名`, at:now });
    } else if (hitTrap) {
      actor.status = "eliminated";
      addLog(state, { playerId:id, text:`${actor.name} 猜中了陷阱词：${actor.trapWord}`, detail:"触发陷阱，立即出局。", at:now });
    } else {
      addLog(state, { playerId:id, text:`${actor.name} 猜错了：${guess}`, detail:"游戏继续，轮到下一位玩家。", at:now });
    }
    chooseNextPlayer(state, id);
    return;
  }

  if (type === "skip") {
    if (current.id !== id) throw new GameRuleError("not_your_turn", "现在还没有轮到你。", 409);
    if (state.currentQuestion) throw new GameRuleError("question_pending", "请等待其他玩家完成回答。", 409);
    addLog(state, { playerId:id, text:`${actor.name} 选择跳过`, detail:"信息不足，轮到下一位玩家。", at:now });
    chooseNextPlayer(state, id);
    return;
  }

  throw new GameRuleError("unknown_action", "无法识别该游戏操作。");
}

export function handleTimeout() { return false; }
export function getDeadline() { return 0; }

function buildPublicView(state, { viewer = null, revealWords = false, permissions }) {
  const current = currentPlayer(state);
  return {
    selfId:viewer?.id || null,
    phase:state.phase,
    capacity:state.capacity,
    gameMode:state.gameMode,
    wordExtraMode:state.wordExtraMode,
    playerWordMode:state.playerWordMode,
    topic:state.topic,
    round:state.round,
    turnQuestionAsked:state.turnQuestionAsked,
    players:state.players.map((player) => ({
      id:player.id, name:player.name, status:player.status, connected:player.connected,
      isHost:player.isHost, isCurrent:current?.id === player.id
    })),
    submittedPlayerIds:Object.keys(state.submittedEntries),
    words:state.players.map((player) => ({
      id:player.id,
      name:player.name,
      word:revealWords && player.id !== viewer?.id ? player.word : null,
      trapWord:revealWords && player.id !== viewer?.id ? player.trapWord : null,
      extra:player.wordExtra,
      status:player.status
    })),
    currentQuestion:cloneQuestion(state.currentQuestion),
    log:state.log.map(cloneLog),
    winners:[...state.winners],
    notice:noticeFor(state),
    permissions
  };
}

export function buildView(state, viewerId) {
  const viewer = state.players.find((player) => player.id === String(viewerId));
  if (!viewer) throw new GameRuleError("not_a_player", "你不属于这个房间。", 403);
  return buildPublicView(state, {
    viewer,
    revealWords:true,
    permissions:{
      canManage:viewer.isHost,
      canKick:viewer.isHost,
      canConfigure:viewer.isHost && state.phase === "lobby",
      canStart:viewer.isHost && state.phase === "lobby",
      canEnd:viewer.isHost && state.phase !== "lobby"
    }
  });
}

export function buildSpectatorView(state) {
  return buildPublicView(state, {
    viewer:null,
    revealWords:false,
    permissions:{canManage:false,canKick:false,canConfigure:false,canStart:false,canEnd:false}
  });
}

export function serializeState(state) { return structuredClone(state); }
export function restoreState(serializedState) {
  if (serializedState?.stateVersion !== STATE_VERSION) {
    throw new Error(`Unsupported game state version: ${serializedState?.stateVersion}`);
  }
  return structuredClone(serializedState);
}
