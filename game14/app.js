"use strict";

import {
  bindRoomCodeInput,
  cleanPlayerName,
  createAuthoritativeRoomClient,
  createCountdown,
  createSessionStore,
  createSpectatorUi,
  escapeHtml,
  renderConnectionStatus,
  renderCountdown,
  setHidden,
  setModeVisibility
} from "/shared/client/index.js";

const PROTOCOL_VERSION = 3;
const ACTION_SECONDS = 30;
const $ = (id) => document.getElementById(id);
const E = Object.fromEntries([
  "hero", "connectionStatus", "roomHeaderTools", "setupPanel", "roomPanel", "hostModeButton", "guestModeButton", "hostSetup",
  "guestSetup", "hostNameInput", "guestNameInput", "playerCountSelect", "createRoomButton",
  "joinRoomButton", "roomCodeInput", "joinIntentField", "roomCodeDisplay", "hostTools", "roomPlayerCountSelect",
  "spectatorSettingButton", "seatActionButton",
  "spectatorPanel", "spectatorCountBadge", "spectatorList",
  "startGameButton", "restartGameButton", "endGameButton", "notice", "exchangeReveal", "deckCount",
  "discardCount", "discardTop", "players", "actionTitle", "actionHint", "actionButtons", "timerText",
  "timerBar", "controlDock", "handZone", "handHint", "hand", "toggleLogButton", "logList"
].map((id) => [id, $(id)]));

const CARD_META = {
  mud: { icon: "●", label: "泥巴", note: "让自己一只干净小猪变脏" },
  rain: { icon: "☂", label: "下雨", note: "洗净所有没有猪舍的脏猪" },
  barn: { icon: "⌂", label: "猪舍", note: "保护自己一只猪不受下雨影响" },
  lightning: { icon: "ϟ", label: "闪电", note: "摧毁对手一座没有避雷针的猪舍" },
  rod: { icon: "↟", label: "避雷针", note: "保护自己的一座猪舍不受闪电影响" },
  farmer: { icon: "♟", label: "农夫洗猪", note: "洗净对手一只没有封门的脏猪" },
  door: { icon: "▣", label: "封门", note: "阻止农夫进入脏猪的猪舍" }
};

let mode = "host";
let view = null;
let selectedCardId = null;
let revealTimer = null;
let spectatorUi = null;

const sessions = createSessionStore({ gameId: "dirty-pig" });
const countdown = createCountdown({
  onTick(value) {
    renderCountdown({ textElement: E.timerText, barElement: E.timerBar }, value);
  }
});

const room = createAuthoritativeRoomClient({
  protocolVersion: PROTOCOL_VERSION,
  sessionStore: sessions,
  onStatus(status) {
    renderConnectionStatus(E.connectionStatus, status, room.snapshot().roomCode);
  },
  handlers: {
    onView(nextView) {
      view = nextView;
      if (!view.hand.some((card) => card.id === selectedCardId)) selectedCardId = null;
      enterRoom();
      render();
    },
    onKicked() {
      spectatorUi?.handleSessionEnded("kicked");
    },
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

function submit(action) {
  return Promise.resolve(room.submitAction(action)).catch((error) => {
    E.connectionStatus.textContent = `操作失败：${error.message}`;
    alert(error.message);
  });
}

function enterRoom() {
  setHidden(E.setupPanel, true);
  setHidden(E.roomPanel, false);
  setHidden(E.roomHeaderTools, false);
  E.hero.classList.add("in-room");
  E.roomCodeDisplay.textContent = room.snapshot().roomCode;
}

async function createGameRoom() {
  E.createRoomButton.disabled = true;
  try {
    await room.createRoom({
      name: cleanPlayerName(E.hostNameInput.value, "房主"),
      capacity: Number(E.playerCountSelect.value)
    });
  } catch (error) {
    alert(`创建失败：${error.message}\n请确认已通过 node game14/signal-server.js 启动服务。`);
  } finally {
    E.createRoomButton.disabled = false;
  }
}

async function joinGameRoom() {
  E.joinRoomButton.disabled = true;
  try {
    const result = await room.joinRoom({
      code: E.roomCodeInput.value,
      name: cleanPlayerName(E.guestNameInput.value, "玩家"),
      intent: spectatorUi.getJoinIntent()
    });
    E.connectionStatus.textContent = spectatorUi.handleJoinResult(result).statusText;
  } catch (error) {
    alert(`加入失败：${error.message}`);
  } finally {
    E.joinRoomButton.disabled = false;
  }
}

async function kickPlayer(playerId) {
  const player = view.players.find((item) => item.id === playerId);
  if (!player || player.isHost || !confirm(`确定移出 ${player.name} 吗？进行中的牌局会返回大厅。`)) return;
  try { await room.kick(playerId); } catch (error) { alert(error.message); }
}

function selectedCard() {
  return view?.hand.find((card) => card.id === selectedCardId) || null;
}

function cardHtml(card) {
  const meta = CARD_META[card.type];
  const selected = card.id === selectedCardId;
  return `<button class="action-card type-${card.type} ${selected ? "selected" : ""} ${card.playable ? "playable" : ""}" data-card="${escapeHtml(card.id)}" type="button">
    <span class="card-icon">${meta.icon}</span><b>${meta.label}</b><small>${meta.note}</small>
    <em>${card.playable ? "可发动" : "当前无合法效果"}</em>
  </button>`;
}

function pigHtml(player, pig, index, legalKeys) {
  const key = `${player.id}:${pig.id}`;
  const targetable = legalKeys.has(key);
  const protections = [
    pig.hasBarn ? '<span title="猪舍">⌂ 猪舍</span>' : "",
    pig.hasDoor ? '<span title="封门">▣ 封门</span>' : "",
    pig.hasRod ? '<span title="避雷针">↟ 避雷针</span>' : ""
  ].filter(Boolean).join("");
  return `<button class="pig ${pig.dirty ? "dirty" : "clean"} ${targetable ? "targetable" : ""} ${pig.completelySafe ? "safe" : ""}" data-player="${escapeHtml(player.id)}" data-pig="${escapeHtml(pig.id)}" type="button" ${targetable ? "" : "disabled"}>
    <span class="pig-face">${pig.dirty ? "🐷" : "🐖"}</span>
    <b>小猪 ${index + 1}</b><small>${pig.dirty ? "脏小猪" : "干净小猪"}${pig.completelySafe ? " · 完全安全" : ""}</small>
    <span class="protections">${protections || "露天"}</span>
  </button>`;
}

function renderPlayers() {
  const card = selectedCard();
  const legalKeys = new Set((card?.legalTargets || []).map((target) => target.key));
  E.players.dataset.count = String(view.players.length);
  E.players.innerHTML = view.players.map((player) => `
    <article class="player-farm ${player.id === view.selfId ? "self" : ""} ${player.id === view.currentPlayerId && view.phase === "playing" ? "current" : ""} ${!player.connected ? "offline" : ""}">
      <header><div><b>${escapeHtml(player.name)}</b>${player.id === view.selfId ? " · 你" : ""}<small>${player.isHost ? "房主 · " : ""}${player.connected ? "在线" : "离线"} · 手牌 ${player.handCount}</small></div>${view.permissions.canKick && !player.isHost ? `<button class="kick" data-kick="${escapeHtml(player.id)}">移出</button>` : ""}</header>
      <div class="pig-row">${player.pigs.map((pig, index) => pigHtml(player, pig, index, legalKeys)).join("") || '<p class="waiting">等待游戏开始</p>'}</div>
    </article>`).join("");

  E.players.querySelectorAll("[data-kick]").forEach((button) => {
    button.addEventListener("click", () => kickPlayer(button.dataset.kick));
  });
  E.players.querySelectorAll(".pig.targetable").forEach((button) => {
    button.addEventListener("click", () => {
      const chosen = selectedCard();
      if (!chosen) return;
      selectedCardId = null;
      submit({
        type: "playCard",
        cardId: chosen.id,
        targetPlayerId: button.dataset.player,
        targetPigId: button.dataset.pig
      });
    });
  });
}

function addAction(text, handler, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.addEventListener("click", handler);
  E.actionButtons.append(button);
}

function renderActions(memberRole) {
  E.actionButtons.innerHTML = "";
  E.actionHint.textContent = "";
  const current = view.players.find((player) => player.id === view.currentPlayerId);
  const card = selectedCard();

  if (memberRole === "spectator") {
    E.actionTitle.textContent = view.phase === "lobby" ? "旁观准备阶段" : "正在旁观农场";
    E.actionHint.textContent = view.phase === "playing"
      ? `当前由 ${current?.name || "玩家"} 行动；旁观模式不提供出牌操作。`
      : "旁观者不计入开局人数，可在准备阶段有空位时进入玩家席。";
    E.actionButtons.innerHTML = '<p class="spectator-action-note">你只能看到公共农场状态和已经公开的换牌。</p>';
    return;
  }

  if (view.phase === "lobby") {
    E.actionTitle.textContent = "等待玩家到齐";
    E.actionHint.textContent = `当前 ${view.players.length}/${view.capacity} 人，所有玩家在线后由房主开始。`;
    return;
  }
  if (view.phase === "ended") {
    const winner = view.players.find((player) => player.id === view.winnerId);
    E.actionTitle.textContent = `${winner?.name || "玩家"} 获胜！`;
    E.actionHint.textContent = "所有小猪都已经快乐地裹满泥巴。";
    return;
  }
  if (!view.permissions.canAct) {
    E.actionTitle.textContent = `等待 ${current?.name || "当前玩家"} 行动`;
    E.actionHint.textContent = "你可以观察各家小猪的状态，提前规划下一回合。";
    return;
  }

  E.actionTitle.textContent = card ? `已选择：${card.label}` : "轮到你行动";
  if (!card) {
    E.actionHint.textContent = "先从下方选择一张手牌。你可以发动效果，也可以直接弃掉而不发动。";
  } else {
    const meta = CARD_META[card.type];
    E.actionHint.textContent = card.playable
      ? card.type === "rain" ? "下雨是全场效果，确认后立即结算。" : "请点击牌桌上带有跳动光圈的合法目标。"
      : "当前没有合法目标，但仍可以把这张牌无效果弃掉。";
    if (card.type === "rain" && card.playable) {
      addAction("发动下雨效果", () => {
        selectedCardId = null;
        submit({ type: "playCard", cardId: card.id });
      }, "primary");
    }
    addAction(`不发动效果，弃掉${meta.label}`, () => {
      selectedCardId = null;
      submit({ type: "discardCard", cardId: card.id });
    }, "discard-action");
    addAction("取消选择", () => { selectedCardId = null; render(); });
  }
  if (view.permissions.canExchange) {
    addAction("公开三张无法使用的牌并全部更换", () => {
      if (confirm("已确认三张牌均无法合法使用。确定公开并全部更换吗？")) {
        selectedCardId = null;
        submit({ type: "exchangeHand" });
      }
    }, "exchange-action");
  }
}

function renderHand() {
  E.hand.innerHTML = view.hand.map(cardHtml).join("") || '<p class="waiting">游戏开始后，你的三张私密手牌会显示在这里。</p>';
  E.handHint.textContent = view.phase === "playing"
    ? `${view.hand.length}张 · 只有你能看到牌面`
    : "游戏开始后获得3张牌";
  E.hand.querySelectorAll("[data-card]").forEach((button) => {
    button.disabled = !view.permissions.canAct;
    button.addEventListener("click", () => {
      selectedCardId = selectedCardId === button.dataset.card ? null : button.dataset.card;
      render();
    });
  });
}

function renderExchangeReveal() {
  if (revealTimer) clearTimeout(revealTimer);
  const reveal = view.revealedExchange;
  const active = reveal && reveal.until > Date.now();
  setHidden(E.exchangeReveal, !active);
  if (!active) return;
  const player = view.players.find((item) => item.id === reveal.playerId);
  E.exchangeReveal.innerHTML = `<b>${escapeHtml(player?.name || "一名玩家")} 公开并更换了三张无法使用的牌：</b><span>${reveal.cards.map((card) => escapeHtml(CARD_META[card.type]?.label || card.type)).join(" · ")}</span>`;
  revealTimer = setTimeout(() => setHidden(E.exchangeReveal, true), Math.max(0, reveal.until - Date.now()));
}

function renderLog() {
  E.logList.innerHTML = view.logs.map((entry) => `<div class="log-item">${escapeHtml(entry.text)}</div>`).join("") || '<p class="waiting">暂无记录</p>';
}

function render() {
  if (!view) return;
  const spectatorModel = spectatorUi.render(view);
  const memberRole = spectatorModel.memberRole;
  const current = view.players.find((player) => player.id === view.currentPlayerId);
  const winner = view.players.find((player) => player.id === view.winnerId);
  setHidden(E.hostTools, !view.permissions.canManage);
  setHidden(E.startGameButton, !view.permissions.canStart);
  setHidden(E.restartGameButton, !view.permissions.canRestart);
  setHidden(E.endGameButton, !view.permissions.canEnd);
  E.startGameButton.disabled = view.players.length !== view.capacity || view.players.some((player) => !player.connected);
  E.restartGameButton.disabled = view.players.some((player) => !player.connected);
  E.roomPlayerCountSelect.value = String(view.capacity);
  E.roomPlayerCountSelect.disabled = !view.permissions.canSetCapacity;
  E.deckCount.textContent = String(view.deckCount);
  E.discardCount.textContent = String(view.discardCount);
  E.discardTop.textContent = view.discardTop ? CARD_META[view.discardTop.type].label : "空";
  E.notice.textContent = memberRole === "spectator" && view.phase === "lobby"
    ? "你正在旁观准备阶段，可在有空位时主动进入玩家席"
    : view.phase === "lobby"
    ? `等待玩家加入：${view.players.length}/${view.capacity}`
    : view.phase === "ended"
      ? `本局结束 · ${winner?.name || "玩家"} 获胜`
      : `当前行动：${current?.name || "玩家"}`;

  renderPlayers();
  renderActions(memberRole);
  E.controlDock.dataset.role = memberRole;
  setHidden(E.handZone, memberRole === "spectator");
  renderHand();
  renderExchangeReveal();
  renderLog();
  if (view.deadline) countdown.start(view.deadline, ACTION_SECONDS * 1000);
  else {
    countdown.stop();
    E.timerText.textContent = "--";
    E.timerBar.style.width = "0";
  }
}

function selectMode(nextMode) {
  mode = nextMode;
  setModeVisibility(mode, {
    hostButton: E.hostModeButton,
    guestButton: E.guestModeButton,
    hostSetup: E.hostSetup,
    guestSetup: E.guestSetup,
    hostTools: E.hostTools
  });
}

async function init() {
  bindRoomCodeInput(E.roomCodeInput);
  E.hostModeButton.addEventListener("click", () => selectMode("host"));
  E.guestModeButton.addEventListener("click", () => selectMode("guest"));
  E.createRoomButton.addEventListener("click", createGameRoom);
  E.joinRoomButton.addEventListener("click", joinGameRoom);
  spectatorUi.bind();
  E.roomPlayerCountSelect.addEventListener("change", () => submit({ type: "setCapacity", capacity: Number(E.roomPlayerCountSelect.value) }));
  E.startGameButton.addEventListener("click", () => submit({ type: "start" }));
  E.restartGameButton.addEventListener("click", () => submit({ type: "restart" }));
  E.endGameButton.addEventListener("click", () => {
    if (confirm("确定结束当前牌局并返回房间大厅吗？")) submit({ type: "end" });
  });
  E.toggleLogButton.addEventListener("click", () => {
    const collapsed = E.logList.classList.toggle("collapsed");
    E.toggleLogButton.textContent = collapsed ? "展开" : "收起";
  });
  selectMode("host");
  try { spectatorUi.applyConfig(await room.checkServer()); } catch { /* join/create shows details */ }
}

init();
