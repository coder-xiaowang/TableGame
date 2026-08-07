"use strict";

const PROTOCOL_VERSION = 1;
const ACTION_SECONDS = 15;
const SCORE_LIMIT = 66;
let mode = "host";
let selfId = "";
let roomCode = "";
let hostId = "";
let resumeToken = "";
let events = null;
let state = null;
let guestView = null;
let hostTimer = null;
let countdownTimer = null;

const $ = (id) => document.getElementById(id);
const E = {
  connectionStatus: $("connectionStatus"), setupPanel: $("setupPanel"), roomPanel: $("roomPanel"),
  hostModeButton: $("hostModeButton"), guestModeButton: $("guestModeButton"),
  hostSetup: $("hostSetup"), guestSetup: $("guestSetup"), hostNameInput: $("hostNameInput"),
  guestNameInput: $("guestNameInput"), playerCountSelect: $("playerCountSelect"),
  createRoomButton: $("createRoomButton"), joinRoomButton: $("joinRoomButton"),
  roomCodeInput: $("roomCodeInput"), roomCodeDisplay: $("roomCodeDisplay"),
  hostTools: $("hostTools"), roomPlayerCountSelect: $("roomPlayerCountSelect"),
  startGameButton: $("startGameButton"), endGameButton: $("endGameButton"),
  playerCountBadge: $("playerCountBadge"), playerList: $("playerList"), notice: $("notice"),
  roundBadge: $("roundBadge"), turnBadge: $("turnBadge"), rows: $("rows"),
  actionTitle: $("actionTitle"), actionArea: $("actionArea"), timerText: $("timerText"),
  timerBar: $("timerBar"), handCount: $("handCount"), hand: $("hand"),
  selectionState: $("selectionState"), logList: $("logList"), toggleLogButton: $("toggleLogButton")
};

const uid = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
const sessionKey = (code) => `tablegame:bullheads:${code}`;
const loadSession = (code) => { try { return JSON.parse(localStorage.getItem(sessionKey(code)) || "null"); } catch { return null; } };
const saveSession = (name) => localStorage.setItem(sessionKey(roomCode), JSON.stringify({ playerId: selfId, resumeToken, name }));
const clearSession = () => roomCode && localStorage.removeItem(sessionKey(roomCode));
const cleanName = (value, fallback) => String(value || "").trim().slice(0, 12) || fallback;
const escapeHtml = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

function bullheads(number) {
  if (number === 55) return 7;
  if (number % 11 === 0) return 5;
  if (number % 10 === 0) return 3;
  if (number % 5 === 0) return 2;
  return 1;
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function post(path, data) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

function requireProtocol(result) {
  if (result?.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error(`联机协议版本不匹配，需要 v${PROTOCOL_VERSION}`);
  }
  return result;
}

async function signal(to, payload) {
  return post("/api/signal", { roomCode, from: selfId, resumeToken, to, payload });
}

function openEvents(clientId) {
  events?.close();
  return new Promise((resolve, reject) => {
    let opened = false;
    const timeout = setTimeout(() => {
      if (!opened) reject(new Error("事件通道连接超时"));
    }, 5000);
    events = new EventSource(`/api/events?clientId=${encodeURIComponent(clientId)}&roomCode=${encodeURIComponent(roomCode)}&resumeToken=${encodeURIComponent(resumeToken)}`);
    events.addEventListener("signal", (event) => receive(JSON.parse(event.data)));
    events.onopen = () => {
      opened = true;
      clearTimeout(timeout);
      E.connectionStatus.textContent = mode === "host" ? `已连接房间 ${roomCode}` : "已连接，等待房主确认";
      resolve();
    };
    events.onerror = () => {
      E.connectionStatus.textContent = "联机服务正在重连";
      if (!opened) {
        clearTimeout(timeout);
        reject(new Error("无法建立事件通道"));
      }
    };
  });
}

function receive(message) {
  const payload = message.payload;
  if (mode === "host" && payload?.kind === "hello") return admit(message.from, payload.name);
  if (mode === "host" && payload?.kind === "presence") return updatePresence(payload.playerId, payload.connected);
  if (mode === "host" && payload?.kind === "action") return applyAction(message.from, payload.action);
  if (mode === "guest" && payload?.kind === "view") {
    guestView = payload.view;
    E.connectionStatus.textContent = `已加入房间 ${roomCode}`;
    enterRoom();
    render();
  }
  if (mode === "guest" && payload?.kind === "rejected") {
    events?.close();
    E.connectionStatus.textContent = "加入失败";
    alert(payload.message || "无法加入房间");
  }
  if (payload?.kind === "kicked") { clearSession(); events?.close(); alert("你已被房主移出房间。"); location.reload(); }
}

function setMode(nextMode) {
  mode = nextMode;
  E.hostModeButton.classList.toggle("active", mode === "host");
  E.guestModeButton.classList.toggle("active", mode === "guest");
  E.hostSetup.classList.toggle("hidden", mode !== "host");
  E.guestSetup.classList.toggle("hidden", mode !== "guest");
}

function enterRoom() {
  E.setupPanel.classList.add("hidden");
  E.roomPanel.classList.remove("hidden");
  E.hostTools.classList.toggle("hidden", mode !== "host");
  E.roomCodeDisplay.textContent = roomCode;
}

function makePlayer(id, name, isHost = false) {
  return { id, name, isHost, connected: true, hand: [], captured: [], score: 0, selectedCard: null };
}

async function createRoom() {
  selfId = uid("host");
  state = {
    phase: "lobby",
    capacity: Number(E.playerCountSelect.value),
    round: 0,
    turn: 0,
    players: [makePlayer(selfId, cleanName(E.hostNameInput.value, "房主"), true)],
    rows: [],
    playQueue: [],
    pendingPlayerId: null,
    pendingCard: null,
    deadline: 0,
    logs: [],
    winners: []
  };
  try {
    const result = requireProtocol(await post("/api/rooms", { hostId: selfId, name: state.players[0].name }));
    roomCode = result.roomCode;
    resumeToken = result.resumeToken;
    await openEvents(selfId);
  } catch (error) {
    return alert(`无法创建房间：${error.message}\n请先运行 node game6/signal-server.js`);
  }
  E.roomPlayerCountSelect.value = String(state.capacity);
  enterRoom();
  render();
}

async function joinRoom() {
  roomCode = E.roomCodeInput.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(roomCode)) return alert("请输入四位房间号。");
  const saved = loadSession(roomCode);
  selfId = saved?.playerId || uid("guest");
  guestView = null;
  E.joinRoomButton.disabled = true;
  try {
    const name = saved?.name || cleanName(E.guestNameInput.value, "玩家");
    const result = requireProtocol(await post("/api/join", { roomCode, clientId: selfId, resumeToken: saved?.resumeToken, name: saved ? "" : name }));
    selfId = result.clientId;
    resumeToken = result.resumeToken;
    hostId = result.hostId;
    await openEvents(selfId);
    await signal(hostId, { kind: "hello", name, resumed: result.resumed });
    saveSession(name);
  } catch (error) {
    events?.close();
    E.connectionStatus.textContent = "加入失败";
    alert(`无法加入房间：${error.message}`);
  } finally {
    E.joinRoomButton.disabled = false;
  }
}

function admit(id, name) {
  if (state.phase !== "lobby") {
    return signal(id, { kind: "rejected", message: "游戏已经开始，不能中途加入。" });
  }
  const existing = state.players.find((player) => player.id === id);
  if (existing) {
    existing.connected = true;
    return sync();
  }
  if (state.players.length >= state.capacity) {
    return signal(id, { kind: "rejected", message: "房间人数已满。" });
  }
  state.players.push(makePlayer(id, cleanName(name, "玩家")));
  log(`${cleanName(name, "玩家")} 加入了房间`);
  sync();
}

function updatePresence(id, connected) {
  const player = state?.players.find((item) => item.id === id);
  if (!player || player.connected === connected) return;
  player.connected = connected;
  if (!connected && state.phase === "selecting" && player.selectedCard == null && player.hand.length) {
    player.selectedCard = player.hand[Math.floor(Math.random() * player.hand.length)];
    log(`${player.name} 离线，系统已代为选牌`);
    if (state.players.every((item) => item.selectedCard != null)) return resolveSelections();
  }
  if (!connected && state.phase === "choosingRow" && state.pendingPlayerId === id) return rowChoiceTimeout();
  sync();
}

async function kickPlayer(id) {
  const player = state?.players.find((item) => item.id === id);
  if (!player || player.isHost || !confirm(`确定要移出 ${player.name} 吗？`)) return;
  try {
    await post("/api/kick", { roomCode, hostId: selfId, resumeToken, playerId: id });
    state.players = state.players.filter((item) => item.id !== id);
    if (state.phase !== "lobby") { clearTimeout(hostTimer); state.phase = "lobby"; state.deadline = 0; state.playQueue = []; state.pendingPlayerId = null; state.pendingCard = null; }
    sync();
  } catch { alert("无法移出该玩家，请检查服务器连接。"); }
}

function changeCapacity() {
  if (!state || state.phase !== "lobby") return;
  const capacity = Number(E.roomPlayerCountSelect.value);
  if (capacity < state.players.length) {
    alert("人数不能少于已经加入的玩家。");
    E.roomPlayerCountSelect.value = String(state.capacity);
    return;
  }
  state.capacity = capacity;
  sync();
}

function log(text) {
  state.logs.unshift({ id: uid("log"), text });
  state.logs = state.logs.slice(0, 100);
}

function startGame() {
  if (state.phase === "roundEnd") return startRound();
  if (state.phase !== "lobby") return;
  if (state.players.length !== state.capacity) return alert(`需要 ${state.capacity} 人到齐。`);
  if (state.players.some((player) => !player.connected)) return alert("所有玩家在线后才能开始。");
  state.players.forEach((player) => {
    player.score = 0;
    player.captured = [];
  });
  state.round = 0;
  state.logs = [];
  startRound();
}

function startRound() {
  clearTimeout(hostTimer);
  const deck = shuffle(Array.from({ length: 104 }, (_, index) => index + 1));
  state.round += 1;
  state.turn = 1;
  state.rows = Array.from({ length: 4 }, () => [deck.pop()]);
  state.playQueue = [];
  state.pendingPlayerId = null;
  state.pendingCard = null;
  state.winners = [];
  state.players.forEach((player) => {
    player.hand = deck.splice(-10).sort((a, b) => a - b);
    player.captured = [];
    player.selectedCard = null;
  });
  log(`第 ${state.round} 局开始`);
  beginSelection();
}

function beginSelection() {
  clearTimeout(hostTimer);
  state.phase = "selecting";
  state.deadline = Date.now() + ACTION_SECONDS * 1000;
  sync();
  hostTimer = setTimeout(selectionTimeout, ACTION_SECONDS * 1000 + 50);
}

function selectionTimeout() {
  if (mode !== "host" || state.phase !== "selecting") return;
  state.players.forEach((player) => {
    if (player.selectedCard == null && player.hand.length) {
      player.selectedCard = player.hand[Math.floor(Math.random() * player.hand.length)];
      log(`${player.name} 选牌超时，系统已随机出牌`);
    }
  });
  resolveSelections();
}

function submit(action) {
  if (mode === "host") applyAction(selfId, action);
  else signal(hostId, { kind: "action", action }).catch(() => {
    E.connectionStatus.textContent = "操作发送失败";
  });
}

function applyAction(playerId, action) {
  const player = state.players.find((item) => item.id === playerId);
  if (!player || !action) return;
  if (action.type === "selectCard" && state.phase === "selecting") {
    const card = Number(action.card);
    if (player.selectedCard != null || !player.hand.includes(card)) return;
    player.selectedCard = card;
    if (state.players.every((item) => item.selectedCard != null)) resolveSelections();
    else sync();
    return;
  }
  if (action.type === "chooseRow" && state.phase === "choosingRow" && state.pendingPlayerId === playerId) {
    const rowIndex = Number(action.rowIndex);
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex > 3) return;
    takeChosenRow(rowIndex, false);
  }
}

function resolveSelections() {
  clearTimeout(hostTimer);
  state.phase = "resolving";
  state.deadline = 0;
  state.playQueue = state.players
    .map((player) => ({ playerId: player.id, card: player.selectedCard }))
    .sort((a, b) => a.card - b.card);
  state.players.forEach((player) => {
    const index = player.hand.indexOf(player.selectedCard);
    if (index >= 0) player.hand.splice(index, 1);
  });
  log(`本回合出牌：${state.playQueue.map((play) => {
    const player = state.players.find((item) => item.id === play.playerId);
    return `${player.name} ${play.card}`;
  }).join("，")}`);
  processQueue();
}

function processQueue() {
  while (state.playQueue.length) {
    const play = state.playQueue.shift();
    const endings = state.rows.map((row) => row.at(-1));
    const valid = endings.map((ending, index) => ({ ending, index })).filter((item) => item.ending < play.card);
    if (!valid.length) {
      state.phase = "choosingRow";
      state.pendingPlayerId = play.playerId;
      state.pendingCard = play.card;
      state.deadline = Date.now() + ACTION_SECONDS * 1000;
      sync();
      clearTimeout(hostTimer);
      hostTimer = setTimeout(rowChoiceTimeout, ACTION_SECONDS * 1000 + 50);
      return;
    }
    valid.sort((a, b) => b.ending - a.ending);
    placeCard(play.playerId, play.card, valid[0].index);
  }
  finishTurn();
}

function rowChoiceTimeout() {
  if (mode !== "host" || state.phase !== "choosingRow") return;
  const rowIndex = Math.floor(Math.random() * state.rows.length);
  const player = state.players.find((item) => item.id === state.pendingPlayerId);
  log(`${player.name} 选列超时，系统随机选择了第 ${rowIndex + 1} 列`);
  takeChosenRow(rowIndex, true);
}

function capture(playerId, cards) {
  const player = state.players.find((item) => item.id === playerId);
  player.captured.push(...cards);
  const points = cards.reduce((sum, card) => sum + bullheads(card), 0);
  player.score += points;
  log(`${player.name} 收走 ${cards.join("、")}，获得 ${points} 个牛头`);
}

function placeCard(playerId, card, rowIndex) {
  const row = state.rows[rowIndex];
  if (row.length === 5) {
    capture(playerId, [...row]);
    state.rows[rowIndex] = [card];
  } else {
    row.push(card);
  }
}

function takeChosenRow(rowIndex) {
  clearTimeout(hostTimer);
  capture(state.pendingPlayerId, [...state.rows[rowIndex]]);
  state.rows[rowIndex] = [state.pendingCard];
  state.pendingPlayerId = null;
  state.pendingCard = null;
  state.phase = "resolving";
  state.deadline = 0;
  sync();
  setTimeout(() => {
    if (mode === "host" && state.phase === "resolving") processQueue();
  }, 450);
}

function finishTurn() {
  state.players.forEach((player) => { player.selectedCard = null; });
  if (state.turn >= 10) {
    finishRound();
    return;
  }
  state.turn += 1;
  beginSelection();
}

function finishRound() {
  clearTimeout(hostTimer);
  state.deadline = 0;
  const reachedLimit = state.players.some((player) => player.score >= SCORE_LIMIT);
  if (reachedLimit) {
    const best = Math.min(...state.players.map((player) => player.score));
    state.winners = state.players.filter((player) => player.score === best).map((player) => player.id);
    state.phase = "gameEnd";
    log(`游戏结束，${state.players.filter((player) => state.winners.includes(player.id)).map((player) => player.name).join("、")} 获胜`);
  } else {
    state.phase = "roundEnd";
    log(`第 ${state.round} 局结束，等待房主开始下一局`);
  }
  sync();
}

function endGame() {
  if (mode !== "host" || !state || state.phase === "lobby") return;
  if (!confirm("确定结束当前游戏并返回准备阶段吗？所有分数将被清空。")) return;
  clearTimeout(hostTimer);
  state.phase = "lobby";
  state.round = 0;
  state.turn = 0;
  state.rows = [];
  state.playQueue = [];
  state.pendingPlayerId = null;
  state.pendingCard = null;
  state.deadline = 0;
  state.logs = [];
  state.winners = [];
  state.players.forEach((player) => {
    player.hand = [];
    player.captured = [];
    player.score = 0;
    player.selectedCard = null;
  });
  sync();
}

function buildView(viewerId) {
  return {
    selfId: viewerId,
    phase: state.phase,
    capacity: state.capacity,
    round: state.round,
    turn: state.turn,
    rows: state.rows,
    pendingPlayerId: state.pendingPlayerId,
    pendingCard: state.pendingCard,
    deadline: state.deadline,
    logs: state.logs,
    winners: state.winners,
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      isHost: player.isHost,
      connected: player.connected,
      score: player.score,
      captured: player.captured,
      hand: player.id === viewerId ? player.hand : player.hand.map(() => null),
      hasSelected: player.selectedCard != null,
      selectedCard: player.id === viewerId ? player.selectedCard : null
    }))
  };
}

function currentView() {
  return mode === "host" ? (state ? buildView(selfId) : null) : guestView;
}

function broadcast() {
  if (mode !== "host" || !state) return;
  state.players.filter((player) => player.id !== selfId).forEach((player) => {
    signal(player.id, { kind: "view", view: buildView(player.id) }).catch(() => updatePresence(player.id, false));
  });
}

function sync() {
  render();
  broadcast();
}

function cardHtml(number, options = {}) {
  const points = bullheads(number);
  const classes = ["number-card", points >= 5 ? "danger-card" : "", options.selected ? "selected" : ""].filter(Boolean).join(" ");
  const content = `<strong>${number}</strong><small>${"🐂".repeat(points)}</small>`;
  if (!options.button) return `<div class="${classes}">${content}</div>`;
  return `<button class="${classes}" data-card="${number}" ${options.disabled ? "disabled" : ""}>${content}</button>`;
}

function render() {
  const view = currentView();
  if (!view) return;
  const me = view.players.find((player) => player.id === view.selfId);
  E.roomCodeDisplay.textContent = roomCode;
  E.roomPlayerCountSelect.value = String(view.capacity);
  E.roomPlayerCountSelect.disabled = view.phase !== "lobby";
  E.playerCountBadge.textContent = `${view.players.length} / ${view.capacity}`;
  E.roundBadge.textContent = `第 ${view.round} 局`;
  E.turnBadge.textContent = `第 ${view.turn} / 10 回合`;
  E.handCount.textContent = me?.hand.length || 0;

  const hostCanStart = mode === "host" && (view.phase === "lobby" || view.phase === "roundEnd");
  E.startGameButton.classList.toggle("hidden", !hostCanStart);
  E.startGameButton.textContent = view.phase === "roundEnd" ? "开始下一局" : "开始游戏";
  E.startGameButton.disabled = view.phase === "lobby" && view.players.length !== view.capacity;
  E.endGameButton.classList.toggle("hidden", mode !== "host" || view.phase === "lobby");

  E.playerList.innerHTML = view.players.map((player) => {
    const selected = view.phase === "selecting" ? (player.hasSelected ? "已选牌" : "选择中") : `${player.hand.length} 张手牌`;
    const winner = view.winners.includes(player.id) ? " · 获胜者" : "";
    return `<div class="player ${view.pendingPlayerId === player.id ? "current" : ""}">
      <div class="player-top"><span>${escapeHtml(player.name)}${player.isHost ? " 👑" : ""}</span><b>🐂 ${player.score}</b></div>
      <div class="player-meta">${selected}${winner}${player.connected ? "" : " · 已离线"}</div>
      <div class="captured">${player.captured.map((card) => `<span class="mini">${card} · ${bullheads(card)}🐂</span>`).join("")}</div>${mode === "host" && !player.isHost ? `<button data-player-id="${escapeHtml(player.id)}" type="button">移出</button>` : ""}
    </div>`;
  }).join("");
  if (mode === "host") E.playerList.querySelectorAll("[data-player-id]").forEach((button) => button.onclick = () => kickPlayer(button.dataset.playerId));

  const canChooseRow = view.phase === "choosingRow" && view.pendingPlayerId === view.selfId;
  E.rows.innerHTML = view.rows.map((row, index) => `
    <div class="card-row ${canChooseRow ? "choice" : ""}" data-row="${index}">
      <div class="row-label">${index + 1}</div>${row.map((card) => cardHtml(card)).join("")}
    </div>`).join("");
  if (canChooseRow) {
    E.rows.querySelectorAll("[data-row]").forEach((row) => {
      row.onclick = () => submit({ type: "chooseRow", rowIndex: Number(row.dataset.row) });
    });
  }

  renderNotice(view);
  renderAction(view, me, canChooseRow);
  const canSelect = view.phase === "selecting" && !me.hasSelected;
  E.hand.innerHTML = (me?.hand || []).map((card) => cardHtml(card, {
    button: true, disabled: !canSelect, selected: me.selectedCard === card
  })).join("");
  E.hand.querySelectorAll("[data-card]").forEach((button) => {
    button.onclick = () => submit({ type: "selectCard", card: Number(button.dataset.card) });
  });
  E.selectionState.textContent = view.phase === "selecting"
    ? (me.hasSelected ? "已锁定，等待其他玩家" : "请选择一张牌")
    : "";
  E.selectionState.classList.toggle("hidden", !E.selectionState.textContent);
  E.logList.innerHTML = view.logs.map((item) => `<div class="log-item">${escapeHtml(item.text)}</div>`).join("");
  startCountdown(view.deadline);
}

function renderNotice(view) {
  if (view.phase === "lobby") {
    E.notice.textContent = view.players.length === view.capacity
      ? "玩家已经到齐，房主可以开始游戏。"
      : `等待玩家加入：${view.players.length} / ${view.capacity}`;
  } else if (view.phase === "selecting") {
    E.notice.textContent = `第 ${view.round} 局第 ${view.turn} 回合：所有玩家秘密选择一张牌。`;
  } else if (view.phase === "choosingRow") {
    const player = view.players.find((item) => item.id === view.pendingPlayerId);
    E.notice.textContent = `${player?.name || "玩家"} 打出的 ${view.pendingCard} 比四列都小，必须选择一列收走。`;
  } else if (view.phase === "resolving") {
    E.notice.textContent = "正在按照数字从小到大结算本回合。";
  } else if (view.phase === "roundEnd") {
    E.notice.textContent = `第 ${view.round} 局结束，所有玩家累计分数均未达到 66，等待房主开始下一局。`;
  } else {
    const names = view.players.filter((player) => view.winners.includes(player.id)).map((player) => player.name);
    E.notice.textContent = `有玩家累计达到 66 个牛头，游戏结束。${names.join("、")} 以最低罚分获胜！`;
  }
}

function renderAction(view, me, canChooseRow) {
  E.actionArea.innerHTML = "";
  if (view.phase === "selecting") {
    E.actionTitle.textContent = me.hasSelected ? "已选择" : "选择一张手牌";
    E.actionArea.textContent = me.hasSelected ? "你的牌已经锁定，其他玩家看不到牌面。" : "点击下方手牌完成选择，提交后不能更改。";
  } else if (view.phase === "choosingRow") {
    const player = view.players.find((item) => item.id === view.pendingPlayerId);
    E.actionTitle.textContent = canChooseRow ? "选择收走一列" : `等待 ${player?.name || "玩家"} 选列`;
    E.actionArea.textContent = canChooseRow ? "直接点击桌面上的任意一列。" : "该玩家有 15 秒进行选择。";
  } else if (view.phase === "roundEnd") {
    E.actionTitle.textContent = "本局结束";
    E.actionArea.textContent = mode === "host" ? "点击左侧“开始下一局”继续游戏。" : "等待房主开始下一局。";
  } else if (view.phase === "gameEnd") {
    E.actionTitle.textContent = "整场游戏结束";
    E.actionArea.textContent = "累计罚分最低的玩家获胜。";
  } else if (view.phase === "lobby") {
    E.actionTitle.textContent = "等待开始";
    E.actionArea.textContent = "玩家到齐后由房主开始游戏。";
  } else {
    E.actionTitle.textContent = "正在结算";
    E.actionArea.textContent = "牌将按照数字从小到大依次放入牌列。";
  }
}

function startCountdown(deadline) {
  clearInterval(countdownTimer);
  const tick = () => {
    if (!deadline) {
      E.timerText.textContent = "--";
      E.timerBar.style.width = "0";
      return;
    }
    const left = Math.max(0, deadline - Date.now());
    E.timerText.textContent = `${Math.ceil(left / 1000)}s`;
    E.timerBar.style.width = `${left / (ACTION_SECONDS * 10)}%`;
  };
  tick();
  countdownTimer = setInterval(tick, 200);
}

async function init() {
  try {
    const response = await fetch("/api/config", { cache: "no-store" });
    if (response.ok) requireProtocol(await response.json());
    E.connectionStatus.textContent = "联机服务可用";
  } catch {
    E.connectionStatus.textContent = "请通过 signal-server.js 打开";
  }
  E.hostModeButton.onclick = () => setMode("host");
  E.guestModeButton.onclick = () => setMode("guest");
  E.createRoomButton.onclick = createRoom;
  E.joinRoomButton.onclick = joinRoom;
  E.roomCodeInput.oninput = () => {
    E.roomCodeInput.value = E.roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  };
  E.roomPlayerCountSelect.onchange = changeCapacity;
  E.startGameButton.onclick = startGame;
  E.endGameButton.onclick = endGame;
  E.toggleLogButton.onclick = () => E.logList.classList.toggle("collapsed");
  setMode("host");
}

init();
