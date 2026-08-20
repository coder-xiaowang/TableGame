"use strict";

import {
  bindRoomCodeInput, cleanPlayerName, createCountdown, createHostTimer, createLogEntry,
  createRoomClient, createSessionStore, escapeHtml, prependLimited, renderConnectionStatus,
  renderCountdown, setHidden, setModeVisibility
} from "/shared/client/index.js";
import { COLUMN_LENGTHS, applyMoves, commitTurn, completedColumns, rollOptions } from "./rules.js";

const PROTOCOL_VERSION = 2;
const ACTION_SECONDS = 30;
const COLORS = ["#ef5b4c", "#2589bd", "#f5b82e", "#7557a8"];
const $ = (id) => document.getElementById(id);
const E = Object.fromEntries(["connectionStatus", "setupPanel", "roomPanel", "hostModeButton", "guestModeButton", "hostSetup", "guestSetup", "hostNameInput", "guestNameInput", "playerCountSelect", "createRoomButton", "joinRoomButton", "roomCodeInput", "roomCodeDisplay", "hostTools", "roomPlayerCountSelect", "startGameButton", "endGameButton", "playerCountBadge", "playerList", "phaseBadge", "turnLabel", "notice", "board", "timerText", "timerBar", "diceArea", "diceTotal", "actionArea", "toggleLogButton", "logList", "resultPanel", "winnerText", "resultList"].map((id) => [id, $(id)]));

let mode = "host";
let state = null;
let guestView = null;
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
  return { phase: "lobby", turnStage: "", capacity, players: [host], currentIndex: 0, turnProgress: {}, dice: [], options: [], closed: {}, deadline: 0, winnerId: null, logs: [] };
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
  Object.assign(state, { phase: "playing", currentIndex: Math.floor(Math.random() * state.players.length), turnProgress: {}, dice: [], options: [], closed: {}, winnerId: null, logs: [] });
  log(`游戏开始，${currentPlayer().name} 首先攀登`); beginStage("roll");
}
function endGameEarly() {
  if (state?.phase !== "playing" || !confirm("确定结束当前游戏并返回大厅吗？")) return;
  hostTimer.clear(); Object.assign(state, { phase: "lobby", turnStage: "", turnProgress: {}, dice: [], options: [], closed: {}, deadline: 0, winnerId: null, logs: [] }); sync();
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
function rollDice(fromTimeout = false) {
  if (state.phase !== "playing" || !["roll", "decision"].includes(state.turnStage)) return;
  hostTimer.clear(); state.dice = Array.from({ length: 4 }, () => Math.floor(Math.random() * 6) + 1);
  state.options = rollOptions(state.dice, state.turnProgress, Object.keys(state.closed).map(Number));
  log(`${currentPlayer().name}${fromTimeout ? "超时，自动" : ""}掷出了 ${state.dice.join("、")}`);
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
function nextTurn() { hostTimer.clear(); state.turnProgress = {}; state.dice = []; state.options = []; state.currentIndex = (state.currentIndex + 1) % state.players.length; beginStage("roll"); }
function applyAction(playerId, action) {
  if (state?.phase !== "playing" || currentPlayer()?.id !== playerId) return;
  if (action?.type === "roll") rollDice();
  else if (action?.type === "choose") chooseOption(String(action.key));
  else if (action?.type === "stop") stopTurn();
}
function buildView(viewerId) { return { ...state, selfId: viewerId, players: state.players.map((player) => ({ ...player, progress: { ...player.progress }, claimed: [...player.claimed] })), turnProgress: { ...state.turnProgress }, closed: { ...state.closed }, options: state.options.map((option) => ({ ...option, pair: [...option.pair], moves: [...option.moves] })), logs: [...state.logs] }; }
function broadcast() { if (mode !== "host" || !state) return; for (const player of state.players) if (!player.isHost) room.sendView(player.id, buildView(player.id)).catch(() => {}); }
function sync() { render(); broadcast(); }
function submit(action) { Promise.resolve(room.submitAction(action)).catch((error) => { E.connectionStatus.textContent = `操作发送失败：${error.message}`; }); }

function markerHtml(view, column, step) {
  const markers = [];
  for (const player of view.players) if ((player.progress[column] || 0) === step && !view.closed[column]) markers.push(`<i class="camp" style="--color:${player.color}" title="${escapeHtml(player.name)}"></i>`);
  if (view.phase === "playing" && (view.turnProgress[column] || 0) === step) markers.push(`<i class="runner" style="--color:${view.players[view.currentIndex].color}">▲</i>`);
  return markers.join("");
}
function renderBoard(view) {
  E.board.innerHTML = Object.entries(COLUMN_LENGTHS).map(([key, length]) => {
    const column = Number(key); const owner = view.players.find((player) => player.id === view.closed[column]);
    const cells = Array.from({ length }, (_, index) => `<div class="route-cell">${markerHtml(view, column, length - index)}</div>`).join("");
    return `<div class="route ${owner ? "claimed" : ""}" style="--route:${length};--owner:${owner?.color || "transparent"}"><div class="summit">${owner ? "★" : "▲"}</div>${cells}<b>${column}</b></div>`;
  }).join("");
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
  else if (!myTurn) E.notice.textContent = `等待 ${current.name} ${view.turnStage === "choose" ? "选择骰子组合" : view.turnStage === "decision" ? "继续攀登或扎营" : "掷骰子"}`;
  else E.notice.textContent = { roll: "轮到你了，掷出四颗骰子开始攀登", choose: "选择一种可用的骰子组合", decision: "继续掷骰冒险，或扎营保住进度" }[view.turnStage];
  renderBoard(view);
  E.diceArea.innerHTML = (view.dice.length ? view.dice : ["?", "?", "?", "?"]).map((die) => `<span class="die ${die === "?" ? "empty" : ""}">${die}</span>`).join(""); E.diceTotal.textContent = view.dice.length ? `总和 ${view.dice.reduce((a, b) => a + b, 0)}` : "";
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
  renderEntryMode(); try { await room.checkServer(); } catch { E.connectionStatus.title = "请运行 node game10/signal-server.js"; }
}
init();
