"use strict";

import {
  bindRoomCodeInput, cleanPlayerName, createAuthoritativeRoomClient, createCountdown,
  createSessionStore, createSpectatorUi, escapeHtml, renderConnectionStatus,
  renderCountdown, setHidden, setModeVisibility
} from "/shared/client/index.js";
import { COLUMN_LENGTHS } from "./rules.js";
import { createDicePhysics, simulateDiceRoll } from "./dice-physics.js";

const PROTOCOL_VERSION = 3;
const ACTION_SECONDS = 30;
const $ = (id) => document.getElementById(id);
const E = Object.fromEntries(["connectionStatus", "setupPanel", "roomPanel", "hostModeButton", "guestModeButton", "hostSetup", "guestSetup", "hostNameInput", "guestNameInput", "playerCountSelect", "createRoomButton", "joinRoomButton", "roomCodeInput", "joinIntentField", "roomCodeDisplay", "hostTools", "roomPlayerCountSelect", "spectatorSettingButton", "roomRoleBanner", "roomRoleTitle", "roomRoleHint", "seatActionButton", "spectatorPanel", "spectatorCountBadge", "spectatorList", "startGameButton", "endGameButton", "playerCountBadge", "playerList", "phaseBadge", "turnLabel", "notice", "board", "diceCanvas", "timerText", "timerBar", "diceArea", "diceTotal", "actionArea", "toggleLogButton", "logList", "resultPanel", "winnerText", "resultList", "resultActions", "playAgainButton"].map((id) => [id, $(id)]));

let mode = "host";
let view = null;
let dicePhysics = null;
let dicePhysicsPromise = null;
let activePhysicsRollId = 0;
let spectatorUi = null;
const simulationCache = new Map();
const sessions = createSessionStore({ gameId: "cant-stop" });
const countdown = createCountdown({ onTick(value) { renderCountdown({ textElement: E.timerText, barElement: E.timerBar }, value); } });
const room = createAuthoritativeRoomClient({
  protocolVersion: PROTOCOL_VERSION,
  sessionStore: sessions,
  onStatus(status) { renderConnectionStatus(E.connectionStatus, status, room.snapshot().roomCode); },
  handlers: {
    onView(nextView) { view = nextView; enterRoom(); render(); },
    onKicked() { spectatorUi?.handleSessionEnded("kicked"); },
    onRoomExpired() { spectatorUi?.handleSessionEnded("room_expired"); }
  }
});

spectatorUi = createSpectatorUi({
  room,
  getView: () => view,
  elements: {
    joinIntentField: E.joinIntentField, roomRoleBanner: E.roomRoleBanner, roomRoleTitle: E.roomRoleTitle,
    roomRoleHint: E.roomRoleHint, seatActionButton: E.seatActionButton, spectatorSettingButton: E.spectatorSettingButton,
    spectatorPanel: E.spectatorPanel, spectatorCountBadge: E.spectatorCountBadge, spectatorList: E.spectatorList
  },
  notify: (message) => alert(message),
  confirmAction: (message) => confirm(message),
  onSessionEnded: () => location.reload()
});

function currentView() { return view; }
function isHost() { return room.snapshot().role === "host"; }
function renderEntryMode() { setModeVisibility(mode, { ...E, hostButton: E.hostModeButton, guestButton: E.guestModeButton }); }
function enterRoom() { setHidden(E.setupPanel, true); setHidden(E.roomPanel, false); setHidden(E.hostTools, !isHost()); E.roomCodeDisplay.textContent = room.snapshot().roomCode; }

async function createGameRoom() {
  const name = cleanPlayerName(E.hostNameInput.value, "房主");
  E.createRoomButton.disabled = true;
  try {
    await room.createRoom({ name, capacity: Number(E.playerCountSelect.value) });
  } catch (error) { alert(`创建房间失败：${error.message}\n请确认已通过 node game10/signal-server.js 启动。`); }
  finally { E.createRoomButton.disabled = false; }
}
async function joinGameRoom() {
  E.joinRoomButton.disabled = true;
  try {
    const result = await room.joinRoom({ code: E.roomCodeInput.value, name: cleanPlayerName(E.guestNameInput.value, "玩家"), intent: spectatorUi.getJoinIntent() });
    E.connectionStatus.textContent = spectatorUi.handleJoinResult(result).statusText;
  }
  catch (error) { alert(`加入房间失败：${error.message}`); }
  finally { E.joinRoomButton.disabled = false; }
}
function kickPlayer(playerId) {
  const player = view?.players.find((item) => item.id === playerId);
  if (!player || !confirm(`确定将 ${player.name} 移出房间吗？`)) return;
  room.kick(playerId).catch((error) => alert(`移出失败：${error.message}`));
}
function changeCapacity() {
  if (!view?.permissions?.canManage || view.phase !== "lobby") return;
  const capacity = Number(E.roomPlayerCountSelect.value);
  if (capacity < view.players.length) { E.roomPlayerCountSelect.value = String(view.capacity); return alert("人数不能少于当前已加入的玩家数。"); }
  submit({ type: "setCapacity", capacity });
}
function startGame() { submit({ type: "start" }); }
function endGameEarly() {
  if (!view) return;
  if (view.phase === "ended") return submit({ type: "restart" });
  if (confirm("确定结束当前游戏并返回大厅吗？")) submit({ type: "end" });
}
function playAgain() { submit({ type: "restart" }); }
function submit(action) { return room.submitAction(action).catch((error) => alert(`操作失败：${error.message}`)); }

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
  const spectatorModel = spectatorUi.render(view); const memberRole = spectatorModel.memberRole;
  const current = view.players[view.currentIndex]; const myTurn = view.phase === "playing" && current?.id === view.selfId;
  E.roomCodeDisplay.textContent = room.snapshot().roomCode; E.roomPlayerCountSelect.value = String(view.capacity); E.roomPlayerCountSelect.disabled = !view.permissions?.canManage || view.phase !== "lobby";
  setHidden(E.hostTools, !view.permissions?.canManage);
  E.playerCountBadge.textContent = `${view.players.length} / ${view.capacity}`; E.startGameButton.disabled = !view.permissions?.canStart || view.players.length !== view.capacity || view.players.some((p) => !p.connected);
  setHidden(E.startGameButton, !view.permissions?.canStart); setHidden(E.endGameButton, !view.permissions?.canEnd && !view.permissions?.canRestart); E.endGameButton.textContent = view.phase === "ended" ? "返回大厅" : "结束本局";
  E.phaseBadge.textContent = { lobby: "准备阶段", playing: "攀登中", ended: "登顶完成" }[view.phase]; E.turnLabel.textContent = view.phase === "playing" ? `${current.name} 的回合` : view.phase === "ended" ? "游戏结束" : "等待开始";
  E.playerList.innerHTML = view.players.map((player, index) => `<article class="player-item ${player.id === view.selfId ? "player-self" : ""} ${index === view.currentIndex && view.phase === "playing" ? "player-current" : ""} ${!player.connected ? "player-offline" : ""}" style="--player:${player.color}"><div><i class="player-color"></i><b>${escapeHtml(player.name)}</b>${player.isHost ? "<em>房主</em>" : ""}</div><span>已占领 ${player.claimed.length} / 3</span><small>${player.claimed.length ? player.claimed.join("、") + " 号路线" : "尚未占领路线"}</small>${view.permissions?.canKick && !player.isHost ? `<button data-kick="${escapeHtml(player.id)}">移出</button>` : ""}</article>`).join("");
  E.playerList.querySelectorAll("[data-kick]").forEach((button) => { button.onclick = () => kickPlayer(button.dataset.kick); });
  if (view.phase === "lobby") E.notice.textContent = memberRole === "spectator" ? "你正在旁观准备阶段，可在有空位时进入玩家席。" : `等待 ${view.capacity} 位玩家到齐后，由房主开始游戏`;
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
  if (memberRole === "spectator" && view.phase === "playing") E.actionArea.innerHTML = '<p class="muted spectator-action-note">旁观模式可查看公开骰子、路线和攀登进度，但不能投骰或选择路线。</p>';
  E.actionArea.querySelectorAll("[data-action]").forEach((button) => { button.onclick = () => submit({ type: button.dataset.action }); }); E.actionArea.querySelectorAll("[data-choice]").forEach((button) => { button.onclick = () => submit({ type: "choose", key: button.dataset.choice }); });
  E.logList.innerHTML = view.logs.map((entry) => `<p>${escapeHtml(entry.text)}</p>`).join("") || '<p class="muted">暂无记录</p>';
  if (view.phase === "playing" && view.deadline) countdown.start(view.deadline, ACTION_SECONDS * 1000); else { countdown.stop(); E.timerText.textContent = "--"; E.timerBar.style.width = "0"; }
  setHidden(E.resultPanel, view.phase !== "ended"); setHidden(E.resultActions, !view.permissions?.canRestart); if (view.phase === "ended") { const winner = view.players.find((player) => player.id === view.winnerId); E.winnerText.textContent = `${winner?.name || "玩家"} 征服了山峰！`; E.resultList.innerHTML = view.players.map((player) => `<p><i style="background:${player.color}"></i><b>${escapeHtml(player.name)}</b><span>${player.claimed.length} 条路线</span></p>`).join(""); }
}

async function init() {
  bindRoomCodeInput(E.roomCodeInput); E.hostModeButton.onclick = () => { mode = "host"; renderEntryMode(); }; E.guestModeButton.onclick = () => { mode = "guest"; renderEntryMode(); };
  spectatorUi.bind();
  E.createRoomButton.onclick = createGameRoom; E.joinRoomButton.onclick = joinGameRoom; E.roomPlayerCountSelect.onchange = changeCapacity; E.startGameButton.onclick = startGame; E.endGameButton.onclick = endGameEarly; E.playAgainButton.onclick = playAgain;
  E.toggleLogButton.onclick = () => { E.logList.classList.toggle("collapsed"); E.toggleLogButton.textContent = E.logList.classList.contains("collapsed") ? "展开" : "收起"; };
  renderEntryMode();
  try { spectatorUi.applyConfig(await room.checkServer()); } catch { E.connectionStatus.title = "请运行 node game10/signal-server.js"; }
}
init();
