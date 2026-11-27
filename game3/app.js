"use strict";

import {
  bindRoomCodeInput,
  cleanPlayerName,
  createAuthoritativeRoomClient,
  createRoomEntryController,
  createSessionStore,
  createSpectatorUi,
  escapeHtml,
  renderConnectionStatus,
  setHidden
} from "/shared/client/index.js";
import { CATEGORIES, categoryScore, UPPER_BONUS_THRESHOLD } from "./rules.mjs";
import { createGame3PartitionRenderer, createGame3RenderModel } from "./render-partitions.mjs";

const PROTOCOL_VERSION = 3;
let mode = "host";
let view = null;
let partitionRenderer = null;

const $ = (id) => document.getElementById(id);
const elements = {
  siteHeader: $("siteHeader"), connectionStatus: $("connectionStatus"), roomHeaderTools: $("roomHeaderTools"), setupPanel: $("setupPanel"), roomPanel: $("roomPanel"),
  hostModeButton: $("hostModeButton"), guestModeButton: $("guestModeButton"), hostSetup: $("hostSetup"), guestSetup: $("guestSetup"),
  hostNameInput: $("hostNameInput"), guestNameInput: $("guestNameInput"), playerCountSelect: $("playerCountSelect"),
  createRoomButton: $("createRoomButton"), joinRoomButton: $("joinRoomButton"), roomCodeInput: $("roomCodeInput"), joinIntentField: $("joinIntentField"),
  roomCodeDisplay: $("roomCodeDisplay"), hostTools: $("hostTools"), roomPlayerCountSelect: $("roomPlayerCountSelect"),
  spectatorSettingButton: $("spectatorSettingButton"), seatActionButton: $("seatActionButton"), spectatorPanel: $("spectatorPanel"),
  spectatorCountBadge: $("spectatorCountBadge"), spectatorList: $("spectatorList"),
  startGameButton: $("startGameButton"), endGameButton: $("endGameButton"), playerList: $("playerList"), playerCountBadge: $("playerCountBadge"),
  gameNotice: $("gameNotice"), turnTitle: $("turnTitle"), roundBadge: $("roundBadge"), rollBadge: $("rollBadge"),
  diceTray: $("diceTray"), turnActions: $("turnActions"), scoreGrid: $("scoreGrid")
};

let spectatorUi = null;

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
      enterRoom();
      render();
    },
    onKicked() { spectatorUi?.handleSessionEnded("kicked"); },
    onRoomExpired() { spectatorUi?.handleSessionEnded("room_expired"); }
  }
});

spectatorUi = createSpectatorUi({
  room,
  getView: () => view,
  elements: {
    joinIntentField: elements.joinIntentField,
    seatActionButton: elements.seatActionButton,
    spectatorSettingButton: elements.spectatorSettingButton,
    spectatorPanel: elements.spectatorPanel,
    spectatorCountBadge: elements.spectatorCountBadge,
    spectatorList: elements.spectatorList
  },
  notify: (message) => alert(message),
  confirmAction: (message) => confirm(message),
  onSessionEnded: () => location.reload()
});
const roomEntry=createRoomEntryController({room,spectatorUi,elements:{root:elements.setupPanel,hostModeButton:elements.hostModeButton,guestModeButton:elements.guestModeButton,hostSetup:elements.hostSetup,guestSetup:elements.guestSetup,hostTools:elements.hostTools,hostNameInput:elements.hostNameInput,guestNameInput:elements.guestNameInput,roomCodeInput:elements.roomCodeInput,createRoomButton:elements.createRoomButton,joinRoomButton:elements.joinRoomButton,connectionStatus:elements.connectionStatus},buildCreatePayload:()=>({capacity:Number(elements.playerCountSelect.value)}),formatError:(kind,error)=>kind==="create"?`无法创建房间：${error.message}\n请先运行 node game3/signal-server.js。`:`无法加入房间：${error.message}`});

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
  setHidden(elements.roomHeaderTools, false);
  elements.siteHeader.classList.add("in-room");
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
    const result = await room.joinRoom({
      code: elements.roomCodeInput.value,
      name: cleanPlayerName(elements.guestNameInput.value, "玩家"),
      intent: spectatorUi.getJoinIntent()
    });
    elements.connectionStatus.textContent = spectatorUi.handleJoinResult(result).statusText;
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

function renderRoomPartition(model) {
  const current = model.view;
  const canStart = current.permissions?.canStart
    && current.players.length === current.playerCount
    && current.players.every((player) => player.connected);
  elements.roomCodeDisplay.textContent = model.roomCode;
  elements.playerCountBadge.textContent = `${current.players.length} / ${current.playerCount}`;
  setHidden(elements.hostTools, !current.permissions?.canManage);
  elements.roomPlayerCountSelect.value = String(current.playerCount);
  elements.roomPlayerCountSelect.disabled = !current.permissions?.canSetCapacity;
  setHidden(elements.startGameButton, !current.permissions?.canStart);
  elements.startGameButton.disabled = !canStart;
  setHidden(elements.endGameButton, !current.permissions?.canEnd && !current.permissions?.canRestart);
  elements.endGameButton.textContent = current.phase === "ended" ? "返回大厅" : "结束当前游戏";
}

function renderPlayersPartition(model) {
  const current = model.view;
  const existing = new Map(
    [...elements.playerList.querySelectorAll("[data-player-id]")]
      .map((node) => [node.dataset.playerId, node])
  );
  const retained = new Set();
  current.players.forEach((player, index) => {
    const id = String(player.id);
    let node = existing.get(id);
    if (!node) {
      node = document.createElement("div");
      node.dataset.playerId = id;
      node.innerHTML = `<div><div class="player-name" data-player-name></div><div class="player-meta" data-player-meta></div></div><div class="player-actions"><i class="online-dot" data-online-dot></i><button class="kick-player-button" data-kick-player type="button">移出</button></div>`;
    }
    retained.add(id);
    node.className = `player-item ${player.id === current.currentPlayerId && current.phase === "playing" ? "current" : ""}`;
    node.querySelector("[data-player-name]").textContent = player.name;
    node.querySelector("[data-player-meta]").textContent = `${player.isHost ? "房主 · " : ""}${current.phase === "lobby" ? `玩家 ${index + 1}` : `${player.totals.total} 分`} · ${player.connected ? "在线" : "离线"}`;
    node.querySelector("[data-online-dot]").className = `online-dot ${player.connected ? "" : "offline"}`;
    const kickButton = node.querySelector("[data-kick-player]");
    kickButton.dataset.kickPlayer = id;
    setHidden(kickButton, !current.permissions?.canKick || player.isHost);
    const currentAtIndex = elements.playerList.children[index];
    if (currentAtIndex !== node) elements.playerList.insertBefore(node, currentAtIndex || null);
  });
  [...elements.playerList.querySelectorAll("[data-player-id]")].forEach((node) => {
    if (!retained.has(node.dataset.playerId)) node.remove();
  });
}

function renderStatusPartition(model) {
  const current = model.view;
  elements.roundBadge.textContent = `第 ${Math.min(current.round, 13)} / 13 轮`;
  elements.rollBadge.textContent = `投掷 ${current.rolls} / 3`;
  if (current.phase === "lobby") {
    elements.gameNotice.textContent = model.memberRole === "spectator"
      ? "你正在旁观准备阶段，可在有空位时主动进入玩家席。"
      : current.players.length === current.playerCount
        ? "玩家已经到齐，房主可以开始比赛。"
        : `等待玩家加入，还差 ${current.playerCount - current.players.length} 人。`;
    elements.turnTitle.textContent = "等待比赛开始";
  } else if (current.phase === "ended") {
    const ranking = [...current.players].sort((a, b) => b.totals.total - a.totals.total);
    const best = ranking[0]?.totals.total;
    const winners = ranking.filter((player) => player.totals.total === best).map((player) => player.name).join("、");
    elements.gameNotice.textContent = `比赛结束！${winners} 以 ${best} 分获得最高分。`;
    elements.turnTitle.textContent = "最终排名";
  } else {
    elements.gameNotice.textContent = model.memberRole === "spectator"
      ? `旁观中：${model.active?.name || "玩家"} 正在投掷和选择计分。`
      : model.myTurn
        ? "轮到你了：投骰、保留需要的骰子，然后选择一个计分格。"
        : `正在等待 ${model.active?.name || "玩家"} 完成本回合。`;
    elements.turnTitle.textContent = `${model.active?.name || "玩家"} 的回合`;
  }
}

function renderDicePartition(model) {
  const current = model.view;
  const canHold = model.myTurn && current.rolls > 0 && current.rolls < 3;
  elements.diceTray.innerHTML = current.dice
    .map((value, index) => dieHtml(value, current.held[index], canHold, index))
    .join("");
}

function renderTurnActionPartition(model) {
  if (model.view.phase === "ended") {
    elements.turnActions.innerHTML = '<div class="winner-list" data-winner-list></div>';
  } else if (model.myTurn) {
    elements.turnActions.innerHTML = '<button class="primary" data-action="roll" type="button"></button>';
  } else if (model.memberRole === "spectator" && model.view.phase === "playing") {
    elements.turnActions.innerHTML = '<span class="player-meta spectator-action-note">旁观模式不提供投骰、保留骰子或计分操作。</span>';
  } else if (model.view.phase === "playing") {
    elements.turnActions.innerHTML = '<span class="player-meta">等待当前玩家操作…</span>';
  } else {
    elements.turnActions.innerHTML = "";
  }
}

function renderTurnActionFactsPartition(model) {
  const current = model.view;
  const rollButton = elements.turnActions.querySelector('[data-action="roll"]');
  if (rollButton) {
    rollButton.disabled = current.rolls >= 3;
    rollButton.textContent = current.rolls === 0 ? "投掷骰子" : "重投未保留骰子";
  }
  const winnerList = elements.turnActions.querySelector("[data-winner-list]");
  if (winnerList) {
    const ranking = [...current.players].sort((a, b) => b.totals.total - a.totals.total);
    winnerList.innerHTML = ranking.map((player, index) => `<div class="winner-row"><span>${index + 1}. ${escapeHtml(player.name)}</span><span>${player.totals.total} 分</span></div>`).join("");
  }
}

function renderScorecardPartition({ view, me, canScore }) {
  const players = me ? [me, ...view.players.filter(player => player.id !== me.id)] : view.players;
  const headers = players.map(player => {
    const active = player.id === view.currentPlayerId;
    const own = player.id === view.selfId;
    return `<th scope="col" class="player-heading${active ? " acting" : ""}">
      <span class="sheet-player">${escapeHtml(player.name)}${own ? "（我）" : ""}</span>
      <small>${active ? "行动中 · " : ""}总分 ${player.totals.total}</small>
    </th>`;
  }).join("");

  function scoreRow(category) {
    const cells = players.map(player => {
      const score = player.scorecard[category.id];
      if (score != null) return `<td class="registered">${score}</td>`;
      if (!canScore || player.id !== view.selfId) return '<td class="unfilled" aria-label="未登记">—</td>';
      const preview = categoryScore(category.id, view.dice);
      if (category.section === "upper" && player.totals.upper < UPPER_BONUS_THRESHOLD && preview > 0) {
        const projected = player.totals.upper + preview;
        const remaining = UPPER_BONUS_THRESHOLD - projected;
        const result = remaining > 0 ? `差 ${remaining} 分` : "达标";
        return `<td><button type="button" data-category="${category.id}" aria-label="${category.name}，可登记 ${preview} 分，填后上半区 ${projected} 分，${result}">+${preview}<span class="upper-projection"><span>填后 ${projected}</span> · <b>${result}</b></span></button></td>`;
      }
      return `<td><button type="button" data-category="${category.id}" aria-label="${category.name}，可登记 ${preview} 分">+${preview}</button></td>`;
    }).join("");
    return `<tr data-score-row="${category.id}"><th scope="row">${category.name}<small>${category.help}</small></th>${cells}</tr>`;
  }

  const upperCategories = CATEGORIES.filter(category => category.section === "upper");
  function subtotal(player) {
    const current = player.totals.upper;
    const progress = points => Math.min(100, points * 100 / UPPER_BONUS_THRESHOLD);
    let projected = current;
    let note = "";
    if (canScore && player.id === view.selfId && !player.totals.upperBonus) {
      const available = upperCategories.filter(category => player.scorecard[category.id] == null);
      // A single open upper box has one unambiguous projection for the subtotal.
      if (available.length === 1) {
        projected += categoryScore(available[0].id, view.dice);
        if (projected > current) note = `<span class="subtotal-pencil">填${available[0].name} → ${projected}</span>`;
      }
    }
    return `<b>${current}</b> / ${UPPER_BONUS_THRESHOLD}<span aria-hidden="true" class="subtotal-track" style="--ink:${progress(current)}%;--pencil:${progress(projected)}%"></span>${note}`;
  }
  function summaryRow(label, field) {
    const cells = players.map(player => {
      if (field === "upper") return `<td>${subtotal(player)}</td>`;
      const value = player.totals[field];
      if (field === "upperBonus" && value) return `<td><span class="bonus-stamp">+${value}</span></td>`;
      return `<td>${value}</td>`;
    }).join("");
    return `<tr class="sheet-summary" data-summary="${field}"><th scope="row">${label}</th>${cells}</tr>`;
  }

  elements.scoreGrid.style.setProperty("--player-count", players.length);
  elements.scoreGrid.innerHTML = `<thead><tr><th scope="col">全桌计分表</th>${headers}</tr></thead>
    <tbody>${upperCategories.map(scoreRow).join("")}
      ${summaryRow("上半区小计", "upper")}${summaryRow("上半区奖励", "upperBonus")}
    </tbody>
    <tbody>${CATEGORIES.filter(c => c.section === "lower").map(scoreRow).join("")}
      ${summaryRow("快艇奖励", "yahtzeeBonus")}
    </tbody>`;
}

function render() {
  if (!view) return;
  const spectatorModel = spectatorUi.render(view);
  const model = createGame3RenderModel(view, {
    memberRole: spectatorModel.memberRole,
    roomCode: room.snapshot().roomCode
  });
  partitionRenderer ??= createGame3PartitionRenderer({
    room: renderRoomPartition,
    players: renderPlayersPartition,
    status: renderStatusPartition,
    dice: renderDicePartition,
    turnAction: renderTurnActionPartition,
    turnActionFacts: renderTurnActionFactsPartition,
    scorecard: renderScorecardPartition
  });
  partitionRenderer.render(model);
}

async function init() {
  roomEntry.bind();
  spectatorUi.bind();
  elements.roomPlayerCountSelect.addEventListener("change", changePlayerCount);
  elements.startGameButton.addEventListener("click", startGame);
  elements.endGameButton.addEventListener("click", endGame);
  elements.playerList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-kick-player]");
    if (button) kickPlayer(button.dataset.kickPlayer);
  });
  elements.diceTray.addEventListener("click", (event) => {
    const button = event.target.closest("[data-die-index]");
    if (button && !button.disabled) submitAction({ type: "hold", index: Number(button.dataset.dieIndex) });
  });
  elements.turnActions.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="roll"]');
    if (button && !button.disabled) submitAction({ type: "roll" });
  });
  elements.scoreGrid.addEventListener("click", (event) => {
    const row = event.target.closest("[data-category]");
    if (!row) return;
    const category = CATEGORIES.find((item) => item.id === row.dataset.category);
    const points = categoryScore(row.dataset.category, view.dice);
    if (confirm(`确定将本次结果记入“${category.name}”（${points} 分）吗？`)) {
      submitAction({ type: "score", category: row.dataset.category });
    }
  });
  setMode("host");
  try { spectatorUi.applyConfig(await room.checkServer()); } catch { /* join/create shows details */ }
}

init();
