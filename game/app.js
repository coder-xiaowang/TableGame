"use strict";

const topics = {
  水果蔬菜: ["西瓜","香蕉","草莓","菠萝","葡萄","芒果","椰子","柠檬","火龙果","猕猴桃","榴莲","桃子","土豆","胡萝卜","西红柿","玉米","南瓜","蘑菇"],
  食物: ["火锅","汉堡","寿司","披萨","螺蛳粉","臭豆腐","冰淇淋","烤鸭","麻辣烫","蛋炒饭","泡面","粽子","月饼","糖葫芦","榴莲","爆米花","奶茶","薯条"],
  动物: ["猫", "狗", "兔子", "熊猫", "老虎", "狮子", "长颈鹿", "大象", "猴子", "海豚","企鹅","袋鼠","章鱼","鳄鱼","孔雀","树懒","骆驼","啄木鸟","变色龙","刺猬","河马","猫头鹰","海马","鸭嘴兽"],
  交通工具: ["自行车", "公交车", "地铁", "出租车", "火车", "飞机", "轮船", "摩托车", "电动车", "高铁","救护车","热气球","滑板","缆车","潜水艇","直升机"],
  地点场所: ["医院","学校","电影院","游乐园","动物园","图书馆","超市","机场","火车站","健身房","理发店","银行","派出所","网吧","厨房","沙漠","海底","月球"],
  体育运动: ["篮球","足球","乒乓球","羽毛球","游泳","跑步","跳绳","滑雪","拳击","射箭","举重","体操","跳水","台球","排球","骑马","冲浪","拔河"],
  职业: ["医生", "老师", "厨师", "司机", "律师", "警察", "画家", "歌手", "记者", "程序员","消防员","宇航员","魔术师","摄影师","理发师","快递员","导游","裁判","侦探","飞行员","主播","保安"],
  日用品: ["牙刷", "水杯", "雨伞", "钥匙", "书包", "手机", "眼镜", "毛巾", "台灯", "拖鞋","吹风机","遥控器","充电宝","垃圾桶","剪刀","镜子","枕头","闹钟","手电筒","钥匙","行李箱","保温杯","订书机","体重秤"],
  影视动漫角色:["孙悟空","猪八戒","哪吒","葫芦娃","黑猫警长","柯南","哆啦A梦","蜡笔小新","奥特曼","蜘蛛侠","钢铁侠","蝙蝠侠","灭霸","哈利·波特","白雪公主","灰太狼","海绵宝宝","唐老鸭","范德彪","马大帅"]
};

let mode = "host";
let selfId = "";
let state = null;
let guestView = null;
let hostTopic = "水果";
let hostGameMode = "library";
let hostWordExtraMode = "none";
let hostPlayerWordMode = "single";
let roomCode = "";
let hostClientId = "";
let resumeToken = "";
let signalEvents = null;
let logPlayerFilter = "all";

const $ = (id) => document.getElementById(id);

const elements = {
  connectionStatus: $("connectionStatus"),
  setupPanel: $("setupPanel"),
  roomPanel: $("roomPanel"),
  hostModeButton: $("hostModeButton"),
  guestModeButton: $("guestModeButton"),
  hostSetup: $("hostSetup"),
  guestSetup: $("guestSetup"),
  hostNameInput: $("hostNameInput"),
  guestNameInput: $("guestNameInput"),
  gameModeSelect: $("gameModeSelect"),
  topicSelectLabel: $("topicSelectLabel"),
  topicSelect: $("topicSelect"),
  wordExtraModeLabel: $("wordExtraModeLabel"),
  wordExtraModeSelect: $("wordExtraModeSelect"),
  playerWordModeLabel: $("playerWordModeLabel"),
  playerWordModeSelect: $("playerWordModeSelect"),
  createRoomButton: $("createRoomButton"),
  roomCodeInput: $("roomCodeInput"),
  joinRoomButton: $("joinRoomButton"),
  hostTools: $("hostTools"),
  roomCodeDisplay: $("roomCodeDisplay"),
  startGameButton: $("startGameButton"),
  endGameButton: $("endGameButton"),
  playerList: $("playerList"),
  gameNotice: $("gameNotice"),
  wordBoard: $("wordBoard"),
  turnTitle: $("turnTitle"),
  roundBadge: $("roundBadge"),
  actionArea: $("actionArea"),
  logPlayerFilter: $("logPlayerFilter"),
  logList: $("logList")
};

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function sessionStorageKey(code) {
  return `tablegame:guess-word:${code}`;
}

function loadSavedSession(code) {
  try {
    return JSON.parse(localStorage.getItem(sessionStorageKey(code)) || "null");
  } catch {
    return null;
  }
}

function saveSession(name) {
  localStorage.setItem(sessionStorageKey(roomCode), JSON.stringify({ playerId: selfId, resumeToken, name }));
}

function clearSavedSession() {
  if (roomCode) localStorage.removeItem(sessionStorageKey(roomCode));
}

function normalizeWord(value) {
  return value.trim().replace(/\s+/g, "").toLowerCase();
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function createDerangement(size) {
  let order = Array.from({ length: size }, (_, index) => index);
  do {
    order = shuffle(order);
  } while (order.some((sourceIndex, targetIndex) => sourceIndex === targetIndex));
  return order;
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return response.json();
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config", { cache: "no-store" });
    if (!response.ok) return;
    elements.connectionStatus.textContent = "服务器中继可用";
  } catch {
    // Direct file opening can still render the page, but room codes need the server.
  }
}

function openSignalEvents(clientId) {
  if (signalEvents) signalEvents.close();
  signalEvents = new EventSource(`/api/events?clientId=${encodeURIComponent(clientId)}&roomCode=${encodeURIComponent(roomCode)}&resumeToken=${encodeURIComponent(resumeToken)}`);
  signalEvents.addEventListener("signal", (event) => {
    handleSignal(JSON.parse(event.data));
  });
  signalEvents.addEventListener("open", () => {
    if (mode === "host" && roomCode) {
      elements.connectionStatus.textContent = `房间 ${roomCode} 等待加入`;
    } else if (mode === "guest" && roomCode) {
      elements.connectionStatus.textContent = `已连接房间 ${roomCode}`;
    }
  });
  signalEvents.addEventListener("error", () => {
    elements.connectionStatus.textContent = signalEvents.readyState === EventSource.CONNECTING
      ? "信令服务重连中"
      : "信令服务未连接";
  });
}

async function sendSignal(to, payload) {
  await postJson("/api/signal", {
    roomCode,
    from: selfId,
    resumeToken,
    to,
    payload
  });
}

async function handleSignal(message) {
  const payload = message.payload;
  if (mode === "host" && payload?.kind === "hello") {
    upsertRemotePlayer(payload.playerId, payload.name);
    renderAndBroadcast();
    return;
  }
  if (mode === "host" && payload?.kind === "action") {
    applyPlayerAction(message.from, payload.action);
    return;
  }
  if (mode === "host" && payload?.kind === "presence") {
    updatePlayerPresence(payload.playerId, payload.connected);
    return;
  }
  if (payload?.kind === "kicked") {
    clearSavedSession();
    signalEvents?.close();
    alert("你已被房主移出房间。");
    location.reload();
    return;
  }
  if (mode === "guest" && payload?.kind === "view") {
    guestView = payload.view;
    render();
  }
}

function broadcastViews() {
  if (mode !== "host" || !state) return;
  for (const player of state.players) {
    if (player.id === selfId) continue;
    sendSignal(player.id, { kind: "view", view: buildView(player.id) }).catch(() => {
      const remote = state.players.find((item) => item.id === player.id);
      if (remote) updatePlayerPresence(player.id, false);
    });
  }
}

function buildView(viewerId) {
  const current = getCurrentPlayer();
  return {
    selfId: viewerId,
    phase: state.phase,
    gameMode: state.gameMode,
    wordExtraMode: state.wordExtraMode,
    playerWordMode: state.playerWordMode,
    topic: state.topic,
    round: state.round,
    turnQuestionAsked: state.turnQuestionAsked,
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      status: player.status,
      connected: player.connected,
      isHost: player.isHost,
      isCurrent: current?.id === player.id
    })),
    submittedPlayerIds: Object.keys(state.submittedEntries || {}),
    words: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      word: player.id === viewerId ? null : player.word,
      trapWord: player.id === viewerId ? null : player.trapWord,
      extra: player.wordExtra,
      status: player.status
    })),
    currentQuestion: state.currentQuestion,
    log: state.log,
    winners: state.winners,
    notice: getNotice()
  };
}

function currentView() {
  if (mode === "host") return state ? buildView(selfId) : null;
  return guestView;
}

function getActivePlayers() {
  return state.players.filter((player) => player.status === "playing" && player.connected);
}

function finishIfInsufficientPlayers() {
  if (state.phase !== "playing" || getActivePlayers().length > 1) return false;
  state.phase = "ended";
  state.currentQuestion = null;
  return true;
}

function keepCurrentPlayer(currentId) {
  const index = getActivePlayers().findIndex((player) => player.id === currentId);
  if (index >= 0) state.turnIndex = index;
}

function moveTurnPast(playerId) {
  const active = getActivePlayers();
  const playerIndex = state.players.findIndex((player) => player.id === playerId);
  for (let offset = 1; active.length && offset <= state.players.length; offset += 1) {
    const candidate = state.players[(playerIndex + offset) % state.players.length];
    const activeIndex = active.findIndex((player) => player.id === candidate?.id);
    if (activeIndex >= 0) {
      state.turnIndex = activeIndex;
      return;
    }
  }
}

function updatePlayerPresence(playerId, connected) {
  if (!state || playerId === selfId) return;
  const player = state.players.find((item) => item.id === playerId);
  if (!player || player.connected === connected) return;
  const currentId = getCurrentPlayer()?.id;
  player.connected = connected;
  if (!connected && state.phase === "playing") {
    if (state.currentQuestion?.askerId === playerId) {
      state.currentQuestion = null;
      state.turnQuestionAsked = false;
    } else if (isQuestionComplete()) {
      state.currentQuestion = null;
    }
    if (currentId === playerId) moveTurnPast(playerId);
    else keepCurrentPlayer(currentId);
    finishIfInsufficientPlayers();
  } else if (connected) {
    keepCurrentPlayer(currentId);
  }
  renderAndBroadcast();
}

function getCurrentPlayer() {
  if (!state || state.phase !== "playing") return null;
  const active = getActivePlayers();
  if (active.length === 0) return null;
  return active[state.turnIndex % active.length];
}

function getNotice() {
  if (!state) return "还没有创建房间。";
  if (state.phase === "lobby") {
    return state.gameMode === "playerWords"
      ? state.playerWordMode === "trap"
        ? "等待玩家落座，房主开始后每位玩家提交一个正确答案和一个陷阱词。"
        : "等待玩家落座，房主开始后每位玩家提交一个词语。"
      : "等待玩家落座，房主开始后会自动分配同主题词语。";
  }
  if (state.phase === "collectingWords") {
    const submittedCount = Object.keys(state.submittedEntries).length;
    return `正在收集词语：${submittedCount}/${state.players.length} 名玩家已提交。`;
  }
  if (state.phase === "ended") return "游戏结束。";
  const current = getCurrentPlayer();
  if (!current) return "等待下一轮。";
  if (state.currentQuestion) return `${current.name} 正在等待其他玩家回答。`;
  if (state.turnQuestionAsked) return `轮到 ${current.name} 猜词或跳过。`;
  return `轮到 ${current.name} 提问或猜词。`;
}

function setMode(nextMode) {
  mode = nextMode;
  elements.hostModeButton.classList.toggle("active", mode === "host");
  elements.guestModeButton.classList.toggle("active", mode === "guest");
  elements.hostSetup.classList.toggle("hidden", mode !== "host");
  elements.guestSetup.classList.toggle("hidden", mode !== "guest");
  elements.connectionStatus.textContent = mode === "host" ? "准备开房" : "准备加入";
}

function enterRoom() {
  elements.setupPanel.classList.add("hidden");
  elements.roomPanel.classList.remove("hidden");
  elements.hostTools.classList.toggle("hidden", mode !== "host");
}

async function createRoom() {
  selfId = uid("host");
  hostTopic = elements.topicSelect.value;
  hostGameMode = elements.gameModeSelect.value;
  hostWordExtraMode = hostGameMode === "playerWords" ? elements.wordExtraModeSelect.value : "none";
  hostPlayerWordMode = hostGameMode === "playerWords" ? elements.playerWordModeSelect.value : "single";
  if (hostPlayerWordMode === "trap" && hostWordExtraMode === "hint") {
    hostWordExtraMode = "none";
  }
  state = {
    phase: "lobby",
    gameMode: hostGameMode,
    wordExtraMode: hostWordExtraMode,
    playerWordMode: hostPlayerWordMode,
    topic: hostTopic,
    submittedEntries: {},
    players: [{
      id: selfId,
      name: elements.hostNameInput.value.trim() || "房主",
      word: "",
      trapWord: "",
      wordExtra: "",
      status: "waiting",
      connected: true,
      isHost: true
    }],
    turnIndex: 0,
    round: 0,
    turnQuestionAsked: false,
    currentQuestion: null,
    log: [],
    winners: []
  };
  try {
    const result = await postJson("/api/rooms", { hostId: selfId, name: state.players[0].name });
    roomCode = result.roomCode;
    resumeToken = result.resumeToken;
    elements.roomCodeDisplay.textContent = roomCode;
    openSignalEvents(selfId);
    elements.connectionStatus.textContent = `房间 ${roomCode} 已创建`;
    enterRoom();
    render();
  } catch {
    alert("无法创建房间号。请用 signal-server.js 启动网页，而不是直接打开 HTML 文件。");
  }
}

async function joinRoom() {
  roomCode = elements.roomCodeInput.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(roomCode)) {
    alert("请输入 4 位字母数字房间号。");
    return;
  }
  const savedSession = loadSavedSession(roomCode);
  selfId = savedSession?.playerId || uid("guest");
  let room;
  try {
    room = await postJson("/api/join", {
      roomCode,
      clientId: selfId,
      resumeToken: savedSession?.resumeToken,
      name: savedSession ? "" : (elements.guestNameInput.value.trim() || "玩家")
    });
  } catch {
    alert("没有找到这个房间号，或信令服务未启动。");
    return;
  }
  selfId = room.clientId;
  resumeToken = room.resumeToken;
  hostClientId = room.hostId;
  openSignalEvents(selfId);
  await sendSignal(hostClientId, {
    kind: "hello",
    playerId: selfId,
    name: savedSession?.name || elements.guestNameInput.value.trim() || "玩家",
    resumed: room.resumed
  });
  saveSession(savedSession?.name || elements.guestNameInput.value.trim() || "玩家");
  elements.connectionStatus.textContent = `已加入 ${roomCode}`;
  enterRoom();
  render();
}

function upsertRemotePlayer(playerId, name) {
  const currentId = getCurrentPlayer()?.id;
  let player = state.players.find((item) => item.id === playerId);
  if (!player && state.phase !== "lobby") return;
  if (!player) {
    player = {
      id: playerId,
      name: name || "玩家",
      word: "",
      trapWord: "",
      wordExtra: "",
      status: "waiting",
      connected: true,
      isHost: false
    };
    state.players.push(player);
  }
  player.connected = true;
  if (name) player.name = name;
  keepCurrentPlayer(currentId);
}

async function kickPlayer(playerId) {
  const player = state?.players.find((item) => item.id === playerId);
  if (!player || player.isHost || !confirm(`确定要移出 ${player.name} 吗？`)) return;
  try {
    await postJson("/api/kick", { roomCode, hostId: selfId, resumeToken, playerId });
    removePlayer(playerId);
  } catch {
    alert("无法移出该玩家，请检查服务器连接。");
  }
}

function removePlayer(playerId) {
  const currentId = getCurrentPlayer()?.id;
  const playerIndex = state.players.findIndex((player) => player.id === playerId);
  if (playerIndex < 0) return;
  const nextCandidateId = state.players.slice(playerIndex + 1).concat(state.players.slice(0, playerIndex))
    .find((player) => player.status === "playing" && player.connected)?.id;
  const wasQuestionAsker = state.currentQuestion?.askerId === playerId;
  state.players.splice(playerIndex, 1);
  if (state.submittedEntries) delete state.submittedEntries[playerId];
  state.winners = state.winners.filter((id) => id !== playerId);
  if (state.phase === "collectingWords" && state.players.length >= 2 && state.players.every((player) => state.submittedEntries[player.id])) {
    startPlayerWordGame();
  }
  if (state.phase === "playing") {
    if (wasQuestionAsker) {
      state.currentQuestion = null;
      state.turnQuestionAsked = false;
    } else if (isQuestionComplete()) {
      state.currentQuestion = null;
    }
    if (currentId === playerId) keepCurrentPlayer(nextCandidateId);
    else keepCurrentPlayer(currentId);
    finishIfInsufficientPlayers();
  }
  renderAndBroadcast();
}

function startGame() {
  if (!state || state.phase !== "lobby") return;
  if (state.players.length < 2) {
    alert("至少需要 2 名玩家。");
    return;
  }
  if (state.gameMode === "playerWords") {
    state.phase = "collectingWords";
    state.submittedEntries = {};
    renderAndBroadcast();
    return;
  }
  const words = shuffle(topics[state.topic]);
  if (words.length < state.players.length) {
    alert("当前词库不够分配所有玩家。");
    return;
  }
  state.players.forEach((player, index) => {
    player.word = words[index];
    player.status = "playing";
  });
  state.phase = "playing";
  state.round = 1;
  state.turnIndex = 0;
  state.turnQuestionAsked = false;
  state.currentQuestion = null;
  state.log.unshift({
    id: uid("log"),
    playerId: null,
    text: `游戏开始，主题是「${state.topic}」。`,
    detail: "每个人都能看到别人额头上的词，但看不到自己的词。"
  });
  renderAndBroadcast();
}

function startPlayerWordGame() {
  const players = state.players;
  const sourceOrder = createDerangement(players.length);
  players.forEach((player, targetIndex) => {
    const entry = state.submittedEntries[players[sourceOrder[targetIndex]].id];
    player.word = entry.word;
    player.trapWord = entry.trapWord;
    player.wordExtra = entry.extra;
    player.status = "playing";
  });
  state.phase = "playing";
  state.round = 1;
  state.turnIndex = 0;
  state.turnQuestionAsked = false;
  state.currentQuestion = null;
  state.log.unshift({
    id: uid("log"),
    playerId: null,
    text: "词语已分配，游戏开始。",
    detail: state.playerWordMode === "trap"
      ? "每位玩家拿到的答案和陷阱词都不是自己提交的；猜中陷阱词会立即出局。"
      : "每位玩家拿到的都不是自己提交的词。"
  });
}

function endCurrentGame() {
  if (mode !== "host" || !state || state.phase === "lobby") return;
  state.phase = "lobby";
  state.players.forEach((player) => {
    player.word = "";
    player.trapWord = "";
    player.wordExtra = "";
    player.status = "waiting";
  });
  state.turnIndex = 0;
  state.round = 0;
  state.turnQuestionAsked = false;
  state.currentQuestion = null;
  state.submittedEntries = {};
  state.log = [];
  state.winners = [];
  renderAndBroadcast();
}

function submitAction(action) {
  if (mode === "host") {
    applyPlayerAction(selfId, action);
    return;
  }
  sendSignal(hostClientId, { kind: "action", action }).catch(() => {
    elements.connectionStatus.textContent = "操作发送失败，请检查服务器连接";
  });
}

function applyPlayerAction(playerId, action) {
  if (!state) return;
  const player = state.players.find((item) => item.id === playerId);
  if (!player || !player.connected) return;

  if (action.type === "submitWord") {
    if (state.phase !== "collectingWords") return;
    const word = String(action.word || "").trim().replace(/\s+/g, " ");
    const trapWord = String(action.trapWord || "").trim().replace(/\s+/g, " ");
    const extra = String(action.extra || "").trim().replace(/\s+/g, " ");
    if (!word || word.length > 30) return;
    if (state.playerWordMode === "trap" && (!trapWord || trapWord.length > 30 || normalizeWord(trapWord) === normalizeWord(word))) return;
    if (state.wordExtraMode !== "none" && (!extra || extra.length > 100)) return;
    state.submittedEntries[playerId] = {
      word,
      trapWord: state.playerWordMode === "trap" ? trapWord : "",
      extra: state.wordExtraMode === "none" ? "" : extra
    };
    if (state.players.every((item) => state.submittedEntries[item.id])) {
      startPlayerWordGame();
    }
    renderAndBroadcast();
    return;
  }

  if (state.phase !== "playing") return;
  const current = getCurrentPlayer();
  if (!current) return;

  if (action.type === "question") {
    if (current.id !== playerId || state.currentQuestion || state.turnQuestionAsked) return;
    const text = action.text.trim();
    if (!text) return;
    const questionId = uid("question");
    state.turnQuestionAsked = true;
    state.currentQuestion = {
      id: questionId,
      askerId: playerId,
      askerName: player.name,
      text,
      answers: {}
    };
    state.log.unshift({
      id: uid("log"),
      type: "question",
      questionId,
      playerId,
      text: `${player.name} 提问：${text}`,
      wordExtraMode: state.wordExtraMode,
      wordExtra: player.wordExtra,
      answers: {}
    });
    renderAndBroadcast();
    return;
  }

  if (action.type === "answer") {
    if (!state.currentQuestion || state.currentQuestion.askerId === playerId) return;
    if (player.status !== "playing") return;
    const answer = ["yes", "no", "maybe"].includes(action.answer) ? action.answer : "maybe";
    state.currentQuestion.answers[playerId] = answer;
    const questionLog = state.log.find((item) => item.questionId === state.currentQuestion.id);
    if (questionLog) {
      questionLog.answers[playerId] = {
        playerName: player.name,
        answer
      };
    }
    if (isQuestionComplete()) {
      state.currentQuestion = null;
    }
    renderAndBroadcast();
    return;
  }

  if (action.type === "guess") {
    if (current.id !== playerId || state.currentQuestion) return;
    const guess = action.text.trim();
    if (!guess) return;
    const previousIndex = getActivePlayers().findIndex((item) => item.id === playerId);
    const correct = normalizeWord(guess) === normalizeWord(player.word);
    const hitTrap = state.playerWordMode === "trap" && normalizeWord(guess) === normalizeWord(player.trapWord);
    if (correct) {
      player.status = "won";
      state.winners.push(player.id);
      state.log.unshift({
        id: uid("log"),
        playerId,
        text: `${player.name} 猜中了：${player.word}`,
        detail: `名次：第 ${state.winners.length} 名`
      });
    } else if (hitTrap) {
      player.status = "eliminated";
      state.log.unshift({
        id: uid("log"),
        playerId,
        text: `${player.name} 猜中了陷阱词：${player.trapWord}`,
        detail: "触发陷阱，立即出局。"
      });
    } else {
      state.log.unshift({
        id: uid("log"),
        playerId,
        text: `${player.name} 猜错了：${guess}`,
        detail: "游戏继续，轮到下一位玩家。"
      });
    }
    advanceTurn(previousIndex, correct || hitTrap);
    renderAndBroadcast();
    return;
  }

  if (action.type === "skip") {
    if (current.id !== playerId || state.currentQuestion) return;
    const previousIndex = getActivePlayers().findIndex((item) => item.id === playerId);
    state.log.unshift({
      id: uid("log"),
      playerId,
      text: `${player.name} 选择跳过`,
      detail: "信息不足，轮到下一位玩家。"
    });
    advanceTurn(previousIndex, false);
    renderAndBroadcast();
  }
}

function isQuestionComplete() {
  const question = state.currentQuestion;
  if (!question) return false;
  return getActivePlayers()
    .filter((player) => player.id !== question.askerId)
    .every((player) => question.answers[player.id]);
}

function advanceTurn(previousIndex, removedCurrent) {
  state.currentQuestion = null;
  state.turnQuestionAsked = false;
  const active = getActivePlayers();
  if (active.length <= 1) {
    if (active.length === 1) {
      active[0].status = "left";
      state.log.unshift({
        id: uid("log"),
        playerId: active[0].id,
        text: `${active[0].name} 留到最后，游戏结束。`,
        detail: "所有其他玩家已经猜中。"
      });
    }
    state.phase = "ended";
    return;
  }
  if (removedCurrent) {
    state.turnIndex = previousIndex % active.length;
  } else {
    state.turnIndex = (previousIndex + 1) % active.length;
  }
  if (state.turnIndex === 0) state.round += 1;
}

function renderAndBroadcast() {
  render();
  broadcastViews();
}

function render() {
  const view = currentView();
  elements.hostTools.classList.toggle("hidden", mode !== "host");
  if (mode === "host") {
    elements.startGameButton.classList.toggle("hidden", view?.phase !== "lobby");
    elements.endGameButton.classList.toggle("hidden", !view || view.phase === "lobby");
  }
  if (!view) {
    elements.playerList.innerHTML = "";
    elements.wordBoard.innerHTML = "";
    elements.actionArea.innerHTML = "";
    elements.logList.innerHTML = "";
    return;
  }
  elements.gameNotice.textContent = view.notice;
  elements.roundBadge.textContent = `第 ${view.round} 轮`;
  const current = view.players.find((player) => player.isCurrent);
  elements.turnTitle.textContent = current ? current.name : view.phase === "collectingWords" ? "提交词语" : "未开始";
  renderPlayers(view);
  renderWords(view);
  renderActions(view);
  renderLog(view);
}

function renderPlayers(view) {
  elements.playerList.innerHTML = view.players.map((player) => {
    const submitted = view.submittedPlayerIds?.includes(player.id);
    const statusText = player.status === "won" ? "已猜中" : player.status === "eliminated" ? "已出局" : player.status === "left" ? "最后留场" : view.phase === "lobby" ? "已落座" : view.phase === "collectingWords" ? (submitted ? "已提交词语" : "等待提交") : "游戏中";
    const tagClass = player.status === "won" ? "won" : player.status === "eliminated" ? "eliminated" : player.status === "left" ? "out" : player.isCurrent ? "active" : "";
    const tag = player.isCurrent ? "行动" : statusText;
    return `
      <div class="player-item">
        <div>
          <div class="player-name">${escapeHtml(player.name)}</div>
          <div class="player-meta">${player.connected ? "在线" : "离线"} · ${statusText}</div>
        </div>
        <div class="player-actions">
          <span class="tag ${tagClass}">${tag}</span>
          ${mode === "host" && !player.isHost ? `<button class="kick-player-button" data-player-id="${escapeHtml(player.id)}" type="button">移出</button>` : ""}
        </div>
      </div>
    `;
  }).join("");
  if (mode === "host") {
    elements.playerList.querySelectorAll(".kick-player-button").forEach((button) => {
      button.addEventListener("click", () => kickPlayer(button.dataset.playerId));
    });
  }
}

function renderWords(view) {
  elements.wordBoard.innerHTML = view.words.map((item) => {
    const mine = item.id === view.selfId && view.phase !== "ended";
    const value = item.status === "waiting"
      ? "待发牌"
      : mine
        ? "你的词被遮住"
        : item.word || "未分配";
    const extra = item.extra && ["playing", "ended"].includes(view.phase)
      ? `<div class="word-extra word-extra-${escapeHtml(view.wordExtraMode)}"><strong>${view.wordExtraMode === "forbidden" ? "禁问" : "提示"}：</strong>${escapeHtml(item.extra)}</div>`
      : "";
    const trap = view.playerWordMode === "trap" && item.status !== "waiting"
      ? `<div class="trap-word ${mine ? "mine" : ""}"><strong>陷阱：</strong>${mine ? "你的陷阱词被遮住" : escapeHtml(item.trapWord || "未分配")}</div>`
      : "";
    return `
      <div class="word-card">
        <div class="word-owner">${escapeHtml(item.name)}</div>
        <div class="word-value ${mine ? "mine" : ""}">${escapeHtml(value)}</div>
        ${trap}
        ${extra}
      </div>
    `;
  }).join("");
}

function renderActions(view) {
  const current = view.players.find((player) => player.isCurrent);
  const myWord = view.words.find((item) => item.id === view.selfId);
  const extraNotice = current?.id === view.selfId && myWord?.extra
    ? renderWordExtraNotice(view.wordExtraMode, myWord.extra)
    : "";
  if (view.phase === "lobby") {
    elements.actionArea.innerHTML = `<p class="muted">玩家落座后，由房主开始游戏。</p>`;
    return;
  }
  if (view.phase === "ended") {
    elements.actionArea.innerHTML = renderResult(view);
    return;
  }
  if (view.phase === "collectingWords") {
    renderWordSubmission(view);
    return;
  }
  if (view.currentQuestion) {
    renderQuestionActions(view, extraNotice);
    return;
  }
  const isMyTurn = current?.id === view.selfId;
  if (!isMyTurn) {
    elements.actionArea.innerHTML = `<p class="muted">等待 ${escapeHtml(current?.name || "当前玩家")} 行动。</p>`;
    return;
  }
  const questionControls = view.turnQuestionAsked
    ? `<p class="muted">本轮已完成提问，可以猜词或跳过。</p>`
    : `
      <label>
        本轮问题
        <input id="questionInput" autocomplete="off" placeholder="例如：我是动物吗？">
      </label>
      <button class="primary" id="submitQuestionButton" type="button">提交问题</button>
    `;
  elements.actionArea.innerHTML = `
    ${extraNotice}
    ${questionControls}
    <label>
      猜词
      <input id="guessInput" autocomplete="off" placeholder="输入你认为自己额头上的词">
    </label>
    <button id="submitGuessButton" type="button">提交猜词</button>
    <button id="skipTurnButton" type="button">跳过</button>
  `;
  if (!view.turnQuestionAsked) {
    $("submitQuestionButton").addEventListener("click", () => {
      submitAction({ type: "question", text: $("questionInput").value });
    });
  }
  $("submitGuessButton").addEventListener("click", () => {
    submitAction({ type: "guess", text: $("guessInput").value });
  });
  $("skipTurnButton").addEventListener("click", () => {
    submitAction({ type: "skip" });
  });
}

function renderWordSubmission(view) {
  const hasSubmitted = view.submittedPlayerIds?.includes(view.selfId);
  const trapField = view.playerWordMode === "trap" ? `
    <label>
      陷阱词
      <input id="submittedTrapWordInput" autocomplete="off" maxlength="30" placeholder="例如：如懿">
    </label>
    <p class="muted">陷阱词应与答案有一定关联，但必须能通过合理问题进行区分。猜中陷阱词的玩家会立即出局。</p>
  ` : "";
  const extraField = view.wordExtraMode === "none" ? "" : `
    <label>
      ${view.wordExtraMode === "forbidden" ? "这个词的禁问信息" : "提供给猜词者的开局提示"}
      <textarea id="submittedWordExtraInput" maxlength="100" placeholder="${view.wordExtraMode === "forbidden" ? "例如：不能询问演员、导演或参演作品" : "例如：大陆电视剧中的男性角色"}"></textarea>
    </label>
    <p class="muted">${view.wordExtraMode === "forbidden" ? "请填写一条清晰、可执行的禁问规则。" : "请勿在提示中直接包含答案。"}</p>
  `;
  elements.actionArea.innerHTML = `
    <p class="muted">${view.playerWordMode === "trap" ? "请提交一个正确答案和一个陷阱词。" : "请提交一个词语。"}所有玩家完成提交后，系统会随机分配，且不会把你自己提交的词发给你。</p>
    <label>
      ${view.playerWordMode === "trap" ? "正确答案" : "你提供的词"}
      <input id="submittedWordInput" autocomplete="off" maxlength="30" placeholder="例如：长颈鹿">
    </label>
    ${trapField}
    ${extraField}
    <button class="primary" id="submitWordButton" type="button">${hasSubmitted ? "更新词语" : "提交词语"}</button>
    ${hasSubmitted ? '<p class="muted">你已提交；在其他玩家完成前仍可更新。</p>' : ""}
  `;
  $("submitWordButton").addEventListener("click", () => {
    const word = $("submittedWordInput").value.trim();
    const trapWord = $("submittedTrapWordInput")?.value.trim() || "";
    const extra = $("submittedWordExtraInput")?.value.trim() || "";
    if (!word) {
      alert(view.playerWordMode === "trap" ? "请输入正确答案。" : "请输入你提供的词。");
      return;
    }
    if (view.playerWordMode === "trap" && !trapWord) {
      alert("请输入陷阱词。");
      return;
    }
    if (view.playerWordMode === "trap" && normalizeWord(word) === normalizeWord(trapWord)) {
      alert("正确答案和陷阱词不能相同。");
      return;
    }
    if (view.wordExtraMode !== "none" && !extra) {
      alert(view.wordExtraMode === "forbidden" ? "请输入这个词的禁问信息。" : "请输入这个词的开局提示。");
      return;
    }
    submitAction({ type: "submitWord", word, trapWord, extra });
  });
}

function renderWordExtraNotice(extraMode, extra, inLog = false) {
  if (!extra || extraMode === "none") return "";
  const label = extraMode === "forbidden"
    ? (inLog ? "本题禁问规则" : "你的禁问规则")
    : (inLog ? "本题开局提示" : "你的开局提示");
  return `<div class="word-extra-notice word-extra-${escapeHtml(extraMode)}"><strong>${label}：</strong>${escapeHtml(extra)}</div>`;
}

function renderQuestionActions(view, extraNotice = "") {
  const question = view.currentQuestion;
  const isAsker = question.askerId === view.selfId;
  const myAnswer = question.answers[view.selfId];
  const answerNames = Object.entries(question.answers).map(([playerId, answer]) => {
    const player = view.players.find((item) => item.id === playerId);
    return `${player?.name || "玩家"}：${{ yes: "是", no: "否", maybe: "不一定" }[answer]}`;
  });

  if (isAsker) {
    elements.actionArea.innerHTML = `
      ${extraNotice}
      <div class="current-question notice">
        <strong>你的问题：</strong>${escapeHtml(question.text)}
      </div>
      <p class="muted">${answerNames.length ? escapeHtml(answerNames.join("，")) : "等待其他玩家回答。"}</p>
    `;
    return;
  }

  if (myAnswer) {
    elements.actionArea.innerHTML = `
      <div class="current-question notice">
        <strong>${escapeHtml(question.askerName)} 问：</strong>${escapeHtml(question.text)}
      </div>
      ${view.playerWordMode === "trap" ? '<p class="muted">回答始终以正确答案为准，不要根据陷阱词回答。</p>' : ""}
      <p class="muted">你已回答：${escapeHtml({ yes: "是", no: "否", maybe: "不一定" }[myAnswer])}</p>
    `;
    return;
  }

  elements.actionArea.innerHTML = `
    <div class="current-question notice">
      <strong>${escapeHtml(question.askerName)} 问：</strong>${escapeHtml(question.text)}
    </div>
    ${view.playerWordMode === "trap" ? '<p class="muted">请根据正确答案作答，不要根据陷阱词作答。</p>' : ""}
    <div class="answer-grid">
      <button class="answer-yes" id="answerYesButton" type="button">是</button>
      <button class="answer-no" id="answerNoButton" type="button">否</button>
      <button class="answer-maybe" id="answerMaybeButton" type="button">不一定</button>
    </div>
  `;
  $("answerYesButton").addEventListener("click", () => submitAction({ type: "answer", answer: "yes" }));
  $("answerNoButton").addEventListener("click", () => submitAction({ type: "answer", answer: "no" }));
  $("answerMaybeButton").addEventListener("click", () => submitAction({ type: "answer", answer: "maybe" }));
}

function renderResult(view) {
  const winnerNames = view.winners
    .map((id, index) => {
      const player = view.players.find((item) => item.id === id);
      return `第 ${index + 1} 名：${escapeHtml(player?.name || "玩家")}`;
    })
    .join("<br>");
  const eliminatedNames = view.players
    .filter((player) => player.status === "eliminated")
    .map((player) => escapeHtml(player.name))
    .join("、");
  return `
    <p>${winnerNames || "没有玩家猜中。"}</p>
    ${eliminatedNames ? `<p class="danger">陷阱出局：${eliminatedNames}</p>` : ""}
  `;
}

function renderLog(view) {
  const availableIds = new Set(view.players.map((player) => player.id));
  if (logPlayerFilter !== "all" && !availableIds.has(logPlayerFilter)) {
    logPlayerFilter = "all";
  }
  elements.logPlayerFilter.innerHTML = [
    `<option value="all">全部玩家</option>`,
    ...view.players.map((player) => `<option value="${escapeHtml(player.id)}">${escapeHtml(player.name)}</option>`)
  ].join("");
  elements.logPlayerFilter.value = logPlayerFilter;
  const records = logPlayerFilter === "all"
    ? view.log
    : view.log.filter((item) => item.playerId === logPlayerFilter);
  if (!records.length) {
    elements.logList.innerHTML = `<p class="muted">${logPlayerFilter === "all" ? "还没有记录。" : "该玩家还没有问答记录。"}</p>`;
    return;
  }
  elements.logList.innerHTML = records.slice(0, 24).map((item) => {
    const answerTags = item.type === "question"
      ? Object.values(item.answers || {}).map(({ playerName, answer }) => `
          <span class="log-answer-tag log-answer-${escapeHtml(answer)}">
            ${escapeHtml(playerName)}：${escapeHtml({ yes: "是", no: "否", maybe: "不一定" }[answer] || "不一定")}
          </span>
        `).join("")
      : "";
    const detail = item.type === "question"
      ? `${item.wordExtra ? renderWordExtraNotice(item.wordExtraMode, item.wordExtra, true) : ""}<div class="log-answer-list">${answerTags || '<span class="muted">等待其他玩家回答。</span>'}</div>`
      : `<div class="muted">${escapeHtml(item.detail || "")}</div>`;
    return `
      <div class="log-item">
        <div class="log-line">${escapeHtml(item.text)}</div>
        ${detail}
      </div>
    `;
  }).join("");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function init() {
  await loadConfig();
  Object.keys(topics).forEach((topic) => {
    const option = document.createElement("option");
    option.value = topic;
    option.textContent = topic;
    elements.topicSelect.appendChild(option);
  });

  elements.hostModeButton.addEventListener("click", () => setMode("host"));
  elements.guestModeButton.addEventListener("click", () => setMode("guest"));
  elements.createRoomButton.addEventListener("click", createRoom);
  elements.gameModeSelect.addEventListener("change", () => {
    const usesPlayerWords = elements.gameModeSelect.value === "playerWords";
    elements.topicSelectLabel.classList.toggle("hidden", usesPlayerWords);
    elements.wordExtraModeLabel.classList.toggle("hidden", !usesPlayerWords);
    elements.playerWordModeLabel.classList.toggle("hidden", !usesPlayerWords);
  });
  elements.playerWordModeSelect.addEventListener("change", syncPlayerWordSettings);
  elements.wordExtraModeSelect.addEventListener("change", syncPlayerWordSettings);
  elements.joinRoomButton.addEventListener("click", joinRoom);
  elements.startGameButton.addEventListener("click", startGame);
  elements.endGameButton.addEventListener("click", endCurrentGame);
  elements.logPlayerFilter.addEventListener("change", () => {
    logPlayerFilter = elements.logPlayerFilter.value;
    const view = currentView();
    if (view) renderLog(view);
  });
  syncPlayerWordSettings();
  setMode("host");
}

function syncPlayerWordSettings() {
  const trapMode = elements.playerWordModeSelect.value === "trap";
  const hintOption = elements.wordExtraModeSelect.querySelector('option[value="hint"]');
  hintOption.disabled = trapMode;
  if (trapMode && elements.wordExtraModeSelect.value === "hint") {
    elements.wordExtraModeSelect.value = "none";
  }
}

init();
