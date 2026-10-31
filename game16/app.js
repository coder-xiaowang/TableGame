"use strict";

import {
  bindRoomCodeInput, cleanPlayerName, createAuthoritativeRoomClient, createCountdown, createRoomEntryController,
  createPresentationTimeline, createSessionStore, createSpectatorUi, escapeHtml, renderConnectionStatus,
  renderCountdown, setHidden, setModeVisibility
} from "/shared/client/index.js";
import { createGame16PartitionRenderer, createGame16RenderModel } from "./render-partitions.mjs";
import { courtSeatSlots } from "./court-seat-layout.mjs";

const PROTOCOL_VERSION = 3;
const PHASE_TIMER_MS = { action: 45000, challengeAction: 18000, block: 18000, challengeBlock: 18000, proveClaim: 15000, loseInfluence: 20000, exchange: 30000 };
const $ = (id) => document.getElementById(id);
const E = Object.fromEntries([
  "hero", "connectionStatus", "roomHeaderTools", "setupPanel", "roomPanel", "hostModeButton", "guestModeButton", "hostSetup", "guestSetup",
  "hostNameInput", "guestNameInput", "playerCountSelect", "createRoomButton", "joinRoomButton", "roomCodeInput", "joinIntentField",
  "roomCodeDisplay", "hostTools", "roomPlayerCountSelect", "spectatorSettingButton",
  "seatActionButton", "spectatorPanel", "spectatorCountBadge", "spectatorList", "startGameButton", "restartGameButton", "endGameButton",
  "notice", "courtPanel", "courtCenter", "courtEffects", "momentTrail", "momentAnnouncement", "momentLabel", "momentText", "deckCount", "seatBoundary", "players", "galleryRail", "leftCourtRail", "rightCourtRail", "throneRail", "controlDock", "actionTitle", "actionHint", "actionButtons", "timerText", "timerBar",
  "privateZone", "coinCount", "myInfluences", "toggleLogButton", "logList"
].map((id) => [id, $(id)]));

const ROLE_META = {
  duke: { label: "公爵", icon: "♜", ability: "征税 +3 · 阻挡外援", art: "assets/roles/duke-v1.png" },
  assassin: { label: "刺客", icon: "◆", ability: "支付 3 刺杀", art: "assets/roles/assassin-v1.png" },
  captain: { label: "船长", icon: "⚓", ability: "偷取最多 2 枚金币", art: "assets/roles/captain-v1.png" },
  ambassador: { label: "大使", icon: "✦", ability: "与宫廷交换角色", art: "assets/roles/ambassador-v1.png" },
  contessa: { label: "女伯爵", icon: "♕", ability: "阻挡刺杀", art: "assets/roles/contessa-v1.png" }
};
const ACTION_META = {
  income: { label: "收入", note: "获得 1 枚金币", target: false },
  foreignAid: { label: "外援", note: "获得 2 枚金币；可被公爵阻挡", target: false },
  coup: { label: "政变", note: "支付 7 枚，使目标失去影响力", target: true },
  tax: { label: "公爵 · 征税", note: "宣称公爵，获得 3 枚金币", target: false },
  assassinate: { label: "刺客 · 刺杀", note: "支付 3 枚，使目标失去影响力", target: true },
  steal: { label: "船长 · 偷窃", note: "从目标处偷最多 2 枚金币", target: true },
  exchange: { label: "大使 · 交换", note: "抽取 2 张并秘密重选角色", target: false }
};

let mode = "host";
let view = null;
let selectedAction = null;
let exchangeSelection = new Set();
let exchangeDraftKey = "";
let spectatorUi = null;
let actionPending = false;
let partitionRenderer = null;

const sessions = createSessionStore({ gameId: "coup" });
const countdown = createCountdown({ onTick(value) { renderCountdown({ textElement: E.timerText, barElement: E.timerBar }, value); } });
const room = createAuthoritativeRoomClient({
  protocolVersion: PROTOCOL_VERSION,
  sessionStore: sessions,
  onStatus(status) { renderConnectionStatus(E.connectionStatus, status, room.snapshot().roomCode); },
  handlers: {
    onView(nextView) { actionPending = false; view = nextView; reconcileLocalSelection(); enterRoom(); render(); },
    onKicked() { spectatorUi?.handleSessionEnded("kicked"); },
    onRoomExpired() { spectatorUi?.handleSessionEnded("room_expired"); }
  }
});

spectatorUi = createSpectatorUi({
  room, getView: () => view,
  elements: { joinIntentField: E.joinIntentField, seatActionButton: E.seatActionButton, spectatorSettingButton: E.spectatorSettingButton, spectatorPanel: E.spectatorPanel,
    spectatorCountBadge: E.spectatorCountBadge, spectatorList: E.spectatorList },
  notify: (message) => alert(message), confirmAction: (message) => confirm(message), onSessionEnded: () => location.reload()
});

function submit(action, { expectedVersion } = {}) {
  if (actionPending) return Promise.resolve();
  actionPending = true;
  E.actionButtons.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  return Promise.resolve(room.submitAction(action, { expectedVersion })).catch((error) => {
    actionPending = false;
    E.connectionStatus.textContent = `操作失败：${error.message}`;
    if (view) renderActions(view.roomRole);
    alert(error.message);
  });
}
function enterRoom() { setHidden(E.setupPanel, true); setHidden(E.roomPanel, false); setHidden(E.roomHeaderTools, false); E.hero.classList.add("in-room"); E.roomCodeDisplay.textContent = room.snapshot().roomCode; }

function exchangeContextKey(current = view) {
  if (!current?.permissions?.canExchange || !current.exchange) return "";
  return [room.snapshot().roomCode,current.selfId,current.currentPlayerId,current.exchange.cards.map((card) => card.id).sort().join(",")].join(":");
}

function selectedActionStillLegal(current = view) {
  if (!selectedAction || !current?.permissions?.canDeclareAction || !ACTION_META[selectedAction]?.target) return false;
  const self = current.players.find((player) => player.id === current.selfId);
  const cost = selectedAction === "coup" ? 7 : selectedAction === "assassinate" ? 3 : 0;
  if (!self || self.coins < cost || (self.coins >= 10 && selectedAction !== "coup")) return false;
  return current.players.some((player) => player.id !== current.selfId && !player.eliminated && (selectedAction !== "steal" || player.coins > 0));
}

function reconcileLocalSelection() {
  if (!selectedActionStillLegal()) selectedAction = null;
  const nextKey = exchangeContextKey();
  if (!nextKey) {
    exchangeDraftKey = "";
    exchangeSelection = new Set();
    return;
  }
  const legalIds = new Set(view.exchange.cards.map((card) => card.id));
  if (exchangeDraftKey !== nextKey) {
    exchangeDraftKey = nextKey;
    exchangeSelection = new Set(view.exchange.originalIds.filter((id) => legalIds.has(id)));
    return;
  }
  exchangeSelection = new Set([...exchangeSelection].filter((id) => legalIds.has(id)).slice(0,view.exchange.keepCount));
}
const roomEntry=createRoomEntryController({room,spectatorUi,elements:{root:E.setupPanel,hostModeButton:E.hostModeButton,guestModeButton:E.guestModeButton,hostSetup:E.hostSetup,guestSetup:E.guestSetup,hostTools:E.hostTools,hostNameInput:E.hostNameInput,guestNameInput:E.guestNameInput,roomCodeInput:E.roomCodeInput,createRoomButton:E.createRoomButton,joinRoomButton:E.joinRoomButton,connectionStatus:E.connectionStatus},buildCreatePayload:()=>({capacity:Number(E.playerCountSelect.value)}),formatError:(kind,error)=>kind==="create"?`创建失败：${error.message}\n请确认已启动 game16 服务。`:`加入失败：${error.message}`});

async function createGameRoom() {
  E.createRoomButton.disabled = true;
  try { await room.createRoom({ name: cleanPlayerName(E.hostNameInput.value, "房主"), capacity: Number(E.playerCountSelect.value) }); }
  catch (error) { alert(`创建失败：${error.message}\n请确认已启动 game16 服务。`); }
  finally { E.createRoomButton.disabled = false; }
}
async function joinGameRoom() {
  E.joinRoomButton.disabled = true;
  try {
    const result = await room.joinRoom({ code: E.roomCodeInput.value, name: cleanPlayerName(E.guestNameInput.value, "玩家"), intent: spectatorUi.getJoinIntent() });
    E.connectionStatus.textContent = spectatorUi.handleJoinResult(result).statusText;
  } catch (error) { alert(`加入失败：${error.message}`); }
  finally { E.joinRoomButton.disabled = false; }
}
function roleCard(card, { own = false, selectable = false, selected = false, dataKind = "", slotIndex = null } = {}) {
  const known = Boolean(card.role); const meta = ROLE_META[card.role];
  const label = known ? meta.label : card.revealed ? "已失去" : "隐藏身份";
  const detail = known ? meta.ability : own ? "只有你知道这张牌" : "仍保有影响力";
  const portrait = known
    ? `<span class="role-art" aria-hidden="true"><img src="${meta.art}" alt="" loading="lazy" decoding="async" draggable="false"></span>`
    : `<span class="role-back-mark" aria-hidden="true">♛</span>`;
  return `<button type="button" class="influence-card ${known ? `role-${card.role}` : "hidden-role"} ${card.revealed ? "revealed" : ""} ${selectable ? "selectable" : ""} ${selected ? "selected" : ""}"
    aria-label="${escapeHtml(label)}${card.revealed ? "，已公开" : ""}"
    ${slotIndex === null ? "" : `data-influence-slot="${slotIndex}"`} ${selectable ? `data-${dataKind}="${escapeHtml(card.id)}"` : "disabled"}>
    ${portrait}<span class="role-icon">${known ? meta.icon : "?"}</span>
    <span class="role-copy"><b>${label}</b><small>${detail}</small></span>
  </button>`;
}

function playersFromViewerSeat() {
  const players = [...view.players];
  const selfIndex = players.findIndex((player) => player.id === view.selfId);
  if (selfIndex <= 0) return players;
  return players.slice(selfIndex).concat(players.slice(0, selfIndex));
}

function playerNameLabel(value, limit = 5) {
  const characters = [...String(value || "玩家")];
  return characters.length > limit ? `${characters.slice(0, limit).join("")}…` : characters.join("");
}

function renderPlayers() {
  const orderedPlayers = playersFromViewerSeat();
  E.players.dataset.count = String(view.players.length);
  const existing = new Map([...E.players.querySelectorAll("[data-player-id]")]
    .map((element) => [element.dataset.playerId, element]));
  const hasSelfSeat = orderedPlayers.some((player) => player.id === view.selfId);
  const slots = courtSeatSlots(orderedPlayers.length, hasSelfSeat);
  const rails = { gallery: E.galleryRail, left: E.leftCourtRail, right: E.rightCourtRail, throne: E.throneRail };
  const railIndexes = { gallery: 0, left: 0, right: 0, throne: 0 };
  orderedPlayers.forEach((player, seatIndex) => {
    const active = player.influences.filter((card) => !card.revealed).length;
    const slot = slots[seatIndex] || { rail: "gallery" };
    const renderKey = JSON.stringify([player,seatIndex,view.selfId,view.currentPlayerId,view.phase,view.permissions.canKick]);
    let element = existing.get(player.id);
    if (!element) { element = document.createElement("article"); element.dataset.playerId = player.id; }
    if (element.dataset.renderKey !== renderKey) {
      element.dataset.renderKey = renderKey;
      element.setAttribute("data-seat-order", String(seatIndex));
      element.innerHTML = `<header><div><b title="${escapeHtml(player.name)}">${escapeHtml(playerNameLabel(player.name))}</b><small>${player.id === view.selfId ? "你 · " : ""}${player.isHost ? "房主 · " : ""}${player.connected ? "在线" : "离线"}</small></div></header><div class="wealth"><span>● ${player.coins} 金币</span><span>${player.eliminated ? "已出局" : `${active} 点影响力`}</span></div><div class="seat-cards">${player.influences.map((card, index) => roleCard(card, { slotIndex: index })).join("") || '<p class="waiting">等待开局</p>'}</div><span class="seat-admin-proxy" data-kick="${escapeHtml(player.id)}" aria-hidden="true"></span>`;
    }
    element.dataset.courtRail = slot.rail;
    element.classList.add("player-seat");
    element.classList.toggle("self", player.id === view.selfId);
    element.classList.toggle("current", player.id === view.currentPlayerId && view.phase !== "lobby");
    element.classList.toggle("eliminated", Boolean(player.eliminated));
    element.classList.toggle("offline", !player.connected);
    const manageable = Boolean(view.permissions.canKick && !player.isHost);
    const adminProxy = element.querySelector("[data-kick]");
    adminProxy.setAttribute("aria-hidden", String(!manageable));
    element.tabIndex = manageable ? 0 : -1;
    element.setAttribute("aria-haspopup", manageable ? "menu" : "false");
    element.onkeydown = manageable ? (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); element.click(); }
    } : null;
    const rail = rails[slot.rail];
    const railIndex = railIndexes[slot.rail]++;
    const expected = rail.children[railIndex];
    if (expected !== element) rail.insertBefore(element, expected || null);
    existing.delete(player.id);
  });
  existing.forEach((element) => element.remove());
}

function addButton(text, handler, className = "") {
  const button = document.createElement("button"); button.type = "button"; button.textContent = text; button.className = className; button.disabled = actionPending; button.onclick = handler; E.actionButtons.append(button);
}
function nameOf(id) { return view.players.find((player) => player.id === id)?.name || "玩家"; }
function actionName(type) { return ACTION_META[type]?.label || "行动"; }

function momentKindLabel(kind) {
  return { claim: "身份声明", action: "宫廷行动", block: "阻挡声明", challenge: "公开质疑" }[kind] || "宫廷动态";
}

function seatFor(playerId) {
  return [...E.players.querySelectorAll("[data-player-id]")].find((seat) => seat.dataset.playerId === String(playerId)) || null;
}

function showClaimPulse(moment) {
  if (moment.claimSlot === null || moment.claimSlot === undefined || moment.actorId === view.selfId) return null;
  const seat = seatFor(moment.actorId);
  const card = seat?.querySelector(`[data-influence-slot="${Number(moment.claimSlot)}"]`);
  if (!card || card.classList.contains("revealed")) return null;
  const badge = document.createElement("span");
  badge.className = "claim-badge";
  badge.textContent = `宣称 · ${ROLE_META[moment.claimedRole]?.label || "身份"}`;
  card.append(badge);
  card.classList.add("claim-pulse");
  return () => {
    card.classList.remove("claim-pulse");
    badge.remove();
  };
}

const presentation = createPresentationTimeline({
  container: E.courtPanel,
  trailPath: E.momentTrail,
  announcement: E.momentAnnouncement,
  labelElement: E.momentLabel,
  textElement: E.momentText,
  effectsElement: E.courtEffects,
  resolveSource: (moment) => seatFor(moment.actorId),
  resolveTarget: (moment) => seatFor(moment.targetId) || E.courtCenter,
  labelFor: (moment) => momentKindLabel(moment.kind),
  beforePlay: showClaimPulse,
  durationMs: 1600,
  reducedDurationMs: 650,
  maxQueue: 14,
  sceneKey: (moment) => moment.sceneId || moment.id,
  priorityFor: (moment) => Number(moment.priority) || 0,
  catchUpThreshold: 2,
  severeBacklogThreshold: 4,
  catchUpDurationMs: 700,
  severeDurationMs: 360,
  urgentPriority: 4,
  retainPriority: 4
});

function renderTargetChoices(actionType) {
  E.actionHint.textContent = `请选择“${ACTION_META[actionType].label}”的目标。`;
  view.players.filter((player) => player.id !== view.selfId && !player.eliminated && (actionType !== "steal" || player.coins > 0)).forEach((player) => {
    addButton(`${player.name} · ${player.coins}金币`, () => submit({ type: "declareAction", actionType, targetId: player.id }), "target-button");
  });
  addButton("返回行动列表", () => { selectedAction = null; render(); });
}

function renderActionChoice() {
  if (selectedAction) return renderTargetChoices(selectedAction);
  const self = view.players.find((player) => player.id === view.selfId);
  const forced = self.coins >= 10;
  E.actionTitle.textContent = forced ? "金币达到10枚：必须政变" : "轮到你行动";
  E.actionHint.textContent = forced ? "请选择一名目标，不能再执行其他行动。" : "你可以宣称任何角色，即使手中并没有它。";
  Object.entries(ACTION_META).forEach(([type, meta]) => {
    const cost = type === "coup" ? 7 : type === "assassinate" ? 3 : 0;
    if ((forced && type !== "coup") || self.coins < cost) return;
    if (type === "steal" && !view.players.some((p) => p.id !== self.id && !p.eliminated && p.coins > 0)) return;
    addButton(`${meta.label}｜${meta.note}`, () => meta.target ? (selectedAction = type, render()) : submit({ type: "declareAction", actionType: type }), type === "coup" ? "danger" : "");
  });
}

function renderExchange() {
  E.actionTitle.textContent = "秘密交换角色";
  E.actionHint.textContent = `从以下角色中保留 ${view.exchange.keepCount} 张；其余将洗回宫廷。`;
  const grid = document.createElement("div"); grid.className = "exchange-grid";
  grid.innerHTML = view.exchange.cards.map((card) => roleCard(card, { own: true, selectable: true, selected: exchangeSelection.has(card.id), dataKind: "exchange" })).join("");
  E.actionButtons.append(grid);
  grid.querySelectorAll("[data-exchange]").forEach((button) => button.onclick = () => {
    const id = button.dataset.exchange;
    if (exchangeSelection.has(id)) exchangeSelection.delete(id); else if (exchangeSelection.size < view.exchange.keepCount) exchangeSelection.add(id);
    render();
  });
  addButton(`确认保留 ${exchangeSelection.size}/${view.exchange.keepCount} 张`, () => submit({ type: "submitExchange", keepIds: [...exchangeSelection] }), "primary");
  E.actionButtons.lastElementChild.disabled = exchangeSelection.size !== view.exchange.keepCount;
}

function renderActions(memberRole) {
  E.actionButtons.innerHTML = ""; E.actionHint.textContent = "";
  const action = view.action; const current = nameOf(view.currentPlayerId);
  const reactionAction = (type, extra = {}) => ({ type, ...extra, reactionId: view.reaction?.id, reactionKind: view.reaction?.kind });
  const submitReaction = (type, extra = {}) => submit(reactionAction(type, extra), { expectedVersion: room.snapshot().version });
  if (memberRole === "spectator") {
    E.actionTitle.textContent = view.phase === "lobby" ? "旁观准备阶段" : `正在旁观 · ${current}`;
    E.actionHint.textContent = "旁观者只能看到公开角色、金币、声明和响应，不会看到隐藏身份。";
    E.actionButtons.innerHTML = '<p class="spectator-action-note">旁观模式不参与行动、质疑或阻挡。</p>'; return;
  }
  if (view.phase === "lobby") { E.actionTitle.textContent = "等待玩家到齐"; E.actionHint.textContent = `当前 ${view.players.length}/${view.capacity} 人，所有玩家在线后由房主开始。`; return; }
  if (view.phase === "ended") { E.actionTitle.textContent = `${nameOf(view.winnerId)} 赢得政变`; E.actionHint.textContent = "最后一点隐藏影响力决定了宫廷归属。"; return; }
  if (view.permissions.canDeclareAction) return renderActionChoice();
  if (view.permissions.canRespond) {
    if (view.phase === "challengeAction") {
      E.actionTitle.textContent = `是否质疑 ${nameOf(action.actorId)}？`; E.actionHint.textContent = `${nameOf(action.actorId)} 宣称角色并选择“${actionName(action.type)}”。`;
      addButton("提出质疑", () => submitReaction("challenge"), "danger"); addButton("相信 / 放弃质疑", () => submitReaction("pass")); return;
    }
    if (view.phase === "block") {
      E.actionTitle.textContent = `是否阻挡“${actionName(action.type)}”？`; E.actionHint.textContent = action.type === "foreignAid" ? "你可以宣称公爵阻挡外援。" : `你是目标玩家，可以声明角色阻挡。`;
      const roles = action.type === "foreignAid" ? ["duke"] : action.type === "assassinate" ? ["contessa"] : ["captain", "ambassador"];
      roles.forEach((role) => addButton(`声明${ROLE_META[role].label}并阻挡`, () => submitReaction("block", { role }), "warn")); addButton("不阻挡", () => submitReaction("pass")); return;
    }
    E.actionTitle.textContent = `是否质疑 ${nameOf(action.blockerId)} 的阻挡？`; E.actionHint.textContent = `${nameOf(action.blockerId)} 声称自己是${ROLE_META[action.blockRole]?.label}。`;
    addButton("质疑阻挡", () => submitReaction("challenge"), "danger"); addButton("接受阻挡", () => submitReaction("pass")); return;
  }
  if (view.permissions.canProve) {
    E.actionTitle.textContent = "你的角色声明受到质疑"; E.actionHint.textContent = `展示${ROLE_META[view.challenge.role].label}可让质疑者失去影响力；你也可以放弃证明。`;
    view.proofOptions.forEach((card) => addButton(`展示${ROLE_META[card.role].label}`, () => submit({ type: "prove", cardId: card.id }), "primary"));
    addButton("放弃证明并失去影响力", () => submit({ type: "concede" }), "danger"); return;
  }
  if (view.permissions.canLoseInfluence) {
    E.actionTitle.textContent = "选择失去一点影响力"; E.actionHint.textContent = "被选择的角色将永久公开；请谨慎决定。";
    const self = view.players.find((p) => p.id === view.selfId);
    self.influences.filter((card) => !card.revealed).forEach((card) => addButton(`公开${ROLE_META[card.role].label}`, () => submit({ type: "loseInfluence", cardId: card.id }), "danger")); return;
  }
  if (view.permissions.canExchange && view.exchange) return renderExchange();
  const phaseText = { challengeAction: "等待其他玩家决定是否质疑", block: "等待合法玩家决定是否阻挡", challengeBlock: "等待其他玩家回应阻挡", proveClaim: `等待 ${nameOf(view.challenge?.claimantId)} 证明角色`, loseInfluence: `等待 ${nameOf(view.loss?.playerId)} 选择失去的影响力`, exchange: `等待 ${nameOf(view.exchange?.playerId || action?.actorId)} 完成秘密交换` };
  E.actionTitle.textContent = phaseText[view.phase] || `等待 ${current} 行动`;
  E.actionHint.textContent = action ? `当前行动：${nameOf(action.actorId)} 的“${actionName(action.type)}”${action.targetId ? `，目标 ${nameOf(action.targetId)}` : ""}。` : "观察局势，准备你的下一次声明。";
}

function renderPrivate(memberRole) {
  setHidden(E.privateZone, memberRole === "spectator");
  if (memberRole === "spectator") return;
  const self = view.players.find((p) => p.id === view.selfId);
  E.coinCount.textContent = `${self?.coins || 0} 枚金币`;
  E.myInfluences.innerHTML = self?.influences.length ? self.influences.map((card) => roleCard(card, { own: true })).join("") : '<p class="waiting">开局后获得两张秘密角色</p>';
}
function renderLog() { E.logList.innerHTML = view.logs.map((entry) => `<div class="log-item">${escapeHtml(entry.text)}</div>`).join("") || '<p class="waiting">暂无记录</p>'; }

function renderRoom(model) {
  setHidden(E.hostTools, !view.permissions.canManage); setHidden(E.startGameButton, !view.permissions.canStart); setHidden(E.restartGameButton, !view.permissions.canRestart); setHidden(E.endGameButton, !view.permissions.canEnd);
  E.startGameButton.disabled = view.players.length !== view.capacity || view.players.some((p) => !p.connected);
  E.restartGameButton.disabled = view.players.some((p) => !p.connected);
  E.roomPlayerCountSelect.value = String(view.capacity); E.roomPlayerCountSelect.disabled = !view.permissions.canSetCapacity;
  E.roomCodeDisplay.textContent = model.roomCode;
}
function renderStatus(model) {
  E.controlDock.dataset.role = model.memberRole;
  E.notice.textContent = model.memberRole === "spectator" && view.phase === "lobby" ? "你正在旁观准备阶段，可在有空位时进入玩家席" : view.phase === "lobby" ? `等待玩家加入：${view.players.length}/${view.capacity}` : view.phase === "ended" ? `本局结束 · ${model.winner?.name || "玩家"} 获胜` : `当前行动者：${nameOf(view.currentPlayerId)}`;
}
function renderDeck() { E.deckCount.textContent = String(view.deckCount); }
function renderDecision(model) { renderActions(model.memberRole); }
function renderTimer() {
  if (view.deadline) countdown.start(view.deadline, PHASE_TIMER_MS[view.phase] || 45000); else { countdown.stop(); E.timerText.textContent = "--"; E.timerBar.style.width = "0"; }
}

partitionRenderer = createGame16PartitionRenderer({
  room: renderRoom, status: renderStatus, deck: renderDeck, players: renderPlayers,
  private: (model) => renderPrivate(model.memberRole), decision: renderDecision,
  log: renderLog, countdown: renderTimer
});

function render() {
  if (!view) return;
  const spectatorModel = spectatorUi.render(view); const memberRole = spectatorModel.memberRole;
  partitionRenderer.render(createGame16RenderModel(view, {
    memberRole, roomCode: room.snapshot().roomCode, selectedAction, exchangeSelection: [...exchangeSelection]
  }));
  presentation.sync(view.moments);
}

function selectMode(nextMode) { mode = nextMode; setModeVisibility(mode, { hostButton: E.hostModeButton, guestButton: E.guestModeButton, hostSetup: E.hostSetup, guestSetup: E.guestSetup, hostTools: E.hostTools }); }
async function init() {
  roomEntry.bind(); spectatorUi.bind();
  E.roomPlayerCountSelect.onchange = () => submit({ type: "setCapacity", capacity: Number(E.roomPlayerCountSelect.value) });
  E.startGameButton.onclick = () => submit({ type: "start" }); E.restartGameButton.onclick = () => submit({ type: "restart" });
  E.endGameButton.onclick = () => { if (confirm("确定结束当前牌局并返回大厅吗？")) submit({ type: "end" }); };
  E.toggleLogButton.onclick = () => { const collapsed = E.logList.classList.toggle("collapsed"); E.toggleLogButton.textContent = collapsed ? "展开" : "收起"; };
  selectMode("host"); try { spectatorUi.applyConfig(await room.checkServer()); } catch { /* create/join will report */ }
}
init();
