"use strict";

const idioms = [
  "画龙点睛", "守株待兔", "亡羊补牢", "杯弓蛇影", "刻舟求剑", "掩耳盗铃",
  "滥竽充数", "叶公好龙", "狐假虎威", "井底之蛙", "胸有成竹", "指鹿为马",
  "班门弄斧", "南辕北辙", "东施效颦", "惊弓之鸟", "破釜沉舟", "卧薪尝胆",
  "三顾茅庐", "草木皆兵", "纸上谈兵", "悬梁刺股", "一鼓作气", "望梅止渴",
  "塞翁失马", "愚公移山", "买椟还珠", "拔苗助长", "对牛弹琴", "鹬蚌相争",
  "老马识途", "四面楚歌", "毛遂自荐", "完璧归赵", "负荆请罪", "洛阳纸贵",
  "入木三分", "闻鸡起舞", "程门立雪", "凿壁偷光"
];

let mode = "host";
let selfId = "";
let roomCode = "";
let hostClientId = "";
let signalEvents = null;
let state = null;
let guestView = null;

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
  playerCountSelect: $("playerCountSelect"),
  createRoomButton: $("createRoomButton"),
  roomCodeInput: $("roomCodeInput"),
  joinRoomButton: $("joinRoomButton"),
  hostTools: $("hostTools"),
  roomCodeDisplay: $("roomCodeDisplay"),
  roomPlayerCountSelect: $("roomPlayerCountSelect"),
  startGameButton: $("startGameButton"),
  endGameButton: $("endGameButton"),
  playerList: $("playerList"),
  gameNotice: $("gameNotice"),
  roundBadge: $("roundBadge"),
  seatBoard: $("seatBoard"),
  idiomValue: $("idiomValue"),
  turnTitle: $("turnTitle"),
  teamBadge: $("teamBadge"),
  actionArea: $("actionArea"),
  logList: $("logList")
};

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeText(value) {
  return String(value).trim().replace(/\s+/g, "").replace(/[，。！？、,.!?]/g, "");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function randomIdiom() {
  return idioms[Math.floor(Math.random() * idioms.length)];
}

function roleForSeat(index) {
  return index % 2 === 0 ? "captain" : "member";
}

function roleText(role) {
  return role === "captain" ? "队长" : "队员";
}

function teamNumberForSeat(index) {
  return Math.floor(index / 2) + 1;
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
    elements.connectionStatus.textContent = "请通过 signal-server.js 打开游戏";
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
    elements.connectionStatus.textContent = "信令服务正在重连";
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
    upsertPlayer(payload.playerId, payload.name);
    renderAndBroadcast();
    return;
  }
  if (mode === "host" && payload?.kind === "action") {
    applyAction(message.from, payload.action);
    return;
  }
  if (mode === "guest" && payload?.kind === "view") {
    guestView = payload.view;
    render();
  }
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

function createSeats(count) {
  return Array.from({ length: count }, (_, index) => ({
    index,
    playerId: null
  }));
}

function resizeSeats(count) {
  const seats = createSeats(count);
  seats.forEach((seat, index) => {
    seat.playerId = state.seats[index]?.playerId || null;
  });
  state.playerCount = count;
  state.seats = seats;
}

function createHostState(playerCount) {
  return {
    phase: "lobby",
    playerCount,
    seats: createSeats(playerCount),
    players: [{
      id: selfId,
      name: elements.hostNameInput.value.trim() || "房主",
      connected: true,
      isHost: true
    }],
    idiom: "",
    turnTeamIndex: 0,
    turnPhase: "describe",
    currentDescription: "",
    round: 0,
    winnerTeamIndex: null,
    winnerGuess: "",
    log: []
  };
}

async function createRoom() {
  selfId = uid("host");
  state = createHostState(Number(elements.playerCountSelect.value));
  elements.roomPlayerCountSelect.value = String(state.playerCount);
  try {
    const result = await postJson("/api/rooms", { hostId: selfId });
    roomCode = result.roomCode;
    elements.roomCodeDisplay.textContent = roomCode;
    openSignalEvents(selfId);
    enterRoom();
    render();
  } catch {
    alert("无法创建房间。请先运行 node game2/signal-server.js，再从服务地址打开页面。");
  }
}

function changeRoomPlayerCount() {
  if (mode !== "host" || !state || state.phase !== "lobby") {
    elements.roomPlayerCountSelect.value = String(state?.playerCount || elements.playerCountSelect.value);
    return;
  }
  resizeSeats(Number(elements.roomPlayerCountSelect.value));
  renderAndBroadcast();
}

async function joinRoom() {
  selfId = uid("guest");
  roomCode = elements.roomCodeInput.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(roomCode)) {
    alert("请输入 4 位房间号。");
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

function upsertPlayer(playerId, name) {
  let player = state.players.find((item) => item.id === playerId);
  if (!player) {
    player = {
      id: playerId,
      name: name || "玩家",
      connected: true,
      isHost: false
    };
    state.players.push(player);
  }
  player.name = name || player.name;
  player.connected = true;
}

function submitAction(action) {
  if (mode === "host") {
    applyAction(selfId, action);
    return;
  }
  sendSignal(hostClientId, { kind: "action", action }).catch(() => {
    elements.connectionStatus.textContent = "操作发送失败，请检查服务器连接";
  });
}

function playerSeatIndex(playerId) {
  return state.seats.findIndex((seat) => seat.playerId === playerId);
}

function teams() {
  const result = [];
  for (let index = 0; index < state.seats.length; index += 2) {
    result.push({
      index: index / 2,
      captainSeat: index,
      memberSeat: index + 1,
      captainId: state.seats[index]?.playerId || null,
      memberId: state.seats[index + 1]?.playerId || null
    });
  }
  return result;
}

function currentTeam() {
  return teams()[state.turnTeamIndex] || null;
}

function currentActorId() {
  const team = currentTeam();
  if (!team) return null;
  return state.turnPhase === "describe" ? team.captainId : team.memberId;
}

function nameOf(playerId) {
  return state.players.find((player) => player.id === playerId)?.name || "玩家";
}

function buildView(viewerId) {
  const seatIndex = playerSeatIndex(viewerId);
  const role = seatIndex >= 0 ? roleForSeat(seatIndex) : null;
  const actorId = state.phase === "playing" ? currentActorId() : null;
  const team = state.phase === "playing" ? currentTeam() : null;
  const showIdiom = state.phase === "ended" || role === "captain";

  return {
    selfId: viewerId,
    phase: state.phase,
    playerCount: state.playerCount,
    seats: state.seats,
    players: state.players,
    mySeatIndex: seatIndex,
    myRole: role,
    idiom: showIdiom ? state.idiom : "",
    idiomHidden: state.phase === "playing" && role !== "captain",
    turnTeamIndex: state.turnTeamIndex,
    turnPhase: state.turnPhase,
    currentActorId: actorId,
    currentDescription: state.currentDescription,
    round: state.round,
    winnerTeamIndex: state.winnerTeamIndex,
    winnerGuess: state.winnerGuess,
    log: state.log,
    notice: getNotice(),
    turnLabel: getTurnLabel(team, actorId)
  };
}

function getNotice() {
  if (!state) return "等待创建房间。";
  if (state.phase === "lobby") {
    const seated = state.seats.filter((seat) => seat.playerId).length;
    return `房主选择了 ${state.playerCount} 人局，当前 ${seated}/${state.playerCount} 人落座。相邻两席为一队，前席队长，后席队员。`;
  }
  if (state.phase === "ended") {
    return `游戏结束，答案是「${state.idiom}」。`;
  }
  const actor = nameOf(currentActorId());
  return state.turnPhase === "describe"
    ? `轮到第 ${state.turnTeamIndex + 1} 队队长 ${actor} 描述成语。`
    : `轮到第 ${state.turnTeamIndex + 1} 队队员 ${actor} 根据描述猜成语。`;
}

function getTurnLabel(team, actorId) {
  if (!team || !actorId) return "未开始";
  const action = state.turnPhase === "describe" ? "描述" : "猜词";
  return `第 ${team.index + 1} 队 ${nameOf(actorId)} ${action}`;
}

function currentView() {
  if (mode === "host") return state ? buildView(selfId) : null;
  return guestView;
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

function renderAndBroadcast() {
  render();
  broadcastViews();
}

function applyAction(playerId, action) {
  if (!state) return;
  if (action.type === "sit") {
    sitPlayer(playerId, action.seatIndex);
    return;
  }
  if (action.type === "leaveSeat") {
    leaveSeat(playerId);
    return;
  }
  if (action.type === "describe") {
    submitDescription(playerId, action.text);
    return;
  }
  if (action.type === "guess") {
    submitGuess(playerId, action.text);
  }
}

function sitPlayer(playerId, seatIndex) {
  if (state.phase !== "lobby") return;
  const player = state.players.find((item) => item.id === playerId);
  const target = state.seats[seatIndex];
  if (!player || !target || target.playerId) return;
  state.seats.forEach((seat) => {
    if (seat.playerId === playerId) seat.playerId = null;
  });
  target.playerId = playerId;
  renderAndBroadcast();
}

function leaveSeat(playerId) {
  if (state.phase !== "lobby") return;
  state.seats.forEach((seat) => {
    if (seat.playerId === playerId) seat.playerId = null;
  });
  renderAndBroadcast();
}

function startGame() {
  if (!state || state.phase !== "lobby") return;
  const emptySeat = state.seats.find((seat) => !seat.playerId);
  if (emptySeat) {
    alert("还有座位为空，所有人落座后才能开始。");
    return;
  }
  state.phase = "playing";
  state.idiom = randomIdiom();
  state.turnTeamIndex = 0;
  state.turnPhase = "describe";
  state.currentDescription = "";
  state.round = 1;
  state.log = [{
    id: uid("log"),
    text: "游戏开始",
    detail: `本局共有 ${state.playerCount / 2} 队，按座位顺序依次行动。`
  }];
  renderAndBroadcast();
}

function endCurrentGame() {
  if (mode !== "host" || !state || state.phase === "lobby") return;
  state.phase = "lobby";
  state.idiom = "";
  state.turnTeamIndex = 0;
  state.turnPhase = "describe";
  state.currentDescription = "";
  state.round = 0;
  state.winnerTeamIndex = null;
  state.winnerGuess = "";
  state.log = [];
  renderAndBroadcast();
}

function submitDescription(playerId, text) {
  if (state.phase !== "playing") return;
  if (state.turnPhase !== "describe" || currentActorId() !== playerId) return;
  const cleanText = String(text || "").trim();
  if (!cleanText) return;
  state.currentDescription = cleanText;
  state.turnPhase = "guess";
  state.log.unshift({
    id: uid("log"),
    text: `${nameOf(playerId)} 描述：${cleanText}`,
    detail: `第 ${state.turnTeamIndex + 1} 队队长提交`
  });
  renderAndBroadcast();
}

function submitGuess(playerId, text) {
  if (state.phase !== "playing") return;
  if (state.turnPhase !== "guess" || currentActorId() !== playerId) return;
  const guess = String(text || "").trim();
  if (!guess) return;
  const correct = normalizeText(guess) === normalizeText(state.idiom);
  state.log.unshift({
    id: uid("log"),
    text: `${nameOf(playerId)} 猜：${guess}`,
    detail: correct ? "回答正确，游戏结束。" : "回答错误，轮到下一队。"
  });
  if (correct) {
    state.phase = "ended";
    state.winnerTeamIndex = state.turnTeamIndex;
    state.winnerGuess = guess;
  } else {
    advanceTeam();
  }
  renderAndBroadcast();
}

function advanceTeam() {
  const teamCount = state.playerCount / 2;
  state.turnTeamIndex = (state.turnTeamIndex + 1) % teamCount;
  if (state.turnTeamIndex === 0) state.round += 1;
  state.turnPhase = "describe";
  state.currentDescription = "";
}

function render() {
  const view = currentView();
  elements.hostTools.classList.toggle("hidden", mode !== "host");
  if (!view) return;
  if (mode === "host") {
    elements.roomPlayerCountSelect.value = String(view.playerCount);
    elements.roomPlayerCountSelect.disabled = view.phase !== "lobby";
    elements.startGameButton.classList.toggle("hidden", view.phase !== "lobby");
    elements.endGameButton.classList.toggle("hidden", view.phase === "lobby");
  }
  elements.gameNotice.textContent = view.notice;
  elements.roundBadge.textContent = `第 ${view.round} 轮`;
  elements.turnTitle.textContent = view.turnLabel;
  elements.teamBadge.textContent = view.phase === "playing" ? `第 ${view.turnTeamIndex + 1} 队` : "--";
  renderPlayers(view);
  renderSeats(view);
  renderIdiom(view);
  renderActions(view);
  renderLog(view);
}

function renderPlayers(view) {
  elements.playerList.innerHTML = view.players.map((player) => `
    <div class="player-item">
      <div>
        <div class="player-name">${escapeHtml(player.name)}</div>
        <div class="player-meta">${player.isHost ? "房主" : "玩家"}</div>
      </div>
      <span class="tag ${player.connected ? "online" : "offline"}">${player.connected ? "在线" : "离线"}</span>
    </div>
  `).join("");
}

function renderSeats(view) {
  const playersById = new Map(view.players.map((player) => [player.id, player]));
  elements.seatBoard.innerHTML = view.seats.map((seat) => {
    const player = playersById.get(seat.playerId);
    const role = roleForSeat(seat.index);
    const team = teamNumberForSeat(seat.index);
    const isMine = seat.playerId === view.selfId;
    const isCurrent = view.phase === "playing" && seat.playerId === view.currentActorId;
    const canSit = view.phase === "lobby" && !seat.playerId;
    const canLeave = view.phase === "lobby" && isMine;
    const button = canSit
      ? `<button data-sit="${seat.index}" type="button">落座</button>`
      : canLeave
        ? `<button data-leave="1" type="button">离座</button>`
        : "";
    return `
      <div class="seat-card ${isCurrent ? "current" : ""}">
        <div class="seat-head">
          <strong>第 ${team} 队</strong>
          <span class="role-chip role-${role}">${roleText(role)}</span>
        </div>
        <div>
          <div class="${player ? "seat-name" : "seat-empty"}">${escapeHtml(player?.name || "空位")}</div>
          <div class="seat-meta">席位 ${seat.index + 1}${isMine ? " · 你" : ""}</div>
        </div>
        ${button}
      </div>
    `;
  }).join("");

  elements.seatBoard.querySelectorAll("[data-sit]").forEach((button) => {
    button.addEventListener("click", () => {
      submitAction({ type: "sit", seatIndex: Number(button.dataset.sit) });
    });
  });
  elements.seatBoard.querySelectorAll("[data-leave]").forEach((button) => {
    button.addEventListener("click", () => {
      submitAction({ type: "leaveSeat" });
    });
  });
}

function renderIdiom(view) {
  elements.idiomValue.classList.toggle("hidden-word", view.idiomHidden);
  if (view.phase === "lobby") {
    elements.idiomValue.textContent = "尚未开始";
  } else if (view.idiomHidden) {
    elements.idiomValue.textContent = "队员不可见";
  } else {
    elements.idiomValue.textContent = view.idiom || "尚未抽取";
  }
}

function renderActions(view) {
  if (view.phase === "lobby") {
    elements.actionArea.innerHTML = `<p class="muted">自由落座中。所有席位坐满后，由房主开始游戏。</p>`;
    return;
  }
  if (view.phase === "ended") {
    const winner = view.winnerTeamIndex === null ? "无人猜中" : `第 ${view.winnerTeamIndex + 1} 队获胜`;
    elements.actionArea.innerHTML = `
      <div class="result-title">${escapeHtml(winner)}</div>
      <p>本局成语：${escapeHtml(view.idiom)}</p>
    `;
    return;
  }
  if (view.currentActorId !== view.selfId) {
    const description = view.currentDescription
      ? `<div class="notice"><strong>当前描述：</strong>${escapeHtml(view.currentDescription)}</div>`
      : "";
    elements.actionArea.innerHTML = `${description}<p class="muted">等待当前队伍行动。</p>`;
    return;
  }
  if (view.turnPhase === "describe") {
    elements.actionArea.innerHTML = `
      <label>
        队长描述
        <textarea id="descriptionInput" autocomplete="off" maxlength="120" placeholder="输入给队员看的描述"></textarea>
      </label>
      <button class="primary" id="submitDescriptionButton" type="button">提交描述</button>
    `;
    $("submitDescriptionButton").addEventListener("click", () => {
      submitAction({ type: "describe", text: $("descriptionInput").value });
    });
    return;
  }
  elements.actionArea.innerHTML = `
    <div class="notice"><strong>当前描述：</strong>${escapeHtml(view.currentDescription)}</div>
    <label>
      队员猜词
      <input id="guessInput" autocomplete="off" maxlength="12" placeholder="输入四字成语">
    </label>
    <button class="primary" id="submitGuessButton" type="button">提交猜词</button>
  `;
  $("submitGuessButton").addEventListener("click", () => {
    submitAction({ type: "guess", text: $("guessInput").value });
  });
}

function renderLog(view) {
  if (!view.log.length) {
    elements.logList.innerHTML = `<p class="muted">还没有公开记录。</p>`;
    return;
  }
  elements.logList.innerHTML = view.log.slice(0, 40).map((item) => `
    <div class="log-item">
      <div class="log-line">${escapeHtml(item.text)}</div>
      <div class="muted">${escapeHtml(item.detail || "")}</div>
    </div>
  `).join("");
}

async function init() {
  await loadConfig();
  elements.hostModeButton.addEventListener("click", () => setMode("host"));
  elements.guestModeButton.addEventListener("click", () => setMode("guest"));
  elements.createRoomButton.addEventListener("click", createRoom);
  elements.joinRoomButton.addEventListener("click", joinRoom);
  elements.roomPlayerCountSelect.addEventListener("change", changeRoomPlayerCount);
  elements.startGameButton.addEventListener("click", startGame);
  elements.endGameButton.addEventListener("click", endCurrentGame);
  setMode("host");
}

init();
