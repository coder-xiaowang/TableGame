"use strict";

const CATEGORIES = [
  { id: "ones", name: "一点", help: "所有一点骰子之和", section: "upper", face: 1 },
  { id: "twos", name: "二点", help: "所有二点骰子之和", section: "upper", face: 2 },
  { id: "threes", name: "三点", help: "所有三点骰子之和", section: "upper", face: 3 },
  { id: "fours", name: "四点", help: "所有四点骰子之和", section: "upper", face: 4 },
  { id: "fives", name: "五点", help: "所有五点骰子之和", section: "upper", face: 5 },
  { id: "sixes", name: "六点", help: "所有六点骰子之和", section: "upper", face: 6 },
  { id: "threeKind", name: "三条", help: "至少三颗相同，五骰总和", section: "lower" },
  { id: "fourKind", name: "四条", help: "至少四颗相同，五骰总和", section: "lower" },
  { id: "fullHouse", name: "葫芦", help: "三颗相同加两颗相同 · 25", section: "lower" },
  { id: "smallStraight", name: "小顺子", help: "任意四连 · 30", section: "lower" },
  { id: "largeStraight", name: "大顺子", help: "五连 · 40", section: "lower" },
  { id: "yahtzee", name: "快艇", help: "五颗相同 · 50", section: "lower" },
  { id: "chance", name: "机会", help: "五颗骰子总和", section: "lower" }
];

let mode = "host";
let selfId = "";
let roomCode = "";
let hostClientId = "";
let signalEvents = null;
let state = null;
let guestView = null;
let selectedScorePlayerId = "";

const $ = (id) => document.getElementById(id);
const elements = {
  connectionStatus: $("connectionStatus"), setupPanel: $("setupPanel"), roomPanel: $("roomPanel"),
  hostModeButton: $("hostModeButton"), guestModeButton: $("guestModeButton"), hostSetup: $("hostSetup"), guestSetup: $("guestSetup"),
  hostNameInput: $("hostNameInput"), guestNameInput: $("guestNameInput"), playerCountSelect: $("playerCountSelect"),
  createRoomButton: $("createRoomButton"), joinRoomButton: $("joinRoomButton"), roomCodeInput: $("roomCodeInput"),
  roomCodeDisplay: $("roomCodeDisplay"), hostTools: $("hostTools"), roomPlayerCountSelect: $("roomPlayerCountSelect"),
  startGameButton: $("startGameButton"), endGameButton: $("endGameButton"), playerList: $("playerList"), playerCountBadge: $("playerCountBadge"),
  gameNotice: $("gameNotice"), turnTitle: $("turnTitle"), roundBadge: $("roundBadge"), rollBadge: $("rollBadge"),
  diceTray: $("diceTray"), turnActions: $("turnActions"), scorePlayerSelect: $("scorePlayerSelect"), scoreSummary: $("scoreSummary"), scoreGrid: $("scoreGrid")
};

function uid(prefix) { return `${prefix}_${Math.random().toString(36).slice(2, 10)}`; }
function newScorecard() { return Object.fromEntries(CATEGORIES.map((category) => [category.id, null])); }
function cleanName(value, fallback) { return String(value || "").trim().slice(0, 12) || fallback; }
function escapeHtml(value) { return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }

async function postJson(path, body) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(await response.text() || `Request failed: ${response.status}`);
  return response.json();
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config", { cache: "no-store" });
    if (response.ok) elements.connectionStatus.textContent = "联机服务可用";
  } catch { elements.connectionStatus.textContent = "请通过 signal-server.js 打开游戏"; }
}

function openSignalEvents(clientId) {
  if (signalEvents) signalEvents.close();
  signalEvents = new EventSource(`/api/events?clientId=${encodeURIComponent(clientId)}`);
  signalEvents.addEventListener("signal", (event) => handleSignal(JSON.parse(event.data)));
  signalEvents.addEventListener("open", () => { elements.connectionStatus.textContent = roomCode ? `已连接房间 ${roomCode}` : "联机服务已连接"; });
  signalEvents.addEventListener("error", () => { elements.connectionStatus.textContent = "联机服务正在重连"; });
}

async function sendSignal(to, payload) { await postJson("/api/signal", { roomCode, from: selfId, to, payload }); }

function handleSignal(message) {
  const payload = message.payload;
  if (mode === "host" && payload?.kind === "hello") { admitPlayer(message.from, payload.name); return; }
  if (mode === "host" && payload?.kind === "action") { applyAction(message.from, payload.action); return; }
  if (mode === "guest" && payload?.kind === "view") { guestView = payload.view; selectedScorePlayerId ||= selfId; enterRoom(); render(); return; }
  if (mode === "guest" && payload?.kind === "rejected") {
    if (signalEvents) signalEvents.close();
    alert(payload.message || "无法加入房间。");
    elements.connectionStatus.textContent = "加入失败";
  }
}

function setMode(nextMode) {
  mode = nextMode;
  elements.hostModeButton.classList.toggle("active", mode === "host");
  elements.guestModeButton.classList.toggle("active", mode === "guest");
  elements.hostSetup.classList.toggle("hidden", mode !== "host");
  elements.guestSetup.classList.toggle("hidden", mode !== "guest");
}

function enterRoom() {
  elements.setupPanel.classList.add("hidden");
  elements.roomPanel.classList.remove("hidden");
  elements.hostTools.classList.toggle("hidden", mode !== "host");
  elements.roomCodeDisplay.textContent = roomCode;
}

function makePlayer(id, name, isHost = false) {
  return { id, name, isHost, connected: true, scorecard: newScorecard(), yahtzeeBonus: 0 };
}

async function createRoom() {
  selfId = uid("host");
  const playerCount = Number(elements.playerCountSelect.value);
  state = {
    phase: "lobby", playerCount, players: [makePlayer(selfId, cleanName(elements.hostNameInput.value, "房主"), true)],
    currentPlayerIndex: 0, completedTurns: 0, dice: [null, null, null, null, null], held: [false, false, false, false, false], rolls: 0
  };
  try {
    const result = await postJson("/api/rooms", { hostId: selfId });
    roomCode = result.roomCode;
    selectedScorePlayerId = selfId;
    elements.roomPlayerCountSelect.value = String(playerCount);
    openSignalEvents(selfId); enterRoom(); render();
  } catch { alert("无法创建房间。请先运行 node game3/signal-server.js，再从服务地址打开页面。"); }
}

async function joinRoom() {
  const code = elements.roomCodeInput.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) { alert("请输入 4 位房间号。"); return; }
  selfId = uid("guest"); roomCode = code;
  try {
    const room = await postJson("/api/join", { roomCode });
    hostClientId = room.hostId;
    selectedScorePlayerId = selfId;
    openSignalEvents(selfId);
    await sendSignal(hostClientId, { kind: "hello", name: cleanName(elements.guestNameInput.value, "玩家") });
    elements.connectionStatus.textContent = `正在加入 ${roomCode}`;
  } catch { alert("没有找到该房间，或联机服务未启动。"); }
}

function admitPlayer(playerId, name) {
  const existing = state.players.find((player) => player.id === playerId);
  if (existing) { existing.connected = true; broadcastViews(); return; }
  if (state.phase !== "lobby") { sendSignal(playerId, { kind: "rejected", message: "比赛已经开始，无法中途加入。" }); return; }
  if (state.players.length >= state.playerCount) { sendSignal(playerId, { kind: "rejected", message: "房间人数已满。" }); return; }
  state.players.push(makePlayer(playerId, cleanName(name, "玩家")));
  renderAndBroadcast();
}

function changePlayerCount() {
  if (!state || state.phase !== "lobby") return;
  const count = Number(elements.roomPlayerCountSelect.value);
  if (count < state.players.length) { alert("新人数不能少于当前已加入人数。"); elements.roomPlayerCountSelect.value = String(state.playerCount); return; }
  state.playerCount = count; renderAndBroadcast();
}

function startGame() {
  if (mode !== "host" || state.phase !== "lobby") return;
  if (state.players.length !== state.playerCount) { alert(`需要 ${state.playerCount} 名玩家到齐后才能开始。`); return; }
  state.players.forEach((player) => { player.scorecard = newScorecard(); player.yahtzeeBonus = 0; });
  state.phase = "playing"; state.currentPlayerIndex = 0; state.completedTurns = 0; resetTurn(); renderAndBroadcast();
}

function endGame() {
  if (mode !== "host" || !state || state.phase === "lobby") return;
  if (!confirm("确定结束当前游戏并返回准备阶段吗？本局成绩将被清空。")) return;
  state.phase = "lobby"; state.currentPlayerIndex = 0; state.completedTurns = 0; resetTurn();
  state.players.forEach((player) => { player.scorecard = newScorecard(); player.yahtzeeBonus = 0; });
  renderAndBroadcast();
}

function resetTurn() { state.dice = [null, null, null, null, null]; state.held = [false, false, false, false, false]; state.rolls = 0; }
function currentPlayer() { return state?.players[state.currentPlayerIndex] || null; }
function currentRound() {
  if (!state || state.phase === "lobby") return 0;
  if (state.phase === "ended") return 13;
  return Math.floor(state.completedTurns / state.players.length) + 1;
}
function rollDie() { return Math.floor(Math.random() * 6) + 1; }

function submitAction(action) {
  if (mode === "host") applyAction(selfId, action);
  else sendSignal(hostClientId, { kind: "action", action }).catch(() => { elements.connectionStatus.textContent = "操作发送失败，正在等待重连"; });
}

function applyAction(playerId, action) {
  if (!state || state.phase !== "playing" || currentPlayer()?.id !== playerId) return;
  if (action?.type === "roll") {
    if (state.rolls >= 3) return;
    state.dice = state.dice.map((value, index) => state.held[index] && value !== null ? value : rollDie());
    state.rolls += 1; renderAndBroadcast(); return;
  }
  if (action?.type === "hold") {
    const index = Number(action.index);
    if (state.rolls < 1 || state.rolls >= 3 || !Number.isInteger(index) || index < 0 || index > 4) return;
    state.held[index] = !state.held[index]; renderAndBroadcast(); return;
  }
  if (action?.type === "score") scoreTurn(playerId, String(action.category || ""));
}

function diceCounts(dice) {
  const counts = Array(7).fill(0);
  dice.forEach((value) => { if (value >= 1 && value <= 6) counts[value] += 1; });
  return counts;
}

function isYahtzee(dice) { return dice.length === 5 && dice[0] != null && dice.every((value) => value === dice[0]); }

function categoryScore(categoryId, dice) {
  if (dice.some((value) => value == null)) return 0;
  const counts = diceCounts(dice);
  const sum = dice.reduce((total, value) => total + value, 0);
  const unique = [...new Set(dice)].sort((a, b) => a - b);
  const category = CATEGORIES.find((item) => item.id === categoryId);
  if (!category) return 0;
  if (category.section === "upper") return counts[category.face] * category.face;
  if (categoryId === "threeKind") return Math.max(...counts) >= 3 ? sum : 0;
  if (categoryId === "fourKind") return Math.max(...counts) >= 4 ? sum : 0;
  if (categoryId === "fullHouse") return counts.includes(3) && counts.includes(2) ? 25 : 0;
  if (categoryId === "smallStraight") {
    const key = unique.join("");
    return key.includes("1234") || key.includes("2345") || key.includes("3456") ? 30 : 0;
  }
  if (categoryId === "largeStraight") return unique.join("") === "12345" || unique.join("") === "23456" ? 40 : 0;
  if (categoryId === "yahtzee") return isYahtzee(dice) ? 50 : 0;
  if (categoryId === "chance") return sum;
  return 0;
}

function scoreTurn(playerId, categoryId) {
  if (state.rolls < 1) return;
  const player = currentPlayer();
  if (!player || player.id !== playerId || !(categoryId in player.scorecard) || player.scorecard[categoryId] !== null) return;
  const extraYahtzee = isYahtzee(state.dice) && player.scorecard.yahtzee === 50;
  player.scorecard[categoryId] = categoryScore(categoryId, state.dice);
  if (extraYahtzee) player.yahtzeeBonus += 100;
  state.completedTurns += 1;
  if (state.completedTurns >= state.players.length * CATEGORIES.length) { state.phase = "ended"; resetTurn(); }
  else { state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length; resetTurn(); }
  renderAndBroadcast();
}

function totals(player) {
  const upper = CATEGORIES.filter((category) => category.section === "upper").reduce((sum, category) => sum + (player.scorecard[category.id] || 0), 0);
  const lower = CATEGORIES.filter((category) => category.section === "lower").reduce((sum, category) => sum + (player.scorecard[category.id] || 0), 0);
  const upperBonus = upper >= 63 ? 35 : 0;
  return { upper, upperBonus, lower, yahtzeeBonus: player.yahtzeeBonus, total: upper + upperBonus + lower + player.yahtzeeBonus };
}

function buildView(viewerId) {
  return {
    selfId: viewerId, phase: state.phase, playerCount: state.playerCount, currentPlayerId: currentPlayer()?.id || null,
    currentPlayerIndex: state.currentPlayerIndex, completedTurns: state.completedTurns, round: currentRound(),
    dice: [...state.dice], held: [...state.held], rolls: state.rolls,
    players: state.players.map((player) => ({ ...player, scorecard: { ...player.scorecard }, totals: totals(player) }))
  };
}

function currentView() { return mode === "host" ? (state ? buildView(selfId) : null) : guestView; }

function broadcastViews() {
  if (mode !== "host" || !state) return;
  state.players.filter((player) => player.id !== selfId).forEach((player) => {
    sendSignal(player.id, { kind: "view", view: buildView(player.id) }).catch(() => { player.connected = false; render(); });
  });
}
function renderAndBroadcast() { render(); broadcastViews(); }

const PIP_POSITIONS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
function dieHtml(value, held, canHold, index) {
  if (value == null) return `<button class="die" type="button" disabled><span class="die-placeholder">?</span></button>`;
  const pips = Array.from({ length: 9 }, (_, position) => PIP_POSITIONS[value].includes(position + 1) ? `<i class="pip ${value === 1 ? "gold" : ""}"></i>` : "<i></i>").join("");
  return `<button class="die ${held ? "held" : ""}" data-die-index="${index}" type="button" ${canHold ? "" : "disabled"}><span class="die-face">${pips}</span></button>`;
}

function render() {
  const view = currentView();
  if (!view) return;
  const me = view.players.find((player) => player.id === view.selfId);
  const active = view.players.find((player) => player.id === view.currentPlayerId);
  const myTurn = view.phase === "playing" && view.currentPlayerId === view.selfId;
  elements.roomCodeDisplay.textContent = roomCode;
  elements.playerCountBadge.textContent = `${view.players.length} / ${view.playerCount}`;
  elements.playerList.innerHTML = view.players.map((player, index) => `<div class="player-item ${player.id === view.currentPlayerId && view.phase === "playing" ? "current" : ""}"><div><div class="player-name">${escapeHtml(player.name)}</div><div class="player-meta">${player.isHost ? "房主 · " : ""}${view.phase === "lobby" ? `玩家 ${index + 1}` : `${player.totals.total} 分`}</div></div><i class="online-dot"></i></div>`).join("");

  elements.hostTools.classList.toggle("hidden", mode !== "host");
  elements.roomPlayerCountSelect.value = String(view.playerCount);
  elements.roomPlayerCountSelect.disabled = view.phase !== "lobby";
  elements.startGameButton.classList.toggle("hidden", view.phase !== "lobby");
  elements.startGameButton.disabled = view.players.length !== view.playerCount;
  elements.endGameButton.classList.toggle("hidden", view.phase === "lobby");
  elements.roundBadge.textContent = `第 ${Math.min(view.round, 13)} / 13 轮`;
  elements.rollBadge.textContent = `投掷 ${view.rolls} / 3`;

  if (view.phase === "lobby") {
    elements.gameNotice.textContent = view.players.length === view.playerCount ? "玩家已经到齐，房主可以开始比赛。" : `等待玩家加入，还差 ${view.playerCount - view.players.length} 人。`;
    elements.turnTitle.textContent = "等待比赛开始";
  } else if (view.phase === "ended") {
    const ranking = [...view.players].sort((a, b) => b.totals.total - a.totals.total);
    const best = ranking[0]?.totals.total;
    const winners = ranking.filter((player) => player.totals.total === best).map((player) => player.name).join("、");
    elements.gameNotice.textContent = `比赛结束！${winners} 以 ${best} 分获得最高分。`;
    elements.turnTitle.textContent = "最终排名";
  } else {
    elements.gameNotice.textContent = myTurn ? "轮到你了：投骰、保留需要的骰子，然后选择一个计分格。" : `正在等待 ${active?.name || "玩家"} 完成本回合。`;
    elements.turnTitle.textContent = `${active?.name || "玩家"} 的回合`;
  }

  const canHold = myTurn && view.rolls > 0 && view.rolls < 3;
  elements.diceTray.innerHTML = view.dice.map((value, index) => dieHtml(value, view.held[index], canHold, index)).join("");
  elements.diceTray.querySelectorAll("[data-die-index]").forEach((button) => button.addEventListener("click", () => submitAction({ type: "hold", index: Number(button.dataset.dieIndex) })));

  if (view.phase === "ended") {
    const ranking = [...view.players].sort((a, b) => b.totals.total - a.totals.total);
    elements.turnActions.innerHTML = `<div class="winner-list">${ranking.map((player, index) => `<div class="winner-row"><span>${index + 1}. ${escapeHtml(player.name)}</span><span>${player.totals.total} 分</span></div>`).join("")}</div>`;
  } else if (myTurn) {
    elements.turnActions.innerHTML = `<button class="primary" id="rollButton" type="button" ${view.rolls >= 3 ? "disabled" : ""}>${view.rolls === 0 ? "投掷骰子" : "重投未保留骰子"}</button>`;
    $("rollButton")?.addEventListener("click", () => submitAction({ type: "roll" }));
  } else elements.turnActions.innerHTML = view.phase === "playing" ? "<span class=\"player-meta\">等待当前玩家操作…</span>" : "";

  renderScoreSelector(view);
  const scorePlayer = view.players.find((player) => player.id === selectedScorePlayerId) || me || view.players[0];
  renderScorecard(view, scorePlayer, myTurn && scorePlayer?.id === view.selfId);
}

function renderScoreSelector(view) {
  if (!view.players.some((player) => player.id === selectedScorePlayerId)) selectedScorePlayerId = view.selfId;
  elements.scorePlayerSelect.innerHTML = view.players.map((player) => `<option value="${escapeHtml(player.id)}" ${player.id === selectedScorePlayerId ? "selected" : ""}>${escapeHtml(player.name)}${player.id === view.selfId ? "（我）" : ""}</option>`).join("");
}

function renderScorecard(view, player, canScore) {
  if (!player) return;
  const totalsValue = player.totals;
  elements.scoreSummary.innerHTML = `<div class="summary-item"><span>上半区</span><strong>${totalsValue.upper}</strong></div><div class="summary-item"><span>上半区奖励</span><strong>${totalsValue.upperBonus}</strong></div><div class="summary-item"><span>快艇奖励</span><strong>${totalsValue.yahtzeeBonus}</strong></div><div class="summary-item total"><span>总分</span><strong>${totalsValue.total}</strong></div>`;
  let previousSection = "";
  elements.scoreGrid.innerHTML = CATEGORIES.map((category) => {
    const value = player.scorecard[category.id];
    const available = canScore && view.rolls > 0 && value === null;
    const preview = available ? categoryScore(category.id, view.dice) : null;
    const divider = category.section !== previousSection ? `<div class="upper-divider">${category.section === "upper" ? "上半区" : "下半区"}</div>` : "";
    previousSection = category.section;
    return `${divider}<div class="score-row ${available ? "available" : ""}" ${available ? `data-category="${category.id}"` : ""}><div><div class="score-name">${category.name}</div><div class="score-help">${category.help}</div></div><div class="score-value ${available ? "preview" : ""}">${value === null ? (available ? `+${preview}` : "—") : value}</div></div>`;
  }).join("");
  elements.scoreGrid.querySelectorAll("[data-category]").forEach((row) => row.addEventListener("click", () => {
    const category = CATEGORIES.find((item) => item.id === row.dataset.category);
    const points = categoryScore(row.dataset.category, view.dice);
    if (confirm(`确定将本次结果记入“${category.name}”（${points} 分）吗？`)) submitAction({ type: "score", category: row.dataset.category });
  }));
}

async function init() {
  await loadConfig();
  elements.hostModeButton.addEventListener("click", () => setMode("host"));
  elements.guestModeButton.addEventListener("click", () => setMode("guest"));
  elements.createRoomButton.addEventListener("click", createRoom);
  elements.joinRoomButton.addEventListener("click", joinRoom);
  elements.roomCodeInput.addEventListener("input", () => { elements.roomCodeInput.value = elements.roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });
  elements.roomPlayerCountSelect.addEventListener("change", changePlayerCount);
  elements.startGameButton.addEventListener("click", startGame);
  elements.endGameButton.addEventListener("click", endGame);
  elements.scorePlayerSelect.addEventListener("change", () => { selectedScorePlayerId = elements.scorePlayerSelect.value; render(); });
  setMode("host");
}

init();
