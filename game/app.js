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
let roomCode = "";
let hostClientId = "";
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
  topicSelect: $("topicSelect"),
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
  signalEvents = new EventSource(`/api/events?clientId=${encodeURIComponent(clientId)}`);
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
      if (remote) remote.connected = false;
      render();
    });
  }
}

function buildView(viewerId) {
  const current = getCurrentPlayer();
  return {
    selfId: viewerId,
    phase: state.phase,
    topic: state.topic,
    round: state.round,
    turnQuestionAsked: state.turnQuestionAsked,
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      status: player.status,
      connected: player.connected,
      isCurrent: current?.id === player.id
    })),
    words: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      word: player.id === viewerId ? null : player.word,
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
  return state.players.filter((player) => player.status === "playing");
}

function getCurrentPlayer() {
  if (!state || state.phase !== "playing") return null;
  const active = getActivePlayers();
  if (active.length === 0) return null;
  return active[state.turnIndex % active.length];
}

function getNotice() {
  if (!state) return "还没有创建房间。";
  if (state.phase === "lobby") return "等待玩家落座，房主开始后会自动分配同主题词语。";
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
  state = {
    phase: "lobby",
    topic: hostTopic,
    players: [{
      id: selfId,
      name: elements.hostNameInput.value.trim() || "房主",
      word: "",
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
    const result = await postJson("/api/rooms", { hostId: selfId });
    roomCode = result.roomCode;
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
  selfId = uid("guest");
  roomCode = elements.roomCodeInput.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(roomCode)) {
    alert("请输入 4 位字母数字房间号。");
    return;
  }
  let room;
  try {
    room = await postJson("/api/join", { roomCode, clientId: selfId });
  } catch {
    alert("没有找到这个房间号，或信令服务未启动。");
    return;
  }
  hostClientId = room.hostId;
  openSignalEvents(selfId);
  await sendSignal(hostClientId, {
    kind: "hello",
    playerId: selfId,
    name: elements.guestNameInput.value.trim() || "玩家"
  });
  elements.connectionStatus.textContent = `已加入 ${roomCode}`;
  enterRoom();
  render();
}

function upsertRemotePlayer(playerId, name) {
  let player = state.players.find((item) => item.id === playerId);
  if (!player) {
    player = {
      id: playerId,
      name: name || "玩家",
      word: "",
      status: "waiting",
      connected: true,
      isHost: false
    };
    state.players.push(player);
  }
  player.connected = true;
}

function startGame() {
  if (!state || state.phase !== "lobby") return;
  if (state.players.length < 2) {
    alert("至少需要 2 名玩家。");
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

function endCurrentGame() {
  if (mode !== "host" || !state || state.phase === "lobby") return;
  state.phase = "lobby";
  state.players.forEach((player) => {
    player.word = "";
    player.status = "waiting";
  });
  state.turnIndex = 0;
  state.round = 0;
  state.turnQuestionAsked = false;
  state.currentQuestion = null;
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
  if (!state || state.phase !== "playing") return;
  const player = state.players.find((item) => item.id === playerId);
  const current = getCurrentPlayer();
  if (!player || !current) return;

  if (action.type === "question") {
    if (current.id !== playerId || state.currentQuestion || state.turnQuestionAsked) return;
    const text = action.text.trim();
    if (!text) return;
    state.turnQuestionAsked = true;
    state.currentQuestion = {
      id: uid("question"),
      askerId: playerId,
      askerName: player.name,
      text,
      answers: {}
    };
    state.log.unshift({
      id: uid("log"),
      playerId,
      text: `${player.name} 提问：${text}`,
      detail: "等待其他仍在游戏中的玩家回答。"
    });
    renderAndBroadcast();
    return;
  }

  if (action.type === "answer") {
    if (!state.currentQuestion || state.currentQuestion.askerId === playerId) return;
    if (player.status !== "playing") return;
    const answer = ["yes", "no", "maybe"].includes(action.answer) ? action.answer : "maybe";
    state.currentQuestion.answers[playerId] = answer;
    const answerText = { yes: "是", no: "否", maybe: "不一定" }[answer];
    state.log.unshift({
      id: uid("log"),
      playerId,
      questionOwnerId: state.currentQuestion.askerId,
      text: `${player.name} 回答 ${state.currentQuestion.askerName}：${answerText}`,
      detail: state.currentQuestion.text
    });
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
    if (correct) {
      player.status = "won";
      state.winners.push(player.id);
      state.log.unshift({
        id: uid("log"),
        playerId,
        text: `${player.name} 猜中了：${player.word}`,
        detail: `名次：第 ${state.winners.length} 名`
      });
    } else {
      state.log.unshift({
        id: uid("log"),
        playerId,
        text: `${player.name} 猜错了：${guess}`,
        detail: "游戏继续，轮到下一位玩家。"
      });
    }
    advanceTurn(previousIndex, correct);
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
  elements.turnTitle.textContent = current ? current.name : "未开始";
  renderPlayers(view);
  renderWords(view);
  renderActions(view);
  renderLog(view);
}

function renderPlayers(view) {
  elements.playerList.innerHTML = view.players.map((player) => {
    const statusText = player.status === "won" ? "已猜中" : player.status === "left" ? "最后留场" : view.phase === "lobby" ? "已落座" : "游戏中";
    const tagClass = player.status === "won" ? "won" : player.status === "left" ? "out" : player.isCurrent ? "active" : "";
    const tag = player.isCurrent ? "行动" : statusText;
    return `
      <div class="player-item">
        <div>
          <div class="player-name">${escapeHtml(player.name)}</div>
          <div class="player-meta">${player.connected ? "在线" : "离线"} · ${statusText}</div>
        </div>
        <span class="tag ${tagClass}">${tag}</span>
      </div>
    `;
  }).join("");
}

function renderWords(view) {
  elements.wordBoard.innerHTML = view.words.map((item) => {
    const mine = item.id === view.selfId && view.phase !== "ended";
    const value = item.status === "waiting"
      ? "待发牌"
      : mine
        ? "你的词被遮住"
        : item.word || "未分配";
    return `
      <div class="word-card">
        <div class="word-owner">${escapeHtml(item.name)}</div>
        <div class="word-value ${mine ? "mine" : ""}">${escapeHtml(value)}</div>
      </div>
    `;
  }).join("");
}

function renderActions(view) {
  const current = view.players.find((player) => player.isCurrent);
  if (view.phase === "lobby") {
    elements.actionArea.innerHTML = `<p class="muted">玩家落座后，由房主开始游戏。</p>`;
    return;
  }
  if (view.phase === "ended") {
    elements.actionArea.innerHTML = renderResult(view);
    return;
  }
  if (view.currentQuestion) {
    renderQuestionActions(view);
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

function renderQuestionActions(view) {
  const question = view.currentQuestion;
  const isAsker = question.askerId === view.selfId;
  const myAnswer = question.answers[view.selfId];
  const answerNames = Object.entries(question.answers).map(([playerId, answer]) => {
    const player = view.players.find((item) => item.id === playerId);
    return `${player?.name || "玩家"}：${{ yes: "是", no: "否", maybe: "不一定" }[answer]}`;
  });

  if (isAsker) {
    elements.actionArea.innerHTML = `
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
      <p class="muted">你已回答：${escapeHtml({ yes: "是", no: "否", maybe: "不一定" }[myAnswer])}</p>
    `;
    return;
  }

  elements.actionArea.innerHTML = `
    <div class="current-question notice">
      <strong>${escapeHtml(question.askerName)} 问：</strong>${escapeHtml(question.text)}
    </div>
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
  return `<p>${winnerNames || "没有玩家猜中。"}</p>`;
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
    : view.log.filter((item) => item.questionOwnerId === logPlayerFilter || (item.playerId === logPlayerFilter && !item.questionOwnerId));
  if (!records.length) {
    elements.logList.innerHTML = `<p class="muted">${logPlayerFilter === "all" ? "还没有记录。" : "该玩家还没有问答记录。"}</p>`;
    return;
  }
  elements.logList.innerHTML = records.slice(0, 24).map((item) => `
    <div class="log-item">
      <div class="log-line">${escapeHtml(item.text)}</div>
      <div class="muted">${escapeHtml(item.detail || "")}</div>
    </div>
  `).join("");
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
  elements.joinRoomButton.addEventListener("click", joinRoom);
  elements.startGameButton.addEventListener("click", startGame);
  elements.endGameButton.addEventListener("click", endCurrentGame);
  elements.logPlayerFilter.addEventListener("change", () => {
    logPlayerFilter = elements.logPlayerFilter.value;
    const view = currentView();
    if (view) renderLog(view);
  });
  setMode("host");
}

init();
