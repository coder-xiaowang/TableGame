"use strict";

import {
  bindRoomCodeInput, cleanPlayerName, createAuthoritativeRoomClient, createCountdown, createPresentationTimeline, createRoomEntryController,
  createSessionStore, createSpectatorUi, escapeHtml, renderConnectionStatus,
  renderCountdown, setHidden, setModeVisibility
} from "/shared/client/index.js";
import { createGame17PartitionRenderer, createGame17RenderModel } from "./render-partitions.mjs";

const PROTOCOL_VERSION = 3;
const PHASE_TIMER_MS = { supply: 60000, bidding: 45000, marketAction: 30000, selling: 45000, dividend: 30000, roundReview: 8000 };
const COMPANIES = [
  { id: "nova", name: "新星科技", short: "新星", color: "#4d78b8" }, { id: "evergreen", name: "常青能源", short: "常青", color: "#4c956c" },
  { id: "harbor", name: "海港金融", short: "海港", color: "#b88a3d" }, { id: "apex", name: "巅峰汽车", short: "巅峰", color: "#c75b4d" },
  { id: "cloud", name: "云端零售", short: "云端", color: "#8c68ad" }, { id: "aurora", name: "极光传媒", short: "极光", color: "#3c9a9a" }
];
const BID_LEVELS = [0, 1000, 3000, 6000, 10000, 15000, 20000, 25000];
const $ = (id) => document.getElementById(id);
const E = Object.fromEntries([
  "hero", "connectionStatus", "roomHeaderTools", "setupPanel", "roomPanel", "hostModeButton", "guestModeButton", "hostSetup", "guestSetup", "hostNameInput", "guestNameInput",
  "playerCountSelect", "createRoomButton", "joinRoomButton", "roomCodeInput", "joinIntentField", "roomCodeDisplay", "hostTools", "roomPlayerCountSelect",
  "spectatorSettingButton", "seatActionButton", "spectatorPanel", "spectatorCountBadge", "spectatorList",
  "startGameButton", "restartGameButton", "endGameButton", "notice", "roundNumber", "roundTotal", "deckCount", "stockTicker", "informationPanel", "stockpiles",
  "players", "controlDock", "actionTitle", "actionHint", "actionButtons", "timerText", "timerBar", "privateZone", "myCash", "myInformation", "myPortfolio", "toggleLogButton", "logList",
  "presentationEffects", "presentationTrail", "presentationAnnouncement", "presentationLabel", "presentationText"
].map((id) => [id, $(id)]));

let mode = "host"; let view = null; let spectatorUi = null; let presentation = null; let actionDraft = null; let partitionRenderer = null;
const sessions = createSessionStore({ gameId: "stockpile" });
const countdown = createCountdown({ onTick(value) { renderCountdown({ textElement: E.timerText, barElement: E.timerBar }, value); } });
const room = createAuthoritativeRoomClient({
  protocolVersion: PROTOCOL_VERSION, sessionStore: sessions,
  onStatus(status) { renderConnectionStatus(E.connectionStatus, status, room.snapshot().roomCode); },
  handlers: {
    onView(nextView) { captureActionDraft(); view = nextView; reconcileActionDraft(); enterRoom(); render(); presentation?.sync(nextView.presentationEvents); },
    onKicked() { spectatorUi?.handleSessionEnded("kicked"); }, onRoomExpired() { spectatorUi?.handleSessionEnded("room_expired"); }
  }
});

spectatorUi = createSpectatorUi({
  room, getView: () => view,
  elements: { joinIntentField: E.joinIntentField, seatActionButton: E.seatActionButton,
    spectatorSettingButton: E.spectatorSettingButton, spectatorPanel: E.spectatorPanel, spectatorCountBadge: E.spectatorCountBadge, spectatorList: E.spectatorList },
  notify: (message) => alert(message), confirmAction: (message) => confirm(message), onSessionEnded: () => location.reload()
});

const money = (amount) => `$${Number(amount || 0) / 1000}K`;
const company = (id) => COMPANIES.find((item) => item.id === id) || { id, name: "未知公司", short: "未知", color: "#777" };
const nameOf = (id) => view?.players.find((player) => player.id === id)?.name || "玩家";
const forecastLabel = (id) => ({ down3: "-3", down2: "-2", up1: "+1", up2: "+2", up4: "+4", dividend: "分红 $$" })[id] || "?";
const cardText = (card) => card.kind === "stock" ? `${company(card.companyId).short}股票` : card.kind === "fee" ? `费用 ${money(card.amount)}` : card.kind === "action" ? (card.actionType === "boom" ? "上涨 +2" : "下跌 -2") : "暗牌";

function submit(action) { return Promise.resolve(room.submitAction(action)).catch((error) => { E.connectionStatus.textContent = `操作失败：${error.message}`; alert(error.message); }); }
function enterRoom() { setHidden(E.setupPanel, true); setHidden(E.roomPanel, false); setHidden(E.roomHeaderTools, false); E.hero.classList.add("in-room"); E.roomCodeDisplay.textContent = room.snapshot().roomCode; }
const roomEntry=createRoomEntryController({room,spectatorUi,elements:{root:E.setupPanel,hostModeButton:E.hostModeButton,guestModeButton:E.guestModeButton,hostSetup:E.hostSetup,guestSetup:E.guestSetup,hostTools:E.hostTools,hostNameInput:E.hostNameInput,guestNameInput:E.guestNameInput,roomCodeInput:E.roomCodeInput,createRoomButton:E.createRoomButton,joinRoomButton:E.joinRoomButton,connectionStatus:E.connectionStatus},buildCreatePayload:()=>({capacity:Number(E.playerCountSelect.value)}),formatError:(kind,error)=>kind==="create"?`创建失败：${error.message}\n请确认已启动 game17 服务。`:`加入失败：${error.message}`});

async function createGameRoom() {
  E.createRoomButton.disabled = true;
  try { await room.createRoom({ name: cleanPlayerName(E.hostNameInput.value, "房主"), capacity: Number(E.playerCountSelect.value) }); }
  catch (error) { alert(`创建失败：${error.message}\n请确认已启动 game17 服务。`); } finally { E.createRoomButton.disabled = false; }
}
async function joinGameRoom() {
  E.joinRoomButton.disabled = true;
  try { const result = await room.joinRoom({ code: E.roomCodeInput.value, name: cleanPlayerName(E.guestNameInput.value, "玩家"), intent: spectatorUi.getJoinIntent() }); E.connectionStatus.textContent = spectatorUi.handleJoinResult(result).statusText; }
  catch (error) { alert(`加入失败：${error.message}`); } finally { E.joinRoomButton.disabled = false; }
}
async function kickPlayer(playerId) {
  const player = view.players.find((item) => item.id === playerId);
  if (!player || player.isHost || !confirm(`确定移出 ${player.name} 吗？进行中的牌局会返回大厅。`)) return;
  try { await room.kick(playerId); } catch (error) { alert(error.message); }
}

const playerAnchor = (id) => id ? E.players.querySelector(`[data-player-id="${CSS.escape(String(id))}"]`) : null;
const pileAnchor = (id) => id ? E.stockpiles.querySelector(`[data-pile-id="${CSS.escape(String(id))}"]`) : null;
const companyAnchor = (id) => id ? E.stockTicker.querySelector(`[data-company-id="${CSS.escape(String(id))}"]`) : null;
function presentationLabel(kind) {
  return ({ "round-start": "新一轮开市", "supply-turn": "配置供给", "supply-place": "供给入场", "bidding-start": "公开竞价", "bid-turn": "等待报价", bid: "最新报价", "stockpiles-resolved": "交易交割", "market-action-turn": "市场行动", "market-action": "干预行情", "selling-start": "卖出阶段", "sell-turn": "等待卖出", sale: "成交回报", "information-reveal-start": "内幕揭晓", "information-reveal": "行情公开", "price-move": "股价异动", "dividend-turn": "分红申报", dividend: "分红到账", "round-review": "本轮收盘", "game-result": "最终收盘", "timeout-default": "系统托管" })[kind] || "交易动态";
}
function eventSource(event) {
  if (["round-start", "bidding-start", "stockpiles-resolved", "selling-start", "information-reveal-start", "round-review", "game-result"].includes(event.kind)) return document.querySelector(".market-head");
  if (event.kind === "information-reveal") return playerAnchor(event.ownerId) || E.informationPanel;
  if (["price-move", "dividend", "dividend-turn"].includes(event.kind)) return companyAnchor(event.companyId);
  return playerAnchor(event.actorId) || document.querySelector(".market-head");
}
function eventTarget(event) {
  if (["supply-place", "bid"].includes(event.kind)) return pileAnchor(event.pileId || event.faceUpPileId);
  if (["market-action", "price-move", "information-reveal"].includes(event.kind)) return companyAnchor(event.companyId);
  if (["dividend", "dividend-turn"].includes(event.kind)) return playerAnchor(event.actorId);
  if (event.kind === "stockpiles-resolved") return playerAnchor(event.awards?.[0]?.playerId) || E.players;
  if (event.kind === "sale") return companyAnchor(event.companyIds?.[0]) || playerAnchor(event.actorId);
  return playerAnchor(event.targetId || event.actorId) || document.querySelector(".market-head");
}
function playPresentationObject(event) {
  const source = eventSource(event), target = eventTarget(event);
  const extras = [
    ...(event.awards || []).flatMap((award) => [pileAnchor(award.pileId), playerAnchor(award.playerId)]),
    ...(event.companyIds || []).map(companyAnchor), pileAnchor(event.faceDownPileId), playerAnchor(event.targetId)
  ].filter(Boolean);
  const highlighted = [...new Set([source, target, ...extras].filter(Boolean))];
  highlighted.forEach((element) => element.classList.add("presentation-focus"));
  if (event.kind === "price-move") target?.classList.add(event.amount > 0 ? "presentation-rise" : "presentation-fall");
  let token = null;
  if (source && target && source !== target) {
    const stage = E.presentationEffects.getBoundingClientRect(), from = source.getBoundingClientRect(), to = target.getBoundingClientRect();
    token = document.createElement("span"); token.className = "presentation-token";
    token.textContent = ({ "supply-place": "入场", bid: money(event.amount), "stockpiles-resolved": "成交", "market-action": event.actionType === "boom" ? "+2" : "−2", "information-reveal": event.forecastLabel, "price-move": `${event.amount > 0 ? "+" : ""}${event.amount}`, sale: money(event.proceeds), dividend: money(event.payout), "timeout-default": "托管" })[event.kind] || "◆";
    token.style.setProperty("--from-x", `${from.left + from.width / 2 - stage.left}px`); token.style.setProperty("--from-y", `${from.top + from.height / 2 - stage.top}px`); token.style.setProperty("--to-x", `${to.left + to.width / 2 - stage.left}px`); token.style.setProperty("--to-y", `${to.top + to.height / 2 - stage.top}px`); E.presentationEffects.append(token);
  }
  return () => { highlighted.forEach((element) => element.classList.remove("presentation-focus", "presentation-rise", "presentation-fall")); token?.remove(); };
}

function infoCard(pair, label) {
  if (!pair) return ""; const item = company(pair.companyId);
  return `<article class="info-card" data-info-company="${escapeHtml(item.id)}" style="--company:${item.color}"><small>${escapeHtml(label)}</small><b>${escapeHtml(item.name)}</b><strong>${escapeHtml(forecastLabel(pair.forecastId))}</strong></article>`;
}

function renderTicker() {
  E.roundNumber.textContent = String(view.round); E.roundTotal.textContent = String(view.totalRounds); E.deckCount.textContent = String(view.deckCount);
  const existing = new Map([...E.stockTicker.querySelectorAll(":scope > [data-company-id]")].map((node) => [node.dataset.companyId, node]));
  COMPANIES.forEach((item, index) => {
    let node = existing.get(item.id);
    if (!node) { node = document.createElement("article"); node.dataset.companyId = item.id; }
    const renderKey = `${view.stockPrices[item.id]}`;
    if (node.dataset.renderKey !== renderKey) {
      const presentationClasses = ["presentation-focus", "presentation-rise", "presentation-fall"].filter((name) => node.classList.contains(name));
      node.dataset.renderKey = renderKey; node.style.setProperty("--company", item.color);
      node.innerHTML = `<span>${escapeHtml(item.short)}</span><b>$${view.stockPrices[item.id]}</b><div class="price-track"><i style="width:${view.stockPrices[item.id] * 10}%"></i></div>`;
      presentationClasses.forEach((name) => node.classList.add(name));
    }
    const expected = E.stockTicker.children[index]; if (expected !== node) E.stockTicker.insertBefore(node, expected || null);
    existing.delete(item.id);
  });
  existing.forEach((node) => node.remove());
}

function renderInformation() {
  if (view.phase === "ended") {
    E.informationPanel.innerHTML = view.finalScores.slice().sort((a, b) => b.total - a.total).map((score) => `<article class="score-card"><b>${escapeHtml(nameOf(score.playerId))}</b><span>现金 ${money(score.cash)}</span><span>股票 ${money(score.shareValue)}</span><span>大股东 ${money(score.majorityBonus)}</span><strong>${money(score.total)}</strong></article>`).join("");
    return;
  }
  const revealedIds = new Set(view.revealedInformation.map((pair) => pair.id));
  E.informationPanel.innerHTML = [
    view.publicInformation && !revealedIds.has(view.publicInformation.id) ? infoCard(view.publicInformation, "公开内幕") : "",
    ...view.revealedInformation.map((pair) => infoCard(pair, "已公布行情")),
    ...Array.from({ length: view.hiddenInformationCount }, () => '<article class="info-card hidden-info"><small>未知内幕</small><b>?</b><strong>?</strong></article>')
  ].join("") || '<p class="muted">开局后显示本轮公开行情</p>';
}

function marketCard(card) {
  const style = card.kind === "stock" ? `style="--company:${company(card.companyId).color}"` : "";
  return `<span class="market-card kind-${card.kind}" ${style} title="${escapeHtml(cardText(card))}">${card.kind === "hidden" ? "?" : escapeHtml(cardText(card))}${card.knownFromOwnPlacement ? " · 你暗放" : ""}</span>`;
}

function renderStockpiles() {
  const existing = new Map([...E.stockpiles.querySelectorAll(":scope > [data-pile-id]")].map((node) => [node.dataset.pileId, node]));
  view.stockpiles.forEach((pile, index) => {
    const bid = view.bidTokens.find((token) => token.pileId === pile.id);
    const renderKey = JSON.stringify([pile,index,bid,view.phase,bid?.ownerId ? nameOf(bid.ownerId) : ""]);
    let node = existing.get(pile.id);
    if (!node) { node = document.createElement("article"); node.dataset.pileId = pile.id; }
    if (node.dataset.renderKey !== renderKey) {
      const presentationFocus = node.classList.contains("presentation-focus");
      node.dataset.renderKey = renderKey; node.className = `stockpile ${view.phase === "bidding" && !bid ? "open" : ""}`;
      if (presentationFocus) node.classList.add("presentation-focus");
      node.innerHTML = `<header><b>股票堆 ${index + 1}</b><span>${bid ? `${escapeHtml(nameOf(bid.ownerId))} · ${money(bid.amount)}` : "尚无报价"}</span></header><div class="pile-cards">${pile.cards.map(marketCard).join("") || '<span class="empty-pile">已被取得</span>'}</div>`;
    }
    const expected = E.stockpiles.children[index]; if (expected !== node) E.stockpiles.insertBefore(node, expected || null);
    existing.delete(pile.id);
  });
  existing.forEach((node) => node.remove());
}

function renderPlayers() {
  const existing = new Map([...E.players.querySelectorAll(":scope > [data-player-id]")].map((node) => [node.dataset.playerId, node]));
  view.players.forEach((player, index) => {
    const renderKey = JSON.stringify([player,index,view.selfId,view.currentPlayerId,view.firstPlayerId,view.permissions.canKick]);
    let node = existing.get(player.id);
    if (!node) { node = document.createElement("article"); node.dataset.playerId = player.id; }
    if (node.dataset.renderKey !== renderKey) {
      const presentationFocus = node.classList.contains("presentation-focus");
      node.dataset.renderKey = renderKey; node.className = `player-row ${player.id === view.selfId ? "self" : ""} ${player.id === view.currentPlayerId ? "current" : ""} ${!player.connected ? "offline" : ""}`;
      if (presentationFocus) node.classList.add("presentation-focus");
      node.innerHTML = `<div><b>${escapeHtml(player.name)}${player.id === view.selfId ? " · 你" : ""}</b><small>${player.isHost ? "房主 · " : ""}${player.connected ? "在线" : "离线"}${player.id === view.firstPlayerId ? " · 起始玩家" : ""}</small></div><strong>${money(player.cash)}</strong><span>普通 ${player.portfolioCount} · 拆股 ${player.splitPortfolioCount}</span><span class="debt">${player.debts.length ? `欠费 ${player.debts.map(money).join("+")}` : "无欠费"}</span>${view.permissions.canKick && !player.isHost ? `<button class="small" data-kick="${escapeHtml(player.id)}">移出</button>` : ""}`;
      const kick = node.querySelector("[data-kick]"); if (kick) kick.onclick = () => kickPlayer(kick.dataset.kick);
    }
    const expected = E.players.children[index]; if (expected !== node) E.players.insertBefore(node, expected || null);
    existing.delete(player.id);
  });
  existing.forEach((node) => node.remove());
}

function addButton(text, handler, className = "") { const button = document.createElement("button"); button.type = "button"; button.textContent = text; button.className = className; button.onclick = handler; E.actionButtons.append(button); return button; }
function addSelect(options, className = "", draftKey = "") { const select = document.createElement("select"); select.className = className; if (draftKey) select.dataset.actionDraft = draftKey; select.innerHTML = options.map((option) => `<option value="${escapeHtml(String(option.value))}">${escapeHtml(option.label)}</option>`).join(""); E.actionButtons.append(select); return select; }

function actionDraftContext(current = view) {
  if (!current?.selfId) return null;
  let kind = ""; let detail = "";
  if (current.permissions?.canPlaceSupply) { kind = "supply"; detail = current.supplyBatch || 1; }
  else if (current.permissions?.canBid) kind = "bidding";
  else if (current.permissions?.canSell) kind = "selling";
  else if (current.permissions?.canChooseDividend) { kind = "dividend"; detail = current.pendingDividend?.companyId || ""; }
  if (!kind) return null;
  return [room.snapshot().roomCode,current.round,current.currentPlayerId,current.selfId,kind,detail].join(":");
}

function captureActionDraft() {
  const contextKey = actionDraftContext();
  if (!contextKey) return;
  const active = document.activeElement;
  const fields = [...E.actionButtons.querySelectorAll("[data-action-draft]")];
  actionDraft = {
    contextKey,
    values:Object.fromEntries(fields.map((field) => [field.dataset.actionDraft,field.value])),
    focusKey:active?.dataset?.actionDraft || "",
    selectionStart:Number.isInteger(active?.selectionStart) ? active.selectionStart : null,
    selectionEnd:Number.isInteger(active?.selectionEnd) ? active.selectionEnd : null
  };
}

function reconcileActionDraft() {
  if (!actionDraft || actionDraft.contextKey !== actionDraftContext()) actionDraft = null;
}

function restoreActionDraft() {
  if (!actionDraft || actionDraft.contextKey !== actionDraftContext()) return;
  for (const field of E.actionButtons.querySelectorAll("[data-action-draft]")) {
    const saved = actionDraft.values[field.dataset.actionDraft];
    if (saved == null) continue;
    if (field.tagName === "SELECT") {
      if ([...field.options].some((option) => option.value === saved)) field.value = saved;
    } else if (field.type === "number") {
      const value = Number(saved), min = Number(field.min), max = Number(field.max);
      if (Number.isFinite(value)) field.value = String(Math.min(Number.isFinite(max) ? max : value,Math.max(Number.isFinite(min) ? min : value,value)));
    } else field.value = saved;
  }
  const focused = [...E.actionButtons.querySelectorAll("[data-action-draft]")].find((field) => field.dataset.actionDraft === actionDraft.focusKey);
  if (focused) requestAnimationFrame(() => { focused.focus({preventScroll:true}); if (Number.isInteger(actionDraft?.selectionStart) && typeof focused.setSelectionRange === "function") focused.setSelectionRange(actionDraft.selectionStart,actionDraft.selectionEnd); });
}

function renderSupplyAction() {
  const hand = view.supplyHand;
  E.actionTitle.textContent = view.capacity === 2 ? `配置市场供给 · 第 ${view.supplyBatch}/2 批` : "配置市场供给";
  E.actionHint.textContent = "选择一张公开放置、一张暗中放置；两张牌可以进入同一个股票堆。";
  const cardOptions = hand.map((card) => ({ value: card.id, label: cardText(card) }));
  const pileOptions = view.stockpiles.map((pile, index) => ({ value: pile.id, label: `股票堆 ${index + 1}` }));
  const form = document.createElement("div"); form.className = "supply-form"; E.actionButtons.append(form);
  const field = (labelText, options, draftKey) => {
    const label = document.createElement("label"); label.append(document.createTextNode(labelText));
    const select = document.createElement("select"); select.dataset.actionDraft = draftKey; select.innerHTML = options.map((option) => `<option value="${escapeHtml(String(option.value))}">${escapeHtml(option.label)}</option>`).join("");
    label.append(select); form.append(label); return select;
  };
  const upCard = field("公开放置", cardOptions, "supply:up-card"); const upPile = field("明牌放入", pileOptions, "supply:up-pile");
  const downCard = field("暗中放置", [...cardOptions].reverse(), "supply:down-card"); const downPile = field("暗牌放入", pileOptions, "supply:down-pile");
  addButton("确认放入市场", () => { if (upCard.value === downCard.value) return alert("明牌和暗牌不能是同一张。"); submit({ type: "placeSupply", faceUpCardId: upCard.value, faceDownCardId: downCard.value, faceUpPileId: upPile.value, faceDownPileId: downPile.value }); }, "primary");
}

function renderBidAction() {
  const self = view.players.find((player) => player.id === view.selfId);
  E.actionTitle.textContent = "选择股票堆并报价";
  const ownOther = view.bidTokens.filter((token) => token.ownerId === view.selfId && token.pileId);
  const available = self.cash - ownOther.reduce((sum, token) => sum + token.amount, 0);
  E.actionHint.textContent = `可用于本次报价：${money(available)}`;
  const target = document.createElement("select");
  target.dataset.actionDraft = "bid-target";
  target.setAttribute("aria-label", "选择股票堆，查看当前报价");
  E.actionButtons.append(target);
  const groups = new Map();
  view.stockpiles.forEach((pile, index) => {
    if (ownOther.some((token) => token.pileId === pile.id)) return;
    const top = view.bidTokens.find((token) => token.pileId === pile.id);
    const legal = BID_LEVELS.filter((amount) => (!top || amount > top.amount) && amount <= available);
    if (!legal.length) return;
    const label = `股票堆 ${index + 1}`;
    target.add(new Option(`${label} · ${top ? "现价 " + money(top.amount) : "尚无报价"}`, pile.id));
    const group = document.createElement("div");
    group.className = "bid-choice";
    const select = document.createElement("select");
    select.dataset.actionDraft = `bid:${pile.id}`;
    select.setAttribute("aria-label", label + "的出价");
    for (const amount of legal) select.add(new Option(money(amount), String(amount)));
    const button = document.createElement("button");
    button.className = "primary";
    button.textContent = `向${label}报价`;
    button.onclick = () => submit({ type: "placeBid", pileId: pile.id, amount: Number(select.value) });
    group.append(select, button);
    E.actionButtons.append(group);
    groups.set(pile.id, group);
  });
  const showTarget = () => {
    for (const [id, group] of groups) {
      group.hidden = id !== target.value;
      pileAnchor(id)?.classList.toggle("bid-target", id === target.value);
    }
  };
  const savedTarget = actionDraft?.values["bid-target"];
  if (groups.has(savedTarget)) target.value = savedTarget;
  target.onchange = showTarget;
  showTarget();
}

function renderMarketAction() {
  const kind = view.marketAction?.actionType === "boom" ? "上涨 +2" : "下跌 -2";
  E.actionTitle.textContent = `执行${kind}`; E.actionHint.textContent = "行动牌必须在本轮使用，拆股或破产会立即结算。";
  COMPANIES.forEach((item) => addButton(`${item.short} · $${view.stockPrices[item.id]}`, () => submit({ type: "playMarketAction", companyId: item.id }), view.marketAction?.actionType === "boom" ? "rise" : "fall"));
}

function renderSellAction() {
  const self = view.players.find((player) => player.id === view.selfId); E.actionTitle.textContent = "决定卖出股票"; E.actionHint.textContent = "普通股按现价卖出；拆股牌可整张卖两股，或卖一股后转回普通区。";
  const form = document.createElement("div"); form.className = "sell-grid";
  for (const item of COMPANIES) {
    const normal = self.portfolio.filter((card) => card.companyId === item.id).length; const split = self.splitPortfolio.filter((card) => card.companyId === item.id).length;
    if (!normal && !split) continue;
    form.insertAdjacentHTML("beforeend", `<div class="sell-row" data-company="${item.id}"><b>${escapeHtml(item.short)} · $${view.stockPrices[item.id]}</b><label>普通股<input data-kind="normal" data-action-draft="sell:${item.id}:normal" type="number" min="0" max="${normal}" value="0"></label><label>拆股整卖<input data-kind="splitFull" data-action-draft="sell:${item.id}:splitFull" type="number" min="0" max="${split}" value="0"></label><label>拆股卖一半<input data-kind="splitHalf" data-action-draft="sell:${item.id}:splitHalf" type="number" min="0" max="${split}" value="0"></label></div>`);
  }
  E.actionButtons.append(form);
  addButton("确认卖出 / 不卖", () => {
    const sales = [...form.querySelectorAll(".sell-row")].map((row) => ({ companyId: row.dataset.company, ...Object.fromEntries([...row.querySelectorAll("input")].map((input) => [input.dataset.kind, Number(input.value)])) }));
    const invalid = sales.some((sale) => sale.splitFull + sale.splitHalf > self.splitPortfolio.filter((card) => card.companyId === sale.companyId).length);
    if (invalid) return alert("同一公司的“拆股整卖”和“拆股卖一半”合计不能超过持有的拆股牌数。");
    submit({ type: "submitSales", sales });
  }, "primary");
}

function renderDividendAction() {
  const self = view.players.find((player) => player.id === view.selfId); const companyId = view.pendingDividend.companyId; const item = company(companyId);
  const normal = self.portfolio.filter((card) => card.companyId === companyId).length; const split = self.splitPortfolio.filter((card) => card.companyId === companyId).length;
  E.actionTitle.textContent = `${item.name}派发分红`; E.actionHint.textContent = "每公开一股领取 $2K；拆股牌按两股。可少报或不报以隐藏持仓。";
  const normalInput = addSelect(Array.from({ length: normal + 1 }, (_, value) => ({ value, label: `公开普通股 ${value}` })), "", "dividend:normal");
  const splitInput = addSelect(Array.from({ length: split + 1 }, (_, value) => ({ value, label: `公开拆股牌 ${value}` })), "", "dividend:split");
  addButton("确认公开并领取", () => submit({ type: "submitDividend", normal: Number(normalInput.value), split: Number(splitInput.value) }), "primary");
}

function renderActions(memberRole) {
  E.stockpiles.querySelector(".bid-target")?.classList.remove("bid-target");
  E.actionButtons.innerHTML = ""; E.actionHint.textContent = "";
  if (memberRole === "spectator") { E.actionTitle.textContent = view.phase === "lobby" ? "旁观准备阶段" : `旁观行情 · 等待 ${nameOf(view.currentPlayerId)}`; E.actionHint.textContent = "旁观者只能查看公开行情、报价、资金和持股牌数。"; return; }
  if (view.phase === "lobby") { E.actionTitle.textContent = "等待投资人到齐"; E.actionHint.textContent = `当前 ${view.players.length}/${view.capacity} 人，所有玩家在线后由房主开始。`; return; }
  if (view.phase === "ended") { E.actionTitle.textContent = `${view.winnerIds.map(nameOf).join("、")} 获胜`; E.actionHint.textContent = "最终持股、最大股东奖励与净资产已经结算。"; return; }
  if (view.phase === "roundReview") { E.actionTitle.textContent = `第 ${view.round} 轮行情复盘`; E.actionHint.textContent = "查看刚刚公开的内幕组合和股价变化，倒计时结束后进入下一轮。"; return; }
  if (view.permissions.canPlaceSupply) return renderSupplyAction(); if (view.permissions.canBid) return renderBidAction(); if (view.permissions.canPlayMarketAction) return renderMarketAction();
  if (view.permissions.canSell) return renderSellAction(); if (view.permissions.canChooseDividend) return renderDividendAction();
  const phase = { supply: "配置市场供给", bidding: "进行公开竞价", marketAction: "执行市场行动", selling: "决定是否卖股", dividend: "选择是否公开持股领取分红" }[view.phase] || "处理行情";
  E.actionTitle.textContent = `等待 ${nameOf(view.currentPlayerId)} ${phase}`; E.actionHint.textContent = "服务端正在等待当前玩家提交合法选择，超时后会自动推进。";
}

function groupStocks(cards) { return COMPANIES.map((item) => ({ item, count: cards.filter((card) => card.companyId === item.id).length })).filter((entry) => entry.count); }
function renderPrivate(memberRole) {
  setHidden(E.privateZone, memberRole === "spectator"); if (memberRole === "spectator") return;
  const self = view.players.find((player) => player.id === view.selfId); E.myCash.textContent = money(self?.cash);
  E.myInformation.innerHTML = self?.privateInformation.length ? self.privateInformation.map((pair) => infoCard(pair, "我的内幕")).join("") : '<span class="muted">本轮暂无内幕信息</span>';
  const normal = groupStocks(self?.portfolio || []); const split = groupStocks(self?.splitPortfolio || []);
  E.myPortfolio.innerHTML = `<div><small>普通持股</small>${normal.map(({ item, count }) => `<span style="--company:${item.color}">${escapeHtml(item.short)} ×${count}</span>`).join("") || '<em>无</em>'}</div><div><small>拆股持股（每张2股）</small>${split.map(({ item, count }) => `<span style="--company:${item.color}">${escapeHtml(item.short)} ×${count}</span>`).join("") || '<em>无</em>'}</div>`;
}

function renderLog() { E.logList.innerHTML = view.logs.map((entry) => `<div class="log-item">${escapeHtml(entry.text)}</div>`).join("") || '<p class="muted">暂无记录</p>'; }
function renderRoom() {
  setHidden(E.hostTools, !view.permissions.canManage); setHidden(E.startGameButton, !view.permissions.canStart); setHidden(E.restartGameButton, !view.permissions.canRestart); setHidden(E.endGameButton, !view.permissions.canEnd);
  E.startGameButton.disabled = view.players.length !== view.capacity || view.players.some((player) => !player.connected); E.restartGameButton.disabled = view.players.some((player) => !player.connected);
  E.roomPlayerCountSelect.value = String(view.capacity); E.roomPlayerCountSelect.disabled = !view.permissions.canSetCapacity;
}

function renderStatus(model) {
  if (view.phase === "bidding" && E.roomPanel.dataset.phase !== "bidding") {
    E.stockpiles.closest("[data-play-board]").scrollTop = 0;
    E.controlDock.scrollTop = 0;
  }
  E.roomPanel.dataset.phase = view.phase;
  E.controlDock.dataset.role = model.memberRole;
  E.notice.textContent = view.phase === "lobby" ? `等待玩家加入：${view.players.length}/${view.capacity}` : view.phase === "ended" ? "交易结束，最终净资产已经公开" : `第 ${view.round}/${view.totalRounds} 轮 · 当前阶段：${view.phase} · 行动者：${nameOf(view.currentPlayerId)}`;
}

function renderDecision(model) { renderActions(model.memberRole); restoreActionDraft(); }
function renderCountdownPartition() {
  if (view.deadline) countdown.start(view.deadline, PHASE_TIMER_MS[view.phase] || 60000); else { countdown.stop(); E.timerText.textContent = "--"; E.timerBar.style.width = "0"; }
}

partitionRenderer = createGame17PartitionRenderer({
  room: renderRoom,
  status: renderStatus,
  ticker: renderTicker,
  information: renderInformation,
  stockpiles: renderStockpiles,
  players: renderPlayers,
  decision: renderDecision,
  private: (model) => renderPrivate(model.memberRole),
  log: renderLog,
  countdown: renderCountdownPartition
});

function render() {
  if (!view) return;
  const spectatorModel = spectatorUi.render(view);
  partitionRenderer.render(createGame17RenderModel(view, { memberRole: spectatorModel.memberRole, roomCode: room.snapshot().roomCode }));
}

function selectMode(nextMode) { mode = nextMode; setModeVisibility(mode, { hostButton: E.hostModeButton, guestButton: E.guestModeButton, hostSetup: E.hostSetup, guestSetup: E.guestSetup, hostTools: E.hostTools }); }
async function init() {
  roomEntry.bind(); spectatorUi.bind();
  E.roomPlayerCountSelect.onchange = () => submit({ type: "setCapacity", capacity: Number(E.roomPlayerCountSelect.value) }); E.startGameButton.onclick = () => submit({ type: "start" }); E.restartGameButton.onclick = () => submit({ type: "restart" });
  E.endGameButton.onclick = () => { if (confirm("确定结束当前牌局并返回大厅吗？")) submit({ type: "end" }); }; E.toggleLogButton.onclick = () => { const collapsed = E.logList.classList.toggle("collapsed"); E.toggleLogButton.textContent = collapsed ? "展开" : "收起"; };
  selectMode("host"); try { spectatorUi.applyConfig(await room.checkServer()); } catch { /* 创建或加入时显示错误 */ }
}
presentation = createPresentationTimeline({ container: E.presentationEffects, trailPath: E.presentationTrail, announcement: E.presentationAnnouncement, labelElement: E.presentationLabel, textElement: E.presentationText, effectsElement: E.presentationEffects, resolveSource: eventSource, resolveTarget: eventTarget, labelFor: (event) => presentationLabel(event.kind), beforePlay: playPresentationObject, durationMs: 1350, reducedDurationMs: 540, maxQueue: 18, sceneKey: (event) => event.sceneId || event.id, priorityFor: (event) => Number(event.priority) || 0, catchUpThreshold: 2, severeBacklogThreshold: 5, catchUpDurationMs: 620, severeDurationMs: 320, urgentPriority: 4, retainPriority: 3 });
init();
