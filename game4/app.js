"use strict";

import {
  createAuthoritativeRoomClient,
  createCountdown,
  createRoomEntryController,
  createSessionStore,
  createSpectatorUi,
  escapeHtml,
  renderConnectionStatus,
  renderCountdown,
  setHidden
} from "/shared/client/index.js";
import { edgeSeatSlots } from "./seat-layout.mjs";

const PROTOCOL_VERSION = 3;
const ACTION_SECONDS = 60;
const $ = (id) => document.getElementById(id);
const E = Object.fromEntries([
  "connectionStatus", "setupPanel", "roomPanel", "hostModeButton", "guestModeButton", "hostSetup", "guestSetup",
  "hostNameInput", "guestNameInput", "playerCountSelect", "createRoomButton", "joinRoomButton", "roomCodeInput",
  "joinIntentField", "roomCodeDisplay", "hostTools", "roomPlayerCountSelect", "spectatorSettingButton", "seatActionButton",
  "startGameButton", "endGameButton", "blindBadge", "handNumber", "blindLevel", "aliveCount", "notice", "streetName",
  "potValue", "potList", "board", "seats", "actionTitle", "timerText", "timerBar", "actionArea", "logList",
  "toggleLogButton", "spectatorPanel", "spectatorCountBadge", "spectatorList", "seatBoundary",
  "showdownOverlay", "showdownKicker", "showdownTitle", "showdownResults",
  "seatTopRail", "seatLeftRail", "seatRightRail", "seatBottomRail"
].map((id) => [id, $(id)]));

let view = null;
let spectatorUi = null;
let actionPending = false;
let decisionKey = "";
let raiseDraft = null;

const sessions = createSessionStore({ gameId: "texas-holdem" });
const countdown = createCountdown({
  onTick(value) { renderCountdown({ textElement: E.timerText, barElement: E.timerBar }, value); }
});

const room = createAuthoritativeRoomClient({
  protocolVersion: PROTOCOL_VERSION,
  sessionStore: sessions,
  onStatus(status) { renderConnectionStatus(E.connectionStatus, status, room.snapshot().roomCode); },
  handlers: {
    onView(nextView) {
      actionPending = false;
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
    joinIntentField: E.joinIntentField,
    seatActionButton: E.seatActionButton,
    spectatorSettingButton: E.spectatorSettingButton,
    spectatorPanel: E.spectatorPanel,
    spectatorCountBadge: E.spectatorCountBadge,
    spectatorList: E.spectatorList
  },
  notify: (message) => alert(message),
  confirmAction: (message) => confirm(message),
  onSessionEnded: () => location.reload()
});

const roomEntry = createRoomEntryController({
  room,
  spectatorUi,
  elements: {
    root: E.setupPanel, hostModeButton: E.hostModeButton, guestModeButton: E.guestModeButton,
    hostSetup: E.hostSetup, guestSetup: E.guestSetup, hostTools: E.hostTools,
    hostNameInput: E.hostNameInput, guestNameInput: E.guestNameInput, roomCodeInput: E.roomCodeInput,
    createRoomButton: E.createRoomButton, joinRoomButton: E.joinRoomButton, connectionStatus: E.connectionStatus
  },
  buildCreatePayload: () => ({ capacity: Number(E.playerCountSelect.value) }),
  formatError: (kind, error) => kind === "create"
    ? `创建失败：${error.message}\n请确认已启动 game4 权威服务。`
    : `加入失败：${error.message}`
});

function enterRoom() {
  setHidden(E.setupPanel, true);
  setHidden(E.roomPanel, false);
  E.roomCodeDisplay.textContent = room.snapshot().roomCode;
}

function submit(action) {
  if (actionPending) return;
  actionPending = true;
  E.actionArea.querySelectorAll("button,input").forEach((control) => { control.disabled = true; });
  Promise.resolve(room.submitAction(action)).catch((error) => {
    actionPending = false;
    E.connectionStatus.textContent = `操作失败：${error.message}`;
    decisionKey = "";
    renderActions();
    alert(error.message);
  });
}

function cardHtml(card) {
  if (card === null) return '<div class="card back" aria-label="隐藏底牌"></div>';
  if (!card) return '<div class="card empty" aria-hidden="true"></div>';
  const red = card.s === "♥" || card.s === "♦";
  const rank = ({ 11: "J", 12: "Q", 13: "K", 14: "A" })[card.r] || card.r;
  return `<div class="card ${red ? "red" : ""}" aria-label="${rank}${card.s}"><span class="rank">${rank}</span><span class="suit">${card.s}</span></div>`;
}

function currentPot() {
  return view?.players.reduce((sum, player) => sum + player.totalBet, 0) || 0;
}

function renderRoomShell() {
  const permissions = view.permissions || {};
  E.roomCodeDisplay.textContent = room.snapshot().roomCode;
  setHidden(E.hostTools, !permissions.canManage);
  E.roomPlayerCountSelect.value = String(view.capacity);
  E.roomPlayerCountSelect.disabled = view.phase !== "lobby" || !permissions.canManage;
  E.startGameButton.disabled = view.phase !== "lobby"
    || view.players.length !== view.capacity
    || view.players.some((player) => !player.connected);
  setHidden(E.startGameButton, !permissions.canStart);
  setHidden(E.endGameButton, !permissions.canEnd);
}

function renderTable() {
  const activeCount = view.players.filter((player) => player.status === "active").length;
  const streetLabels = { waiting: "等待开局", preflop: "翻牌前", flop: "翻牌", turn: "转牌", river: "河牌" };
  E.blindBadge.textContent = `${view.blind.sb} / ${view.blind.bb}`;
  E.handNumber.textContent = String(view.handNumber);
  E.blindLevel.textContent = String(view.blind.level);
  E.aliveCount.textContent = String(activeCount);
  E.potValue.textContent = String(currentPot());
  E.streetName.textContent = streetLabels[view.street] || "摊牌";
  E.board.innerHTML = Array.from({ length: 5 }, (_, index) => cardHtml(view.board[index])).join("");
  E.potList.textContent = view.pots.length > 1
    ? view.pots.map((pot, index) => `${index ? `边池 ${index}` : "主池"}：${pot.amount}`).join(" · ")
    : "";
}

function playersFromViewerSeat() {
  const players = [...view.players];
  if (!view.selfId) return players;
  const anchorId = view.selfId;
  const anchorIndex = players.findIndex((player) => player.id === anchorId);
  if (anchorIndex <= 0) return players;
  return players.slice(anchorIndex).concat(players.slice(0, anchorIndex));
}

function playerNameLabel(value, limit = 5) {
  const characters = [...String(value || "玩家")];
  return characters.length > limit ? `${characters.slice(0, limit).join("")}…` : characters.join("");
}

function renderSeats() {
  const existing = new Map([...E.seats.querySelectorAll("[data-player-id]")].map((element) => [element.dataset.playerId, element]));
  const retained = new Set();
  const results = new Map((view.showdownResults || []).map((result) => [String(result.playerId), result]));
  const winningIds = new Set((view.handWinners || []).flatMap((result) => result.ids).map(String));
  const showdownActive = view.phase === "handResult" && view.showdown;
  const orderedPlayers = playersFromViewerSeat();
  const slots = edgeSeatSlots(orderedPlayers.length, Boolean(view.selfId));
  const rails = { top: E.seatTopRail, left: E.seatLeftRail, right: E.seatRightRail, bottom: E.seatBottomRail };
  const railIndexes = { top: 0, left: 0, right: 0, bottom: 0 };
  orderedPlayers.forEach((player, orderIndex) => {
    const id = String(player.id);
    const index = view.players.findIndex((item) => item.id === player.id);
    const result = results.get(id);
    let seat = existing.get(id);
    if (!seat) {
      seat = document.createElement("article");
      seat.dataset.playerId = id;
      seat.innerHTML = `
        <div class="seat-top"><span class="seat-name" data-seat-name></span><span class="chips" data-seat-chips></span></div>
        <div class="seat-meta" data-seat-meta></div><div class="hole" data-seat-hole></div>
        <span class="seat-bet" data-seat-bet></span><span class="showdown-rank" data-showdown-rank></span>
        <span class="seat-admin-proxy" data-kick-player aria-hidden="true"></span>`;
    }
    retained.add(id);
    const slot = slots[orderIndex] || { edge: "top" };
    seat.dataset.seatEdge = slot.edge;
    seat.classList.add("seat");
    seat.classList.toggle("turn", index === view.currentIndex);
    seat.classList.toggle("folded", Boolean(player.folded));
    seat.classList.toggle("out", player.status !== "active");
    seat.classList.toggle("offline", !player.connected);
    seat.classList.toggle("showdown-contender", Boolean(showdownActive && result));
    seat.classList.toggle("showdown-winner", Boolean(showdownActive && result && winningIds.has(id)));
    seat.classList.toggle("showdown-loser", Boolean(showdownActive && result && !winningIds.has(id)));
    seat.dataset.seatOrder = String(orderIndex);
    const name = seat.querySelector("[data-seat-name]");
    name.textContent = playerNameLabel(player.name);
    name.title = player.name;
    seat.querySelector("[data-seat-chips]").textContent = `筹码 ${player.chips}`;
    const badges = [
      player.id === view.selfId ? '<i class="blind-tag">你</i>' : "",
      index === view.dealerIndex ? '<i class="dealer">D</i>' : "",
      index === view.smallBlindIndex ? '<i class="blind-tag">SB</i>' : "",
      index === view.bigBlindIndex ? '<i class="blind-tag">BB</i>' : "",
      player.allIn ? '<i class="allin">ALL IN</i>' : ""
    ].join("");
    const status = player.status === "eliminated" ? "已淘汰" : player.folded ? "已弃牌" : player.allIn ? "全押" : "";
    seat.querySelector("[data-seat-meta]").innerHTML = `${badges}${status}`;
    const bet = seat.querySelector("[data-seat-bet]");
    bet.textContent = player.streetBet ? `下注 ${player.streetBet}` : "";
    setHidden(bet, !player.streetBet);
    seat.querySelector("[data-showdown-rank]").textContent = result?.rankName || "";
    const hole = seat.querySelector("[data-seat-hole]");
    const holeKey = JSON.stringify(player.hole);
    if (hole.dataset.key !== holeKey) { hole.innerHTML = player.hole.map(cardHtml).join(""); hole.dataset.key = holeKey; }
    const adminProxy = seat.querySelector("[data-kick-player]");
    const manageable = Boolean(view.permissions?.canKick && !player.isHost);
    adminProxy.dataset.kickPlayer = id;
    adminProxy.setAttribute("aria-hidden", String(!manageable));
    seat.tabIndex = manageable ? 0 : -1;
    seat.setAttribute("aria-haspopup", manageable ? "menu" : "false");
    seat.title = manageable ? `管理 ${player.name}` : player.name;
    seat.onkeydown = manageable ? (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); seat.click(); }
    } : null;
    const rail = rails[slot.edge];
    const railIndex = railIndexes[slot.edge]++;
    const currentAtIndex = rail.children[railIndex];
    if (currentAtIndex !== seat) rail.insertBefore(seat, currentAtIndex || null);
  });
  [...E.seats.querySelectorAll("[data-player-id]")].forEach((seat) => {
    if (!retained.has(seat.dataset.playerId)) seat.remove();
  });
}

function resultCardsHtml(cards) {
  return `<div class="best-five">${(cards || []).map(cardHtml).join("")}</div>`;
}

function renderShowdown() {
  const showdown = view.phase === "handResult" && view.showdown;
  const uncontested = view.phase === "handResult" && !view.showdown;
  const champion = view.phase === "ended";
  setHidden(E.showdownOverlay, !showdown && !uncontested && !champion);
  document.querySelectorAll(".hand-rank-guide li").forEach((item) => item.classList.remove("active"));
  if (!showdown && !uncontested && !champion) return;
  if (champion) {
    const names = view.winnerIds.map((id) => view.players.find((player) => player.id === id)?.name).filter(Boolean);
    E.showdownKicker.textContent = "TOURNAMENT CHAMPION";
    E.showdownTitle.textContent = `${names.join("、") || "玩家"} 赢得锦标赛`;
    E.showdownResults.innerHTML = '<div class="showdown-pot"><b>♛ 最后的筹码持有者</b></div>';
    return;
  }
  E.showdownKicker.textContent = showdown ? "SHOWDOWN" : "POT AWARDED";
  E.showdownTitle.textContent = showdown ? "最佳五张牌揭晓" : "其他玩家均已弃牌";
  if (showdown) {
    const rankNames = new Set((view.showdownResults || []).map((result) => result.rankName));
    for (const item of document.querySelectorAll(".hand-rank-guide li[data-rank-name]")) {
      if (rankNames.has(item.dataset.rankName)) item.classList.add("active");
    }
  }
  E.showdownResults.innerHTML = (view.handWinners || []).map((pot) => {
    const winnerNames = pot.ids.map((id) => view.players.find((player) => player.id === id)?.name).filter(Boolean).join("、");
    const firstResult = (view.showdownResults || []).find((result) => pot.ids.includes(result.playerId));
    const payoutText = (pot.payouts || []).map((payout) => {
      const name = view.players.find((player) => player.id === payout.playerId)?.name || "玩家";
      return `${name} +${payout.amount}`;
    }).join(" · ");
    return `<div class="showdown-pot"><span>${escapeHtml(pot.potLabel)} ${pot.amount}</span><b>${escapeHtml(winnerNames)} · ${escapeHtml(pot.rankName)}</b>${firstResult ? resultCardsHtml(firstResult.bestFive) : ""}<span>${escapeHtml(payoutText)}</span></div>`;
  }).join("");
}

function actionContextKey() {
  const me = view.players.find((player) => player.id === view.selfId);
  const current = view.players[view.currentIndex];
  return JSON.stringify({
    role: view.roomRole, phase: view.phase, selfId: view.selfId, currentId: current?.id || null,
    street: view.street, currentBet: view.currentBet, lastFullRaise: view.lastFullRaise,
    chips: me?.chips ?? null, streetBet: me?.streetBet ?? null, acted: me?.acted ?? null,
    folded: me?.folded ?? null, allIn: me?.allIn ?? null
  });
}

function renderActions() {
  const nextKey = actionContextKey();
  if (nextKey === decisionKey) {
    E.actionArea.querySelectorAll("button,input").forEach((control) => { control.disabled = actionPending; });
    return;
  }
  decisionKey = nextKey;
  const me = view.players.find((player) => player.id === view.selfId);
  const current = view.players[view.currentIndex];
  if (view.phase !== "playing" || view.currentIndex == null) {
    E.actionTitle.textContent = view.phase === "ended" ? "锦标赛结束" : view.phase === "handResult" ? "本手结算" : "等待开始";
    E.actionArea.innerHTML = "";
    return;
  }
  E.actionTitle.textContent = `轮到 ${current.name}`;
  if (view.roomRole === "spectator") {
    E.actionArea.innerHTML = '<span class="player-meta">旁观模式不提供下注操作</span>';
    return;
  }
  if (!me || current.id !== view.selfId) {
    E.actionArea.innerHTML = '<span class="player-meta">等待当前玩家操作…</span>';
    return;
  }
  const owed = Math.max(0, view.currentBet - me.streetBet);
  const maximum = me.streetBet + me.chips;
  const minimum = view.currentBet === 0 ? view.blind.bb : view.currentBet + view.lastFullRaise;
  const actualMinimum = Math.min(minimum, maximum);
  const canRaise = !me.acted && maximum > view.currentBet;
  const defaultTarget = Math.min(Math.max(minimum, view.blind.bb), maximum);
  const draftValue = raiseDraft?.key === nextKey ? raiseDraft.value : defaultTarget;
  raiseDraft = canRaise ? { key: nextKey, value: draftValue } : null;
  E.actionArea.innerHTML = `
    <button id="foldButton" class="danger" type="button">弃牌</button>
    ${owed === 0 ? '<button id="checkButton" class="primary" type="button">过牌</button>' : `<button id="callButton" class="primary" type="button">跟注 ${Math.min(owed, me.chips)}${me.chips <= owed ? "（全押）" : ""}</button>`}
    ${canRaise ? `<label>${view.currentBet === 0 ? "下注到" : "加注到"}<input id="raiseInput" type="number" min="${actualMinimum}" max="${maximum}" value="${draftValue}"><span class="bet-range">${maximum < minimum ? `仅可全押至 ${maximum}` : `可用范围：${actualMinimum} – ${maximum}`}</span></label><div class="quick-bets"><button data-quick="half" type="button">1/2池</button><button data-quick="pot" type="button">1倍池</button><button data-quick="all" type="button">全押</button></div><button id="raiseButton" type="button">${maximum < minimum ? "全押" : "确认"}</button>` : ""}`;
  $("foldButton").onclick = () => submit({ type: "fold" });
  if ($("checkButton")) $("checkButton").onclick = () => submit({ type: "check" });
  if ($("callButton")) $("callButton").onclick = () => submit({ type: "call" });
  if ($("raiseInput")) $("raiseInput").oninput = () => { raiseDraft = { key: nextKey, value: Number($("raiseInput").value) }; };
  if ($("raiseButton")) $("raiseButton").onclick = () => submit({ type: "raise", target: Number($("raiseInput").value) });
  E.actionArea.querySelectorAll("[data-quick]").forEach((button) => {
    button.onclick = () => {
      const potAfterCall = currentPot() + Math.min(owed, me.chips);
      const base = button.dataset.quick === "all" ? maximum
        : me.streetBet + owed + (button.dataset.quick === "pot" ? potAfterCall : Math.floor(potAfterCall / 2));
      const value = Math.min(maximum, Math.max(minimum, base));
      $("raiseInput").value = String(value);
      raiseDraft = { key: nextKey, value };
    };
  });
}

function renderNotice() {
  if (view.phase === "lobby") {
    E.notice.textContent = view.roomRole === "spectator"
      ? "你正在旁观准备阶段；有空位时可以主动进入玩家席。"
      : view.players.length === view.capacity ? "玩家到齐，全部准备后房主可以开始锦标赛。" : `等待玩家加入：${view.players.length}/${view.capacity}`;
  } else if (view.phase === "ended") {
    const winners = view.winnerIds.map((id) => view.players.find((player) => player.id === id)?.name).filter(Boolean);
    E.notice.textContent = `锦标赛结束，${winners.join("、") || "玩家"} 获得冠军！`;
  } else if (view.phase === "handResult") {
    E.notice.textContent = `${view.showdown ? "摊牌" : "本手"}结算完成，服务器即将推进。`;
  } else E.notice.textContent = `第 ${view.handNumber} 手 · 盲注 ${view.blind.sb}/${view.blind.bb}`;
}

function renderLog() {
  E.logList.innerHTML = view.logs.map((entry) => `<div class="log-item">${escapeHtml(entry.text)}</div>`).join("") || '<div class="log-item">暂无记录</div>';
}

function renderTimer() {
  if (view.deadline && ["playing", "handResult"].includes(view.phase)) {
    const resultDuration = view.showdown ? 9000 : 4500;
    countdown.start(view.deadline, view.phase === "playing" ? view.actionDurationMs : resultDuration);
  } else {
    countdown.stop(); E.timerText.textContent = "--"; E.timerBar.style.width = "0";
  }
}

function render() {
  if (!view) return;
  spectatorUi.render(view);
  renderRoomShell();
  renderTable();
  renderSeats();
  renderShowdown();
  renderNotice();
  renderActions();
  renderLog();
  renderTimer();
}

E.roomPlayerCountSelect.onchange = () => submit({ type: "setCapacity", capacity: Number(E.roomPlayerCountSelect.value) });
E.startGameButton.onclick = () => submit({ type: "start" });
E.endGameButton.onclick = () => {
  if (confirm("确定结束当前锦标赛并返回准备阶段吗？本局筹码和成绩将被清空。")) submit({ type: "end" });
};
E.toggleLogButton.onclick = () => {
  const collapsed = E.logList.classList.toggle("collapsed");
  E.toggleLogButton.textContent = collapsed ? "展开" : "收起";
};

async function init() {
  roomEntry.bind();
  spectatorUi.bind();
  try {
    spectatorUi.applyConfig(await room.checkServer());
  } catch {
    E.connectionStatus.textContent = "请启动 game4 权威服务";
  }
}

init();
