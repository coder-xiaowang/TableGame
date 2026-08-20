"use strict";

import {
  bindRoomCodeInput, cleanPlayerName, createCountdown, createHostTimer, createLogEntry,
  createRoomClient, createSessionStore, escapeHtml, prependLimited, renderConnectionStatus,
  renderCountdown, setHidden, setModeVisibility
} from "/shared/client/index.js";
import { COLUMN_LENGTHS, applyMoves, commitTurn, completedColumns, rollOptions } from "./rules.js";
import { createDicePhysics, simulateDiceRoll } from "./dice-physics.js";

const PROTOCOL_VERSION = 2;
const ACTION_SECONDS = 30;
const COLORS = ["#ef5b4c", "#2589bd", "#f5b82e", "#7557a8"];
const $ = (id) => document.getElementById(id);
const E = Object.fromEntries(["connectionStatus", "setupPanel", "roomPanel", "hostModeButton", "guestModeButton", "hostSetup", "guestSetup", "hostNameInput", "guestNameInput", "playerCountSelect", "createRoomButton", "joinRoomButton", "roomCodeInput", "roomCodeDisplay", "hostTools", "roomPlayerCountSelect", "startGameButton", "endGameButton", "playerCountBadge", "playerList", "phaseBadge", "turnLabel", "notice", "board", "diceCanvas", "timerText", "timerBar", "diceArea", "diceTotal", "actionArea", "toggleLogButton", "logList", "resultPanel", "winnerText", "resultList"].map((id) => [id, $(id)]));

let mode = "host";
let state = null;
let guestView = null;
let dicePhysics = null;
let dicePhysicsPromise = null;
let activePhysicsRollId = 0;
const simulationCache = new Map();
const sessions = createSessionStore({ gameId: "cant-stop" });
const hostTimer = createHostTimer();
const countdown = createCountdown({ onTick(value) { renderCountdown({ textElement: E.timerText, barElement: E.timerBar }, value); } });
const room = createRoomClient({
  protocolVersion: PROTOCOL_VERSION,
  sessionStore: sessions,
  onStatus(status) { renderConnectionStatus(E.connectionStatus, status, room.snapshot().roomCode); },
  handlers: {
    onHello: admitPlayer, onPresence: updatePresence, onAction: applyAction,
    onView(view) { guestView = view; enterRoom(); render(); },
    onRejected(message) { alert(message || "房主拒绝了加入请求。"); location.reload(); },
    onKicked() { alert("你已被房主移出房间。"); location.reload(); }
  }
});

function makePlayer(id, name, isHost = false, index = 0) {
  return { id, name, isHost, connected: true, color: COLORS[index], progress: {}, claimed: [] };
}
function makeLobby(capacity, host) {
  return { phase: "lobby", turnStage: "", capacity, players: [host], currentIndex: 0, turnProgress: {}, dice: [], pendingDice: [], options: [], closed: {}, deadline: 0, revealAt: 0, rollId: 0, physicsSeed: 0, rollFromTimeout: false, winnerId: null, logs: [] };
}
function log(text) { prependLimited(state.logs, createLogEntry(text), 100); }
function currentPlayer() { return state?.players[state.currentIndex] || null; }
function currentView() { return mode === "host" ? (state ? buildView(room.snapshot().playerId) : null) : guestView; }
function renderEntryMode() { setModeVisibility(mode, { ...E, hostButton: E.hostModeButton, guestButton: E.guestModeButton }); }
function enterRoom() { setHidden(E.setupPanel, true); setHidden(E.roomPanel, false); setHidden(E.hostTools, mode !== "host"); E.roomCodeDisplay.textContent = room.snapshot().roomCode; }

async function createGameRoom() {
  const name = cleanPlayerName(E.hostNameInput.value, "房主");
  E.createRoomButton.disabled = true;
  try {
    const result = await room.createRoom({ name });
    state = makeLobby(Number(E.playerCountSelect.value), makePlayer(result.playerId, name, true));
    E.roomPlayerCountSelect.value = String(state.capacity); enterRoom(); render();
  } catch (error) { alert(`创建房间失败：${error.message}\n请确认已通过 node game10/signal-server.js 启动。`); }
  finally { E.createRoomButton.disabled = false; }
}
async function joinGameRoom() {
  E.joinRoomButton.disabled = true;
  try { await room.joinRoom({ code: E.roomCodeInput.value, name: E.guestNameInput.value }); E.connectionStatus.textContent = "已连接，等待房主同步状态"; }
  catch (error) { alert(`加入房间失败：${error.message}`); }
  finally { E.joinRoomButton.disabled = false; }
}
function admitPlayer(playerId, payload) {
  if (!state || mode !== "host") return;
  const existing = state.players.find((player) => player.id === playerId);
  if (existing) { existing.connected = true; return sync(); }
  if (state.phase !== "lobby") return room.reject(playerId, "游戏已经开始，暂时不能加入新玩家。");
  if (state.players.length >= state.capacity) return room.reject(playerId, "房间人数已满。");
  const player = makePlayer(playerId, cleanPlayerName(payload.name, "玩家"), false, state.players.length);
  state.players.push(player); log(`${player.name} 加入了房间`); sync();
}
function updatePresence(playerId, connected) {
  const player = state?.players.find((item) => item.id === playerId);
  if (!player || player.connected === connected) return;
  player.connected = connected; log(`${player.name} ${connected ? "重新连接" : "暂时离线"}`); sync();
}
async function kickPlayer(playerId) {
  if (state.phase !== "lobby") return alert("游戏开始后不能移出玩家。");
  const player = state.players.find((item) => item.id === playerId);
  if (!player || player.isHost || !confirm(`确定将 ${player.name} 移出房间吗？`)) return;
  try { await room.kick(playerId); state.players = state.players.filter((item) => item.id !== playerId); state.players.forEach((item, index) => { item.color = COLORS[index]; }); log(`${player.name} 被移出房间`); sync(); }
  catch (error) { alert(`移出失败：${error.message}`); }
}
function changeCapacity() {
  if (!state || state.phase !== "lobby") return;
  const capacity = Number(E.roomPlayerCountSelect.value);
  if (capacity < state.players.length) { E.roomPlayerCountSelect.value = String(state.capacity); return alert("人数不能少于当前已加入的玩家数。"); }
  state.capacity = capacity; sync();
}
function startGame() {
  if (!state || state.phase !== "lobby") return;
  if (state.players.length !== state.capacity) return alert(`需要 ${state.capacity} 位玩家到齐。`);
  if (state.players.some((player) => !player.connected)) return alert("请等待所有玩家恢复连接后再开始。");
  state.players.forEach((player) => { player.progress = {}; player.claimed = []; });
  Object.assign(state, { phase: "playing", currentIndex: Math.floor(Math.random() * state.players.length), turnProgress: {}, dice: [], pendingDice: [], options: [], closed: {}, revealAt: 0, rollId: 0, physicsSeed: 0, winnerId: null, logs: [] });
  log(`游戏开始，${currentPlayer().name} 首先攀登`); beginStage("roll");
}
function endGameEarly() {
  if (state?.phase !== "playing" || !confirm("确定结束当前游戏并返回大厅吗？")) return;
  hostTimer.clear(); Object.assign(state, { phase: "lobby", turnStage: "", turnProgress: {}, dice: [], pendingDice: [], options: [], closed: {}, deadline: 0, revealAt: 0, physicsSeed: 0, winnerId: null, logs: [] }); dicePhysics?.hide(); sync();
}
function beginStage(stage) {
  hostTimer.clear(); state.turnStage = stage;
  state.deadline = hostTimer.schedule(ACTION_SECONDS, () => {
    if (state.phase !== "playing") return;
    if (state.turnStage === "choose" && state.options.length) chooseOption(state.options[0].key, true);
    else if (state.turnStage === "decision") stopTurn(true);
    else rollDice(true);
  });
  sync();
}
async function rollDice(fromTimeout = false) {
  if (state.phase !== "playing" || !["roll", "decision"].includes(state.turnStage)) return;
  hostTimer.clear();
  state.turnStage = "preparing";
  state.rollId += 1;
  state.rollFromTimeout = fromTimeout;
  state.physicsSeed = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  state.dice = [];
  state.pendingDice = [];
  state.options = [];
  state.deadline = 0;
  state.revealAt = 0;
  const rollId = state.rollId;
  sync();
  try {
    const simulation = await getSimulation(state.physicsSeed);
    if (state.phase !== "playing" || state.turnStage !== "preparing" || state.rollId !== rollId) return;
    state.pendingDice = [...simulation.results];
    state.turnStage = "rolling";
    state.revealAt = Date.now() + simulation.durationMs;
    hostTimer.scheduleAt(state.revealAt, revealRoll);
    sync();
  } catch (error) {
    if (state.rollId !== rollId) return;
    state.pendingDice = Array.from({ length:4 }, () => Math.floor(Math.random() * 6) + 1);
    state.turnStage = "rolling";
    state.revealAt = Date.now() + 900;
    E.connectionStatus.title = `物理骰子降级：${error.message}`;
    hostTimer.scheduleAt(state.revealAt, revealRoll);
    sync();
  }
}
function revealRoll() {
  if (state.phase !== "playing" || state.turnStage !== "rolling") return;
  state.dice = [...state.pendingDice];
  state.pendingDice = [];
  state.options = rollOptions(state.dice, state.turnProgress, Object.keys(state.closed).map(Number));
  log(`${currentPlayer().name}${state.rollFromTimeout ? "超时，自动" : ""}掷出了 ${state.dice.join("、")}`);
  state.rollFromTimeout = false;
  state.turnStage = "settled";
  state.revealAt = Date.now() + 700;
  hostTimer.scheduleAt(state.revealAt, finishRollReveal);
  sync();
}
function finishRollReveal() {
  if (state.phase !== "playing" || state.turnStage !== "settled") return;
  state.revealAt = 0;
  if (!state.options.length) return bustTurn();
  beginStage("choose");
}
function chooseOption(key, fromTimeout = false) {
  if (state.phase !== "playing" || state.turnStage !== "choose") return;
  const option = state.options.find((item) => item.key === key); if (!option) return;
  state.turnProgress = applyMoves(state.turnProgress, currentPlayer().progress, option.moves);
  log(`${currentPlayer().name}${fromTimeout ? "超时，自动" : ""}推进 ${option.moves.join("、")} 号路线`);
  state.options = []; beginStage("decision");
}
function stopTurn(fromTimeout = false) {
  if (state.phase !== "playing" || state.turnStage !== "decision") return;
  hostTimer.clear(); const player = currentPlayer(); player.progress = commitTurn(player.progress, state.turnProgress);
  const newlyClaimed = completedColumns(player.progress).filter((column) => !state.closed[column]);
  for (const column of newlyClaimed) { state.closed[column] = player.id; player.claimed.push(column); }
  log(`${player.name}${fromTimeout ? "超时，自动" : ""}选择扎营${newlyClaimed.length ? `，占领 ${newlyClaimed.join("、")} 号路线` : ""}`);
  if (player.claimed.length >= 3) { state.phase = "ended"; state.winnerId = player.id; state.turnStage = ""; state.deadline = 0; log(`${player.name} 占领三条路线，赢得游戏`); return sync(); }
  nextTurn();
}
function bustTurn() { log(`${currentPlayer().name} 无路可走，本回合攀登成果全部丢失`); nextTurn(); }
function nextTurn() { hostTimer.clear(); state.turnProgress = {}; state.dice = []; state.pendingDice = []; state.options = []; state.revealAt = 0; state.physicsSeed = 0; activePhysicsRollId = 0; dicePhysics?.hide(); state.currentIndex = (state.currentIndex + 1) % state.players.length; beginStage("roll"); }
function applyAction(playerId, action) {
  if (state?.phase !== "playing" || currentPlayer()?.id !== playerId) return;
  if (action?.type === "roll") rollDice();
  else if (action?.type === "choose") chooseOption(String(action.key));
  else if (action?.type === "stop") stopTurn();
}
function buildView(viewerId) { const { pendingDice, ...publicState } = state; return { ...publicState, selfId: viewerId, players: state.players.map((player) => ({ ...player, progress: { ...player.progress }, claimed: [...player.claimed] })), turnProgress: { ...state.turnProgress }, closed: { ...state.closed }, options: state.options.map((option) => ({ ...option, pair: [...option.pair], moves: [...option.moves] })), logs: [...state.logs] }; }
function broadcast() { if (mode !== "host" || !state) return; for (const player of state.players) if (!player.isHost) room.sendView(player.id, buildView(player.id)).catch(() => {}); }
function sync() { render(); broadcast(); }
function submit(action) { Promise.resolve(room.submitAction(action)).catch((error) => { E.connectionStatus.textContent = `操作发送失败：${error.message}`; }); }

function markerHtml(view, column, step) {
  const markers = [];
  const campers = view.players.filter((player) => (player.progress[column] || 0) === step && !view.closed[column]);
  campers.forEach((player, index) => markers.push(`<i class="camp" style="--color:${player.color};--camp-x:${campers.length === 1 ? 9 : index * (34 / Math.max(1, campers.length - 1))}%" title="${escapeHtml(player.name)}"><span></span></i>`));
  if (view.phase === "playing" && (view.turnProgress[column] || 0) === step) markers.push(`<i class="runner" style="--color:${view.players[view.currentIndex].color}" title="${escapeHtml(view.players[view.currentIndex].name)}的临时登山者"><span class="runner-head"></span><span class="runner-body"></span><span class="runner-pack"></span></i>`);
  return markers.join("");
}
function renderBoard(view) {
  const scenery = `<div class="mountain-scenery" aria-hidden="true">
    <svg viewBox="0 0 1200 650" preserveAspectRatio="none">
      <defs>
        <linearGradient id="farMountain" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8ced0"/><stop offset="1" stop-color="#76958b"/></linearGradient>
        <linearGradient id="nearMountain" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#829a83"/><stop offset="1" stop-color="#486b58"/></linearGradient>
      </defs>
      <path class="cloud cloud-a" d="M55 126c30-46 78-38 91 2 31-19 70 2 66 37H22c-5-25 10-38 33-39z"/>
      <path class="cloud cloud-b" d="M914 98c24-38 70-33 85 0 33-18 72 4 68 36H884c-2-21 10-34 30-36z"/>
      <path fill="url(#farMountain)" d="M0 385 145 206l73 82 126-177 115 159 82-104 92 121 139-205 146 210 78-105 204 220v243H0z"/>
      <path class="snow snow-far" d="m292 183 52-72 54 75-27-18-18 22-14-31-20 27zM700 188l72-106 78 112-40-29-25 25-20-43-28 43z"/>
      <path fill="url(#nearMountain)" d="M0 512 182 319l109 103 163-251 147 214 93-124 93 126 111-174 302 298v139H0z"/>
      <path class="snow" d="m356 321 98-150 87 126-42-29-30 30-25-54-37 64-22-25zM825 327l73-114 96 95-49-21-26 31-28-51-31 54z"/>
      <path class="ridge" d="M0 512 182 319l109 103 163-251 147 214 93-124 93 126 111-174 302 298"/>
      <g class="trees"><path d="m44 503 18-49 18 49h-11l15 35H40l15-35zm976-30 20-56 20 56h-12l17 39h-49l17-39zm91 57 15-43 15 43h-9l13 30h-38l12-30z"/></g>
    </svg>
    <div class="mist mist-one"></div><div class="mist mist-two"></div>
  </div>`;
  E.board.innerHTML = scenery + Object.entries(COLUMN_LENGTHS).map(([key, length]) => {
    const column = Number(key); const owner = view.players.find((player) => player.id === view.closed[column]);
    const cells = Array.from({ length }, (_, index) => {
      const step = length - index;
      const drift = Math.round(Math.sin((column * 1.7 + step) * 1.35) * 7);
      return `<div class="route-cell" style="--drift:${drift}px;--tilt:${(drift / 2).toFixed(1)}deg;--step:${index}">${markerHtml(view, column, step)}</div>`;
    }).join("");
    const summit = owner
      ? `<span class="claim-flag" style="--flag:${owner.color}" title="${escapeHtml(owner.name)}占领"><i></i></span>`
      : '<span class="summit-peak">◆</span>';
    return `<div class="route ${owner ? "claimed" : ""}" style="--route:${length};--owner:${owner?.color || "transparent"}"><div class="summit">${summit}</div>${cells}<b><span>${column}</span></b></div>`;
  }).join("");
}
function getSimulation(seed) {
  const key = String(Number(seed) >>> 0);
  if (!simulationCache.has(key)) simulationCache.set(key, simulateDiceRoll(Number(seed)));
  return simulationCache.get(key);
}
function getDicePhysics() {
  if (dicePhysics) return Promise.resolve(dicePhysics);
  if (!dicePhysicsPromise) dicePhysicsPromise = createDicePhysics({ canvas:E.diceCanvas }).then((value) => (dicePhysics = value));
  return dicePhysicsPromise;
}
function renderPhysicsDice(view) {
  const visible = view.phase === "playing" && ["rolling", "settled"].includes(view.turnStage) && view.physicsSeed;
  if (!visible) { activePhysicsRollId = 0; dicePhysics?.hide(); return; }
  if (activePhysicsRollId === view.rollId) return;
  activePhysicsRollId = view.rollId;
  Promise.all([getDicePhysics(), getSimulation(view.physicsSeed)]).then(([physics, simulation]) => {
    if (activePhysicsRollId !== view.rollId) return;
    const elapsedMs = view.turnStage === "rolling"
      ? Math.max(0, simulation.durationMs - Math.max(0, view.revealAt - Date.now()))
      : simulation.durationMs;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) physics.renderFinal(simulation);
    else physics.play(simulation, { elapsedMs });
  }).catch((error) => {
    E.diceCanvas.classList.remove("visible");
    E.connectionStatus.title = `WebGL 骰子不可用：${error.message}`;
  });
}
function render() {
  const view = currentView(); if (!view) return;
  const current = view.players[view.currentIndex]; const myTurn = view.phase === "playing" && current?.id === view.selfId;
  E.roomCodeDisplay.textContent = room.snapshot().roomCode; E.roomPlayerCountSelect.value = String(view.capacity); E.roomPlayerCountSelect.disabled = view.phase !== "lobby";
  E.playerCountBadge.textContent = `${view.players.length} / ${view.capacity}`; E.startGameButton.disabled = view.phase !== "lobby" || view.players.length !== view.capacity || view.players.some((p) => !p.connected);
  setHidden(E.startGameButton, view.phase !== "lobby"); setHidden(E.endGameButton, mode !== "host" || view.phase !== "playing");
  E.phaseBadge.textContent = { lobby: "准备阶段", playing: "攀登中", ended: "登顶完成" }[view.phase]; E.turnLabel.textContent = view.phase === "playing" ? `${current.name} 的回合` : view.phase === "ended" ? "游戏结束" : "等待开始";
  E.playerList.innerHTML = view.players.map((player, index) => `<article class="player-item ${player.id === view.selfId ? "player-self" : ""} ${index === view.currentIndex && view.phase === "playing" ? "player-current" : ""} ${!player.connected ? "player-offline" : ""}" style="--player:${player.color}"><div><i class="player-color"></i><b>${escapeHtml(player.name)}</b>${player.isHost ? "<em>房主</em>" : ""}</div><span>已占领 ${player.claimed.length} / 3</span><small>${player.claimed.length ? player.claimed.join("、") + " 号路线" : "尚未占领路线"}</small>${mode === "host" && view.phase === "lobby" && !player.isHost ? `<button data-kick="${player.id}">移出</button>` : ""}</article>`).join("");
  E.playerList.querySelectorAll("[data-kick]").forEach((button) => { button.onclick = () => kickPlayer(button.dataset.kick); });
  if (view.phase === "lobby") E.notice.textContent = `等待 ${view.capacity} 位玩家到齐后，由房主开始游戏`;
  else if (view.phase === "ended") E.notice.textContent = "三座峰顶已经被同一位玩家占领";
  else if (view.turnStage === "preparing") E.notice.textContent = `${current.name} 正在将骰子撒入投掷盘……`;
  else if (view.turnStage === "rolling") E.notice.textContent = `${current.name} 的骰子正在投掷盘中碰撞翻滚……`;
  else if (view.turnStage === "settled") E.notice.textContent = `骰子已经停稳：${view.dice.join("、")}`;
  else if (!myTurn) E.notice.textContent = `等待 ${current.name} ${view.turnStage === "choose" ? "选择骰子组合" : view.turnStage === "decision" ? "继续攀登或扎营" : "掷骰子"}`;
  else E.notice.textContent = { roll: "轮到你了，掷出四颗骰子开始攀登", choose: "选择一种可用的骰子组合", decision: "继续掷骰冒险，或扎营保住进度" }[view.turnStage];
  renderBoard(view);
  renderPhysicsDice(view);
  const publicDice = ["preparing", "rolling"].includes(view.turnStage) ? ["?", "?", "?", "?"] : (view.dice.length ? view.dice : ["?", "?", "?", "?"]);
  E.diceArea.innerHTML = publicDice.map((die) => `<span class="die ${die === "?" ? "empty" : ""}">${die}</span>`).join(""); E.diceTotal.textContent = view.dice.length && view.turnStage !== "rolling" ? `总和 ${view.dice.reduce((a, b) => a + b, 0)}` : "";
  E.actionArea.innerHTML = "";
  if (myTurn && view.turnStage === "roll") E.actionArea.innerHTML = '<button class="primary big-action" data-action="roll">掷骰子</button>';
  if (myTurn && view.turnStage === "choose") E.actionArea.innerHTML = view.options.map((option) => `<button class="choice-action" data-choice="${option.key}"><span>${option.pair.join(" + ")}</span><small>推进 ${option.moves.join("、")}</small></button>`).join("");
  if (myTurn && view.turnStage === "decision") E.actionArea.innerHTML = '<button class="primary big-action" data-action="roll">继续掷骰</button><button class="stop-action" data-action="stop">扎营收手</button>';
  E.actionArea.querySelectorAll("[data-action]").forEach((button) => { button.onclick = () => submit({ type: button.dataset.action }); }); E.actionArea.querySelectorAll("[data-choice]").forEach((button) => { button.onclick = () => submit({ type: "choose", key: button.dataset.choice }); });
  E.logList.innerHTML = view.logs.map((entry) => `<p>${escapeHtml(entry.text)}</p>`).join("") || '<p class="muted">暂无记录</p>';
  if (view.phase === "playing" && view.deadline) countdown.start(view.deadline, ACTION_SECONDS * 1000); else { countdown.stop(); E.timerText.textContent = "--"; E.timerBar.style.width = "0"; }
  setHidden(E.resultPanel, view.phase !== "ended"); if (view.phase === "ended") { const winner = view.players.find((player) => player.id === view.winnerId); E.winnerText.textContent = `${winner?.name || "玩家"} 征服了山峰！`; E.resultList.innerHTML = view.players.map((player) => `<p><i style="background:${player.color}"></i><b>${escapeHtml(player.name)}</b><span>${player.claimed.length} 条路线</span></p>`).join(""); }
}

async function init() {
  bindRoomCodeInput(E.roomCodeInput); E.hostModeButton.onclick = () => { mode = "host"; renderEntryMode(); }; E.guestModeButton.onclick = () => { mode = "guest"; renderEntryMode(); };
  E.createRoomButton.onclick = createGameRoom; E.joinRoomButton.onclick = joinGameRoom; E.roomPlayerCountSelect.onchange = changeCapacity; E.startGameButton.onclick = startGame; E.endGameButton.onclick = endGameEarly;
  E.toggleLogButton.onclick = () => { E.logList.classList.toggle("collapsed"); E.toggleLogButton.textContent = E.logList.classList.contains("collapsed") ? "展开" : "收起"; };
  renderEntryMode();
  const previewSeed = Number(new URLSearchParams(location.search).get("physicsTest"));
  if (Number.isInteger(previewSeed) && previewSeed > 0) {
    mode = "host";
    state = makeLobby(2, makePlayer("preview-host", "物理预览", true));
    const simulation = await getSimulation(previewSeed);
    Object.assign(state, { phase:"playing", turnStage:"rolling", rollId:1, physicsSeed:previewSeed, pendingDice:[...simulation.results], revealAt:Date.now() + simulation.durationMs, currentIndex:0 });
    enterRoom(); render(); E.roomCodeDisplay.textContent = "PHYSICS";
    hostTimer.scheduleAt(state.revealAt, revealRoll);
    return;
  }
  try { await room.checkServer(); } catch { E.connectionStatus.title = "请运行 node game10/signal-server.js"; }
}
init();
