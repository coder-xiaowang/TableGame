"use strict";

import {
  bindRoomCodeInput, cleanPlayerName, createAuthoritativeRoomClient, createCountdown,
  createSessionStore, createSpectatorUi, escapeHtml, renderConnectionStatus,
  renderCountdown, setHidden, setModeVisibility
} from "/shared/client/index.js";

const PROTOCOL_VERSION = 3;
const PHASE_TIMER_MS = { caseStory: 45000, turn: 45000, chooseTarget: 30000, trade: 30000, passLeft: 30000, dogPick: 30000, privateReveal: 20000, dogReveal: 20000, roundReview: 8000 };
const CARD_META = {
  criminal: { label: "犯人", icon: "♠", description: "只能作为最后一张手牌打出。", tone: "culprit" },
  discoverer: { label: "第一发现者", icon: "!", description: "描述本轮案件并揭开调查。", tone: "clue" },
  detective: { label: "侦探", icon: "⌕", description: "第二圈起指认一名玩家。", tone: "detective" },
  alibi: { label: "不在场证明", icon: "✓", description: "留在手中抵挡侦探。", tone: "alibi" },
  accomplice: { label: "共犯", icon: "◇", description: "打出后与犯人共同胜负。", tone: "culprit" },
  witness: { label: "目击者", icon: "◉", description: "秘密查看一名玩家的全部手牌。", tone: "clue" },
  dog: { label: "神犬", icon: "♧", description: "公开搜查目标的一张牌。", tone: "dog" },
  child: { label: "少年", icon: "☆", description: "秘密知道当前犯人是谁。", tone: "clue" },
  trade: { label: "交易", icon: "⇄", description: "双方各选一张秘密交换。", tone: "motion" },
  passLeft: { label: "情报交换", icon: "↶", description: "所有人同时向左传递一张。", tone: "motion" },
  gossip: { label: "谣言", icon: "↻", description: "所有人从右侧随机获得一张。", tone: "motion" },
  civilian: { label: "普通人", icon: "○", description: "打出后没有效果。", tone: "plain" }
};
const $ = (id) => document.getElementById(id);
const E = Object.fromEntries([
  "hero", "connectionStatus", "roomHeaderTools", "setupPanel", "roomPanel", "hostModeButton", "guestModeButton", "hostSetup", "guestSetup", "hostNameInput", "guestNameInput",
  "playerCountSelect", "targetScoreSelect", "createRoomButton", "joinRoomButton", "roomCodeInput", "joinIntentField", "roomCodeDisplay", "hostTools",
  "roomPlayerCountSelect", "roomTargetScoreSelect", "spectatorSettingButton", "seatActionButton",
  "spectatorPanel", "spectatorCountBadge", "spectatorList", "startGameButton", "restartGameButton", "endGameButton", "notice", "caseText", "roundNumber",
  "targetScoreLabel", "players", "controlDock", "actionTitle", "actionHint", "actionButtons", "timerText", "timerBar", "discardCount", "discardPile",
  "privateZone", "myHand", "toggleLogButton", "logList"
].map((id) => [id, $(id)]));

let mode = "host";
let view = null;
let selectedCardId = null;
let spectatorUi = null;
let pendingInitialTargetScore = null;

const sessions = createSessionStore({ gameId: "dancing-criminal" });
const countdown = createCountdown({ onTick(value) { renderCountdown({ textElement: E.timerText, barElement: E.timerBar }, value); } });
const room = createAuthoritativeRoomClient({
  protocolVersion: PROTOCOL_VERSION,
  sessionStore: sessions,
  onStatus(status) { renderConnectionStatus(E.connectionStatus, status, room.snapshot().roomCode); },
  handlers: {
    onView(nextView) {
      view = nextView;
      const ownIds = new Set(view.players.find((player) => player.id === view.selfId)?.hand.map((card) => card.id) || []);
      if (!ownIds.has(selectedCardId)) selectedCardId = null;
      enterRoom();
      render();
      applyPendingInitialSettings();
    },
    onKicked() { spectatorUi?.handleSessionEnded("kicked"); },
    onRoomExpired() { spectatorUi?.handleSessionEnded("room_expired"); }
  }
});

spectatorUi = createSpectatorUi({
  room,
  getView: () => view,
  elements: {
    joinIntentField: E.joinIntentField, seatActionButton: E.seatActionButton, spectatorSettingButton: E.spectatorSettingButton, spectatorPanel: E.spectatorPanel,
    spectatorCountBadge: E.spectatorCountBadge, spectatorList: E.spectatorList
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

function applyPendingInitialSettings() {
  if (pendingInitialTargetScore == null || view?.phase !== "lobby" || !view.permissions?.canSetTargetScore) return;
  const self = view.players.find((player) => player.id === view.selfId);
  if (!self?.connected) return;
  const targetScore = pendingInitialTargetScore;
  pendingInitialTargetScore = null;
  if (view.targetScore !== targetScore) submit({ type: "setTargetScore", targetScore });
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
  pendingInitialTargetScore = Number(E.targetScoreSelect.value);
  try {
    await room.createRoom({ name: cleanPlayerName(E.hostNameInput.value, "房主"), capacity: Number(E.playerCountSelect.value) });
  } catch (error) {
    pendingInitialTargetScore = null;
    alert(`创建失败：${error.message}\n请确认已启动 game18 服务。`);
  } finally {
    E.createRoomButton.disabled = false;
  }
}

async function joinGameRoom() {
  E.joinRoomButton.disabled = true;
  try {
    const result = await room.joinRoom({ code: E.roomCodeInput.value, name: cleanPlayerName(E.guestNameInput.value, "玩家"), intent: spectatorUi.getJoinIntent() });
    E.connectionStatus.textContent = spectatorUi.handleJoinResult(result).statusText;
  } catch (error) {
    alert(`加入失败：${error.message}`);
  } finally {
    E.joinRoomButton.disabled = false;
  }
}

async function kickPlayer(playerId) {
  const player = view.players.find((item) => item.id === playerId);
  if (!player || player.isHost || !confirm(`确定移出 ${player.name} 吗？进行中的比赛会返回大厅。`)) return;
  try { await room.kick(playerId); } catch (error) { alert(error.message); }
}

function meta(type) { return CARD_META[type] || { label: "未知牌", icon: "?", description: "", tone: "plain" }; }
function nameOf(id) { return view.players.find((player) => player.id === id)?.name || "玩家"; }
function ownPlayer() { return view.players.find((player) => player.id === view.selfId) || null; }

function cardMarkup(card, { compact = false, selectable = false, selected = false } = {}) {
  const known = Boolean(card.type);
  const item = meta(card.type);
  const label = known ? item.label : "秘密手牌";
  return `<button type="button" class="game-card ${known ? `tone-${item.tone}` : "card-back"} ${compact ? "compact" : ""} ${selectable ? "selectable" : ""} ${selected ? "selected" : ""}"
    ${selectable ? `data-card-id="${escapeHtml(card.id)}"` : "disabled"} aria-label="${escapeHtml(label)}">
    <span class="card-icon">${known ? item.icon : "?"}</span><b>${escapeHtml(label)}</b>${compact ? "" : `<small>${escapeHtml(known ? item.description : "牌值仅持有者可见")}</small>`}
  </button>`;
}

function renderPlayers() {
  E.players.dataset.count = String(view.players.length);
  const ownIndex = view.players.findIndex((player) => player.id === view.selfId);
  const orderedPlayers = ownIndex < 0 ? view.players : [...view.players.slice(ownIndex), ...view.players.slice(0, ownIndex)];
  const leftCount = Math.floor(orderedPlayers.length / 2);
  const rightCount = orderedPlayers.length - leftCount;
  E.players.innerHTML = orderedPlayers.map((player, index) => {
    const side = index < leftCount ? "left" : "right";
    const sideIndex = side === "left" ? index : index - leftCount;
    const sideCount = side === "left" ? leftCount : rightCount;
    const y = sideCount === 1 ? 50 : 8 + 84 * (sideIndex + .5) / sideCount;
    return `<article data-seat-side="${side}" class="player-seat ${player.id === view.selfId ? "self" : ""} ${player.id === view.currentPlayerId && !["lobby", "roundReview", "ended"].includes(view.phase) ? "current" : ""} ${!player.connected ? "offline" : ""}" style="--seat-y:${y}%">
      <header><div><b>${escapeHtml(player.name)}${player.id === view.selfId ? " · 你" : ""}</b><small>${player.isHost ? "房主 · " : ""}${player.connected ? "在线" : "离线"}</small></div>${view.permissions.canKick && !player.isHost ? `<button class="kick" data-kick="${escapeHtml(player.id)}">移出</button>` : ""}</header>
      <div class="score-line"><strong>${player.score}</strong><span>/ ${view.targetScore} 分</span>${player.accomplice ? '<em>已公开共犯</em>' : ""}</div>
      <div class="seat-hand">${player.hand.map((card) => cardMarkup(card, { compact: true })).join("") || '<span class="empty-hand">暂无手牌</span>'}</div>
    </article>`;
  }).join("");
  E.players.querySelectorAll("[data-kick]").forEach((button) => { button.onclick = () => kickPlayer(button.dataset.kick); });
}

function renderDiscard() {
  E.discardCount.textContent = `${view.discard.length}张`;
  const cards = view.discard.slice(-14).reverse();
  E.discardPile.innerHTML = cards.length ? cards.map((card) => `<div class="discard-card tone-${meta(card.type).tone}" title="${escapeHtml(nameOf(card.playedBy))} 打出"><span>${meta(card.type).icon}</span><b>${escapeHtml(meta(card.type).label)}</b><small>${escapeHtml(nameOf(card.playedBy))}</small></div>`).join("") : '<p class="muted">开局后显示公开打出的牌</p>';
}

function addButton(text, handler, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.className = className;
  button.onclick = handler;
  E.actionButtons.append(button);
  return button;
}

function renderCaseAction() {
  E.actionTitle.textContent = "你是第一发现者";
  E.actionHint.textContent = "为这一轮描述一个轻松的案件，最多100字；留空则由服务器生成。";
  const input = document.createElement("textarea");
  input.maxLength = 100;
  input.rows = 3;
  input.placeholder = "例如：冰箱里最后一块蛋糕不见了！";
  E.actionButtons.append(input);
  addButton("公布案件并开始调查", () => submit({ type: "submitCase", text: input.value }), "primary");
}

function renderPlayAction() {
  const self = ownPlayer();
  const card = self?.hand.find((item) => item.id === selectedCardId);
  if (!card) {
    E.actionTitle.textContent = "轮到你出牌";
    E.actionHint.textContent = "从下方手牌选择一张。犯人牌只有成为最后一张时才能打出。";
    return;
  }
  const item = meta(card.type);
  const criminalLocked = card.type === "criminal" && self.hand.length !== 1;
  E.actionTitle.textContent = `准备打出：${item.label}`;
  E.actionHint.textContent = criminalLocked ? "犯人牌目前不是最后一张，不能打出。" : item.description;
  addButton(criminalLocked ? "当前不能打出犯人" : `确认打出“${item.label}”`, () => submit({ type: "playCard", cardId: card.id }), criminalLocked ? "" : "primary").disabled = criminalLocked;
  addButton("取消选择", () => { selectedCardId = null; renderActions(view.roomRole); });
}

function renderTargetAction() {
  const kind = view.pending.kind;
  E.actionTitle.textContent = `${meta(kind).label}：选择目标`;
  E.actionHint.textContent = kind === "detective" ? "选择要指认的玩家；不在场证明可能让指认失败。" : `选择一名有手牌的其他玩家。`;
  view.players.filter((player) => player.id !== view.selfId && (kind === "detective" || player.handCount > 0)).forEach((player) => {
    addButton(`${player.name} · ${player.handCount}张`, () => submit({ type: "chooseTarget", targetId: player.id }), "target-button");
  });
}

function renderSecretSelection(kind) {
  const waiting = view.pending.submittedIds.includes(view.selfId);
  const title = kind === "trade" ? "秘密选择交易牌" : "秘密选择向左传递的牌";
  E.actionTitle.textContent = waiting ? "选择已确认" : title;
  E.actionHint.textContent = waiting
    ? `正在等待：${view.pending.participantIds.filter((id) => !view.pending.submittedIds.includes(id)).map(nameOf).join("、") || "服务器结算"}`
    : "对方只能看到你已经确认，不能看到你选择了哪张牌。";
  if (!waiting && selectedCardId) {
    const actionType = kind === "trade" ? "submitTradeCard" : "submitPassCard";
    addButton(`确认选择“${meta(ownPlayer().hand.find((card) => card.id === selectedCardId)?.type).label}”`, () => submit({ type: actionType, cardId: selectedCardId }), "primary");
    addButton("重新选择", () => { selectedCardId = null; renderActions(view.roomRole); });
  }
}

function renderDogPick() {
  E.actionTitle.textContent = `神犬正在搜查 ${nameOf(view.pending.targetId)}`;
  E.actionHint.textContent = "这些牌背顺序由服务器临时打乱，选择一张公开检查。";
  const slots = document.createElement("div");
  slots.className = "dog-slots";
  slots.innerHTML = view.pending.slots.map((key, index) => `<button type="button" data-slot="${escapeHtml(key)}"><span>?</span><b>牌背 ${index + 1}</b></button>`).join("");
  E.actionButtons.append(slots);
  slots.querySelectorAll("[data-slot]").forEach((button) => { button.onclick = () => submit({ type: "chooseDogSlot", slotKey: button.dataset.slot }); });
}

function renderPrivateInsight() {
  if (view.privateInsight?.kind === "identifiedByChild") {
    E.actionHint.textContent = `${nameOf(view.privateInsight.actorId)} 已经通过少年认出了你是当前犯人。`;
  }
  if (!view.permissions.canAcknowledge) return false;
  if (view.privateInsight?.kind === "witness") {
    E.actionTitle.textContent = `${nameOf(view.privateInsight.targetId)} 的手牌`;
    E.actionHint.textContent = "只有你能看到这些牌，请记住后继续。";
    const reveal = document.createElement("div");
    reveal.className = "insight-cards";
    reveal.innerHTML = view.privateInsight.cardTypes.map((type, index) => cardMarkup({ id: `insight_${index}`, type }, { compact: true })).join("");
    E.actionButtons.append(reveal);
  } else if (view.privateInsight?.kind === "child") {
    E.actionTitle.textContent = "少年发现了当前犯人";
    E.actionHint.textContent = `此刻持有犯人牌的是：${nameOf(view.privateInsight.culpritHolderId)}。只有你知道这个结果。`;
  } else if (view.pending.type === "dogReveal") {
    E.actionTitle.textContent = `神犬公开了“${meta(view.pending.revealedType).label}”`;
    E.actionHint.textContent = "这不是犯人牌，卡牌已经回到目标手中。";
  }
  addButton("我已看清，继续", () => submit({ type: "acknowledge" }), "primary");
  return true;
}

function renderRoundResult() {
  const result = view.roundResult;
  E.actionTitle.textContent = view.phase === "ended" ? `${view.winnerIds.map(nameOf).join("、")} 赢得比赛` : result?.title || "本轮结束";
  E.actionHint.textContent = result ? view.players.map((player) => `${player.name} +${result.changes[player.id] || 0}（共${player.score}分）`).join(" · ") : "";
}

function renderActions(memberRole) {
  E.actionButtons.innerHTML = "";
  E.actionHint.textContent = "";
  if (memberRole === "spectator") {
    E.actionTitle.textContent = view.phase === "lobby" ? "旁观准备阶段" : `正在旁观第 ${view.round} 轮`;
    E.actionHint.textContent = "旁观者只能看到公开牌迹、手牌数量、行动和得分，不会获得秘密信息。";
    return;
  }
  if (view.phase === "lobby") {
    E.actionTitle.textContent = "等待调查员到齐";
    E.actionHint.textContent = `当前 ${view.players.length}/${view.capacity} 人；所有玩家在线后由房主开始。`;
    return;
  }
  if (["roundReview", "ended"].includes(view.phase)) return renderRoundResult();
  if (view.permissions.canSubmitCase) return renderCaseAction();
  if (view.permissions.canPlayCard) return renderPlayAction();
  if (view.permissions.canChooseTarget) return renderTargetAction();
  if (view.permissions.canSubmitTrade) return renderSecretSelection("trade");
  if (view.permissions.canSubmitPass) return renderSecretSelection("passLeft");
  if (view.permissions.canChooseDogSlot) return renderDogPick();
  if (renderPrivateInsight()) return;

  const pending = view.pending;
  const messages = {
    caseStory: `等待 ${nameOf(pending?.actorId)} 描述案件`,
    turn: `等待 ${nameOf(view.currentPlayerId)} 出牌`,
    chooseTarget: `等待 ${nameOf(pending?.actorId)} 为${meta(pending?.kind).label}选择目标`,
    trade: `等待交易双方秘密确认`,
    passLeft: `等待所有有手牌的玩家秘密确认`,
    dogPick: `等待 ${nameOf(pending?.actorId)} 选择神犬搜查位置`,
    privateReveal: `等待 ${nameOf(pending?.actorId)} 查看秘密信息`,
    dogReveal: `等待 ${nameOf(pending?.actorId)} 确认公开结果`
  };
  E.actionTitle.textContent = messages[view.phase] || "服务器正在结算";
  E.actionHint.textContent ||= view.privateInsight?.kind === "identifiedByChild" ? `${nameOf(view.privateInsight.actorId)} 已经认出了你。` : "超时后服务器会自动执行合法默认选择。";
}

function renderHand(memberRole) {
  setHidden(E.privateZone, memberRole === "spectator");
  if (memberRole === "spectator") return;
  const self = ownPlayer();
  if (!self?.hand.length) {
    E.myHand.innerHTML = '<p class="empty-hand">你目前没有手牌；仍可能通过其他玩家的效果重新获得牌。</p>';
    return;
  }
  const selectable = view.permissions.canPlayCard || view.permissions.canSubmitTrade || view.permissions.canSubmitPass;
  E.myHand.innerHTML = self.hand.map((card) => cardMarkup(card, { selectable, selected: selectedCardId === card.id })).join("");
  E.myHand.querySelectorAll("[data-card-id]").forEach((button) => {
    button.onclick = () => {
      selectedCardId = button.dataset.cardId;
      renderHand(memberRole);
      renderActions(memberRole);
    };
  });
}

function renderLog() {
  E.logList.innerHTML = view.logs.map((entry) => `<div class="log-item">${escapeHtml(entry.text)}</div>`).join("") || '<p class="muted">暂无记录</p>';
}

function render() {
  if (!view) return;
  const spectatorModel = spectatorUi.render(view);
  const memberRole = spectatorModel.memberRole;
  setHidden(E.hostTools, !view.permissions.canManage);
  setHidden(E.startGameButton, !view.permissions.canStart);
  setHidden(E.restartGameButton, !view.permissions.canRestart);
  setHidden(E.endGameButton, !view.permissions.canEnd);
  E.startGameButton.disabled = view.players.length !== view.capacity || view.players.some((player) => !player.connected);
  E.restartGameButton.disabled = view.players.some((player) => !player.connected);
  E.roomPlayerCountSelect.value = String(view.capacity);
  E.roomTargetScoreSelect.value = String(view.targetScore);
  E.roomPlayerCountSelect.disabled = !view.permissions.canSetCapacity;
  E.roomTargetScoreSelect.disabled = !view.permissions.canSetTargetScore;
  E.controlDock.dataset.role = memberRole;
  E.caseText.textContent = view.caseText || "尚未发生案件";
  E.roundNumber.textContent = String(view.round);
  E.targetScoreLabel.textContent = String(view.targetScore);
  E.notice.textContent = view.phase === "lobby" ? `等待玩家加入：${view.players.length}/${view.capacity}` : view.phase === "ended" ? "比赛结束，所有手牌已经公开" : `第 ${view.round} 轮 · 当前行动者：${nameOf(view.currentPlayerId)}`;
  renderPlayers();
  renderDiscard();
  renderActions(memberRole);
  renderHand(memberRole);
  renderLog();
  if (view.deadline) countdown.start(view.deadline, PHASE_TIMER_MS[view.phase] || 45000);
  else { countdown.stop(); E.timerText.textContent = "--"; E.timerBar.style.width = "0"; }
}

function selectMode(nextMode) {
  mode = nextMode;
  setModeVisibility(mode, { hostButton: E.hostModeButton, guestButton: E.guestModeButton, hostSetup: E.hostSetup, guestSetup: E.guestSetup, hostTools: E.hostTools });
}

async function init() {
  bindRoomCodeInput(E.roomCodeInput);
  E.hostModeButton.onclick = () => selectMode("host");
  E.guestModeButton.onclick = () => selectMode("guest");
  E.createRoomButton.onclick = createGameRoom;
  E.joinRoomButton.onclick = joinGameRoom;
  spectatorUi.bind();
  E.roomPlayerCountSelect.onchange = () => submit({ type: "setCapacity", capacity: Number(E.roomPlayerCountSelect.value) });
  E.roomTargetScoreSelect.onchange = () => submit({ type: "setTargetScore", targetScore: Number(E.roomTargetScoreSelect.value) });
  E.startGameButton.onclick = () => submit({ type: "start" });
  E.restartGameButton.onclick = () => submit({ type: "restart" });
  E.endGameButton.onclick = () => { if (confirm("确定结束当前比赛并返回准备阶段吗？")) submit({ type: "end" }); };
  E.toggleLogButton.onclick = () => { const collapsed = E.logList.classList.toggle("collapsed"); E.toggleLogButton.textContent = collapsed ? "展开" : "收起"; };
  selectMode("host");
  try { spectatorUi.applyConfig(await room.checkServer()); } catch { /* 创建或加入时给出错误 */ }
}

init();
