"use strict";

import {
  bindRoomCodeInput,
  cleanPlayerName,
  createAuthoritativeRoomClient,
  createSessionStore,
  escapeHtml,
  renderConnectionStatus,
  setHidden
} from "/shared/client/index.js";
import { CATEGORIES, categoryScore } from "./rules.mjs";

const PROTOCOL_VERSION = 3;
let mode = "host";
let view = null;
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

const sessions = createSessionStore({ gameId: "yahtzee" });
const room = createAuthoritativeRoomClient({
  protocolVersion: PROTOCOL_VERSION,
  sessionStore: sessions,
  onStatus(status) {
    renderConnectionStatus(elements.connectionStatus, status, room.snapshot().roomCode);
  },
  handlers: {
    onView(nextView) {
      view = nextView;
      selectedScorePlayerId ||= nextView.selfId;
      enterRoom();
      render();
    },
    onKicked() {
      alert("你已被房主移出房间。");
      location.reload();
    }
  }
});

const roomInfo = () => room.snapshot();
const isHost = () => roomInfo().role === "host";

function setMode(nextMode) {
  mode = nextMode;
  elements.hostModeButton.classList.toggle("active", mode === "host");
  elements.guestModeButton.classList.toggle("active", mode === "guest");
  elements.hostSetup.classList.toggle("hidden", mode !== "host");
  elements.guestSetup.classList.toggle("hidden", mode !== "guest");
}

function enterRoom() {
  setHidden(elements.setupPanel, true);
  setHidden(elements.roomPanel, false);
  setHidden(elements.hostTools, !isHost());
  elements.roomCodeDisplay.textContent = roomInfo().roomCode;
}

function submitAction(action) {
  return room.submitAction(action).catch((error) => alert(`操作失败：${error.message}`));
}

async function createRoom() {
  try {
    await room.createRoom({
      name: cleanPlayerName(elements.hostNameInput.value, "房主"),
      capacity: Number(elements.playerCountSelect.value)
    });
  } catch (error) {
    alert(`无法创建房间：${error.message}\n请先运行 node game3/signal-server.js。`);
  }
}

async function joinRoom() {
  try {
    await room.joinRoom({
      code: elements.roomCodeInput.value,
      name: cleanPlayerName(elements.guestNameInput.value, "玩家")
    });
  } catch (error) {
    alert(`无法加入房间：${error.message}`);
  }
}

function changePlayerCount() {
  if (!view) return;
  const capacity = Number(elements.roomPlayerCountSelect.value);
  if (capacity < view.players.length) {
    elements.roomPlayerCountSelect.value = String(view.playerCount);
    alert("新人数不能少于当前已加入人数。");
    return;
  }
  submitAction({ type: "setCapacity", capacity });
}

function startGame() {
  submitAction({ type: "start" });
}

function endGame() {
  if (!view) return;
  if (view.phase === "ended") {
    submitAction({ type: "restart" });
    return;
  }
  if (confirm("确定结束当前游戏并返回准备阶段吗？本局成绩将被清空。")) {
    submitAction({ type: "end" });
  }
}

function kickPlayer(playerId) {
  const player = view?.players.find((item) => item.id === playerId);
  if (!player || !confirm(`确定要移出 ${player.name} 吗？`)) return;
  room.kick(playerId).catch((error) => alert(`无法移出玩家：${error.message}`));
}

const PIP_POSITIONS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };

function dieHtml(value, held, canHold, index) {
  if (value == null) return `<button class="die" type="button" disabled><span class="die-placeholder">?</span></button>`;
  const pips = Array.from({ length: 9 }, (_, position) => (
    PIP_POSITIONS[value].includes(position + 1)
      ? `<i class="pip ${value === 1 ? "gold" : ""}"></i>`
      : "<i></i>"
  )).join("");
  return `<button class="die ${held ? "held" : ""}" data-die-index="${index}" type="button" ${canHold ? "" : "disabled"}><span class="die-face">${pips}</span></button>`;
}

function render() {
  if (!view) return;
  const me = view.players.find((player) => player.id === view.selfId);
  const active = view.players.find((player) => player.id === view.currentPlayerId);
  const myTurn = view.phase === "playing" && view.currentPlayerId === view.selfId;
  const canStart = view.permissions?.canStart
    && view.players.length === view.playerCount
    && view.players.every((player) => player.connected);

  elements.roomCodeDisplay.textContent = roomInfo().roomCode;
  elements.playerCountBadge.textContent = `${view.players.length} / ${view.playerCount}`;
  elements.playerList.innerHTML = view.players.map((player, index) => {
    const kick = view.permissions?.canKick && !player.isHost
      ? `<button class="kick-player-button" data-player-id="${escapeHtml(player.id)}" type="button">移出</button>`
      : "";
    return `<div class="player-item ${player.id === view.currentPlayerId && view.phase === "playing" ? "current" : ""}"><div><div class="player-name">${escapeHtml(player.name)}</div><div class="player-meta">${player.isHost ? "房主 · " : ""}${view.phase === "lobby" ? `玩家 ${index + 1}` : `${player.totals.total} 分`} · ${player.connected ? "在线" : "离线"}</div></div><div class="player-actions"><i class="online-dot ${player.connected ? "" : "offline"}"></i>${kick}</div></div>`;
  }).join("");
  elements.playerList.querySelectorAll(".kick-player-button").forEach((button) => {
    button.addEventListener("click", () => kickPlayer(button.dataset.playerId));
  });

  setHidden(elements.hostTools, !isHost());
  elements.roomPlayerCountSelect.value = String(view.playerCount);
  elements.roomPlayerCountSelect.disabled = view.phase !== "lobby";
  setHidden(elements.startGameButton, !view.permissions?.canStart);
  elements.startGameButton.disabled = !canStart;
  setHidden(elements.endGameButton, !view.permissions?.canEnd && !view.permissions?.canRestart);
  elements.endGameButton.textContent = view.phase === "ended" ? "返回大厅" : "结束当前游戏";
  elements.roundBadge.textContent = `第 ${Math.min(view.round, 13)} / 13 轮`;
  elements.rollBadge.textContent = `投掷 ${view.rolls} / 3`;

  if (view.phase === "lobby") {
    elements.gameNotice.textContent = view.players.length === view.playerCount
      ? "玩家已经到齐，房主可以开始比赛。"
      : `等待玩家加入，还差 ${view.playerCount - view.players.length} 人。`;
    elements.turnTitle.textContent = "等待比赛开始";
  } else if (view.phase === "ended") {
    const ranking = [...view.players].sort((a, b) => b.totals.total - a.totals.total);
    const best = ranking[0]?.totals.total;
    const winners = ranking.filter((player) => player.totals.total === best).map((player) => player.name).join("、");
    elements.gameNotice.textContent = `比赛结束！${winners} 以 ${best} 分获得最高分。`;
    elements.turnTitle.textContent = "最终排名";
  } else {
    elements.gameNotice.textContent = myTurn
      ? "轮到你了：投骰、保留需要的骰子，然后选择一个计分格。"
      : `正在等待 ${active?.name || "玩家"} 完成本回合。`;
    elements.turnTitle.textContent = `${active?.name || "玩家"} 的回合`;
  }

  const canHold = myTurn && view.rolls > 0 && view.rolls < 3;
  elements.diceTray.innerHTML = view.dice.map((value, index) => dieHtml(value, view.held[index], canHold, index)).join("");
  elements.diceTray.querySelectorAll("[data-die-index]").forEach((button) => {
    button.addEventListener("click", () => submitAction({ type: "hold", index: Number(button.dataset.dieIndex) }));
  });

  if (view.phase === "ended") {
    const ranking = [...view.players].sort((a, b) => b.totals.total - a.totals.total);
    elements.turnActions.innerHTML = `<div class="winner-list">${ranking.map((player, index) => `<div class="winner-row"><span>${index + 1}. ${escapeHtml(player.name)}</span><span>${player.totals.total} 分</span></div>`).join("")}</div>`;
  } else if (myTurn) {
    elements.turnActions.innerHTML = `<button class="primary" id="rollButton" type="button" ${view.rolls >= 3 ? "disabled" : ""}>${view.rolls === 0 ? "投掷骰子" : "重投未保留骰子"}</button>`;
    $("rollButton")?.addEventListener("click", () => submitAction({ type: "roll" }));
  } else {
    elements.turnActions.innerHTML = view.phase === "playing"
      ? "<span class=\"player-meta\">等待当前玩家操作…</span>"
      : "";
  }

  renderScoreSelector();
  const scorePlayer = view.players.find((player) => player.id === selectedScorePlayerId) || me || view.players[0];
  renderScorecard(scorePlayer, myTurn && scorePlayer?.id === view.selfId);
}

function renderScoreSelector() {
  if (!view.players.some((player) => player.id === selectedScorePlayerId)) selectedScorePlayerId = view.selfId;
  elements.scorePlayerSelect.innerHTML = view.players.map((player) => (
    `<option value="${escapeHtml(player.id)}" ${player.id === selectedScorePlayerId ? "selected" : ""}>${escapeHtml(player.name)}${player.id === view.selfId ? "（我）" : ""}</option>`
  )).join("");
}

function renderScorecard(player, canScore) {
  if (!player) return;
  const value = player.totals;
  elements.scoreSummary.innerHTML = `<div class="summary-item"><span>上半区</span><strong>${value.upper}</strong></div><div class="summary-item"><span>上半区奖励</span><strong>${value.upperBonus}</strong></div><div class="summary-item"><span>快艇奖励</span><strong>${value.yahtzeeBonus}</strong></div><div class="summary-item total"><span>总分</span><strong>${value.total}</strong></div>`;
  let previousSection = "";
  elements.scoreGrid.innerHTML = CATEGORIES.map((category) => {
    const score = player.scorecard[category.id];
    const available = canScore && view.rolls > 0 && score === null;
    const preview = available ? categoryScore(category.id, view.dice) : null;
    const divider = category.section !== previousSection
      ? `<div class="upper-divider">${category.section === "upper" ? "上半区" : "下半区"}</div>`
      : "";
    previousSection = category.section;
    return `${divider}<div class="score-row ${available ? "available" : ""}" ${available ? `data-category="${category.id}"` : ""}><div><div class="score-name">${category.name}</div><div class="score-help">${category.help}</div></div><div class="score-value ${available ? "preview" : ""}">${score === null ? (available ? `+${preview}` : "—") : score}</div></div>`;
  }).join("");
  elements.scoreGrid.querySelectorAll("[data-category]").forEach((row) => {
    row.addEventListener("click", () => {
      const category = CATEGORIES.find((item) => item.id === row.dataset.category);
      const points = categoryScore(row.dataset.category, view.dice);
      if (confirm(`确定将本次结果记入“${category.name}”（${points} 分）吗？`)) {
        submitAction({ type: "score", category: row.dataset.category });
      }
    });
  });
}

function init() {
  elements.hostModeButton.addEventListener("click", () => setMode("host"));
  elements.guestModeButton.addEventListener("click", () => setMode("guest"));
  elements.createRoomButton.addEventListener("click", createRoom);
  elements.joinRoomButton.addEventListener("click", joinRoom);
  bindRoomCodeInput(elements.roomCodeInput);
  elements.roomPlayerCountSelect.addEventListener("change", changePlayerCount);
  elements.startGameButton.addEventListener("click", startGame);
  elements.endGameButton.addEventListener("click", endGame);
  elements.scorePlayerSelect.addEventListener("change", () => {
    selectedScorePlayerId = elements.scorePlayerSelect.value;
    render();
  });
  setMode("host");
  room.checkServer().catch(() => {});
}

init();
