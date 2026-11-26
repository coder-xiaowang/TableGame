"use strict";

import {
  bindRoomCodeInput,
  cleanPlayerName,
  createAuthoritativeRoomClient,
  createCountdown,
  createLogEntry,
  createPresentationTimeline,
  createRoomEntryController,
  createSessionStore,
  createSpectatorUi,
  escapeHtml,
  renderConnectionStatus,
  renderCountdown,
  serverNow,
  setHidden,
  setModeVisibility
} from "/shared/client/index.js";
import { cardScore } from "./rules.js";
import { createGame9PartitionRenderer, createGame9RenderModel } from "./render-partitions.mjs";

const PROTOCOL_VERSION = 3;
const ACTION_SECONDS = 30;
const $ = (id) => document.getElementById(id);
const E = Object.fromEntries([
  "siteHeader", "connectionStatus", "roomHeaderTools", "setupPanel", "roomPanel", "hostModeButton", "guestModeButton", "hostSetup",
  "guestSetup", "hostNameInput", "guestNameInput", "playerCountSelect", "createRoomButton",
  "joinRoomButton", "roomCodeInput", "joinIntentField", "roomCodeDisplay", "hostTools", "roomPlayerCountSelect",
  "spectatorSettingButton", "seatActionButton",
  "startGameButton", "endGameButton", "playerCountBadge", "playerList", "phaseBadge", "deckCount",
  "notice", "activeCard", "potCount", "timerText", "timerBar", "actionArea", "logList",
  "deckSource", "potArea", "presentationEffects", "presentationTrail", "presentationAnnouncement", "presentationLabel", "presentationText",
  "toggleLogButton", "spectatorPanel", "spectatorCountBadge", "spectatorList", "myArea",
  "myChips", "myCardScore", "myNetScore", "myCards", "resultPanel",
  "winnerText", "scoreTable", "removedCards", "resultActions", "playAgainButton"
].map((id) => [id, $(id)]));

let mode = "host";
let view = null;
let spectatorUi = null;
let presentation = null;
let partitionRenderer = null;
const sessions = createSessionStore({ gameId: "no-thanks" });
const countdown = createCountdown({
  onTick(value) { renderCountdown({ textElement: E.timerText, barElement: E.timerBar }, value); }
});

const room = createAuthoritativeRoomClient({
  protocolVersion: PROTOCOL_VERSION,
  sessionStore: sessions,
  onStatus(status) { renderConnectionStatus(E.connectionStatus, status, room.snapshot().roomCode); },
  handlers: {
    onView(nextView) {
      view = nextView;
      enterRoom();
      render();
      presentation?.sync(nextView.presentationEvents);
    },
    onKicked() {
      spectatorUi?.handleSessionEnded("kicked");
    },
    onRoomExpired() {
      spectatorUi?.handleSessionEnded("room_expired");
    }
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

function enterRoom() {
  setHidden(E.setupPanel, true);
  setHidden(E.roomPanel, false);
  setHidden(E.roomHeaderTools, false);
  E.siteHeader.classList.add("in-room");
  setHidden(E.hostTools, !view?.permissions?.canManage);
  E.roomCodeDisplay.textContent = room.snapshot().roomCode;
}

const roomEntry=createRoomEntryController({room,spectatorUi,elements:{root:E.setupPanel,hostModeButton:E.hostModeButton,guestModeButton:E.guestModeButton,hostSetup:E.hostSetup,guestSetup:E.guestSetup,hostTools:E.hostTools,hostNameInput:E.hostNameInput,guestNameInput:E.guestNameInput,roomCodeInput:E.roomCodeInput,createRoomButton:E.createRoomButton,joinRoomButton:E.joinRoomButton,connectionStatus:E.connectionStatus},buildCreatePayload:()=>({capacity:Number(E.playerCountSelect.value)}),formatError:(kind,error)=>kind==="create"?`创建房间失败：${error.message}\n请确认已通过 node game9/signal-server.js 启动。`:`加入房间失败：${error.message}`});

async function createGameRoom() {
  const name = cleanPlayerName(E.hostNameInput.value, "房主");
  E.createRoomButton.disabled = true;
  try {
    await room.createRoom({ name, capacity: Number(E.playerCountSelect.value) });
  } catch (error) {
    alert(`创建房间失败：${error.message}\n请确认已通过 node game9/signal-server.js 启动。`);
  } finally {
    E.createRoomButton.disabled = false;
  }
}

async function joinGameRoom() {
  E.joinRoomButton.disabled = true;
  try {
    const result = await room.joinRoom({
      code: E.roomCodeInput.value,
      name: E.guestNameInput.value,
      intent: spectatorUi.getJoinIntent()
    });
    E.connectionStatus.textContent = spectatorUi.handleJoinResult(result).statusText;
  } catch (error) {
    alert(`加入房间失败：${error.message}`);
  } finally {
    E.joinRoomButton.disabled = false;
  }
}

async function kickPlayer(playerId, playerName) {
  if (view?.phase !== "lobby") return alert("游戏开始后不能移出正式玩家。");
  if (!confirm(`确定将 ${playerName} 移出房间吗？`)) return;
  try {
    await room.kick(playerId);
  } catch (error) {
    alert(`移出失败：${error.message}`);
  }
}

function changeCapacity() {
  if (!view || view.phase !== "lobby") return;
  submit({ type: "setCapacity", capacity: Number(E.roomPlayerCountSelect.value) });
}

function startGame() {
  submit({ type: "start" });
}

function endGameEarly() {
  if (!view || view.phase !== "playing" || !confirm("确定结束当前游戏并返回大厅吗？")) return;
  submit({ type: "end" });
}

function playAgain() {
  if (!view || view.phase !== "ended" || !view.permissions?.canRestart) return;
  submit({ type: "restart" });
}

function submit(action) {
  Promise.resolve(room.submitAction(action)).catch((error) => {
    E.connectionStatus.textContent = `操作发送失败：${error.message}`;
    render();
    alert(error.message);
  });
}

function cardRunsHtml(cards) {
  if (!cards?.length) return '<p class="muted">还没有拿牌</p>';
  const runs = [];
  for (const card of [...cards].sort((a, b) => a - b)) {
    const last = runs.at(-1);
    if (last && card === last.at(-1) + 1) last.push(card);
    else runs.push([card]);
  }
  return runs.map((run) => `<div class="card-run">${run.map((card, index) =>
    `<span class="small-number-card ${index ? "linked" : "scoring"}">${card}</span>`).join("")}</div>`).join("");
}

function createVisualTestView(playerCount) {
  const distributions = playerCount === 7
    ? [8, 4, 3, 3, 2, 2, 2]
    : [9, 4, 3, 3, 3, 2];
  const cardPool = [3, 4, 5, 8, 9, 10, 14, 18, 19, 22, 23, 24, 27, 29, 30, 31, 33, 35, 6, 12, 16, 20, 25, 28];
  let offset = 0;
  const players = distributions.map((count, index) => {
    const cards = cardPool.slice(offset, offset + count).sort((a, b) => a - b);
    offset += count;
    return {
      id: `visual_${index}`,
      name: ["长名字玩家测试", "薄荷汽水", "橘子船长", "不拿二十五", "连接大师", "筹码收藏家", "最后一位玩家"][index],
      isHost: index === 0,
      connected: index !== playerCount - 2,
      cards,
      cardScore: cardScore(cards),
      chips: index === 0 ? 7 : null,
      finalScore: null
    };
  });
  return {
    selfId: players[0].id,
    phase: "playing",
    capacity: playerCount,
    currentIndex: 2,
    activeCard: 26,
    pot: 6,
    deckCount: 7,
    deadline: serverNow() + ACTION_SECONDS * 1000,
    winners: [],
    removed: [],
    permissions: { canManage: false, canKick: false, canStart: false, canEnd: false },
    roomRole: "player",
    spectators: [
      { id: "visual_watch_1", name: "围观群众", connected: true },
      { id: "visual_watch_2", name: "暂时离线的旁观者", connected: false }
    ],
    spectatorCount: 2,
    spectatorLimit: 10,
    allowSpectators: true,
    logs: [
      createLogEntry("橘子船长说了“不，谢谢”，牌上增加 1 枚筹码"),
      createLogEntry("薄荷汽水拿下 21，并获得 4 枚筹码"),
      createLogEntry("这是一组用于检查 6–7 人布局的模拟数据")
    ],
    players
  };
}

function renderRoomShell(model) {
  const { view: current } = model;
  E.roomCodeDisplay.textContent = model.roomCode;
  E.roomPlayerCountSelect.value = String(current.capacity);
  E.roomPlayerCountSelect.disabled = current.phase !== "lobby" || !current.permissions?.canManage;
  E.playerCountBadge.textContent = `${current.players.length} / ${current.capacity}`;
  E.startGameButton.disabled = current.phase !== "lobby"
    || current.players.length !== current.capacity
    || current.players.some((player) => !player.connected);
  setHidden(E.startGameButton, !current.permissions?.canStart);
  setHidden(E.endGameButton, !current.permissions?.canEnd);
}

function renderTable(model) {
  const { view: current } = model;
  E.phaseBadge.textContent = { lobby: "准备阶段", playing: "游戏进行中", ended: "结算完成" }[current.phase];
  E.deckCount.textContent = String(current.deckCount);
  E.potCount.textContent = String(current.pot);
  E.activeCard.textContent = current.activeCard ?? "—";
  E.activeCard.classList.toggle("empty", current.activeCard == null);
  E.activeCard.style.setProperty("--tilt", `${((Number(current.activeCard) || 0) % 7) - 3}deg`);
}

function renderPlayers(model) {
  const { view: current } = model;
  const existingPlayers = new Map(
    [...E.playerList.querySelectorAll("[data-player-id]")].map((element) => [element.dataset.playerId, element])
  );
  const retainedIds = new Set();
  current.players.forEach((player, index) => {
    let article = existingPlayers.get(String(player.id));
    if (!article) {
      article = document.createElement("article");
      article.dataset.playerId = String(player.id);
      article.innerHTML = `
        <div><span class="status-dot"></span><b data-player-name></b><em data-host-badge>房主</em></div>
        <div class="player-stats"><span data-card-count></span><span data-card-score></span><span data-player-chips></span></div>
        <div class="public-card-runs" data-public-cards></div>
        <button type="button" data-kick-player>移出</button>`;
    }
    retainedIds.add(String(player.id));
    article.className = `player-item ${player.id === current.selfId ? "player-self" : ""} ${!player.connected ? "player-offline" : ""} ${current.phase === "playing" && index === current.currentIndex ? "player-current" : ""}`;
    article.querySelector("[data-player-name]").textContent = player.name;
    setHidden(article.querySelector("[data-host-badge]"), !player.isHost);
    article.querySelector("[data-card-count]").textContent = `${player.cards.length} 张牌`;
    article.querySelector("[data-card-score]").textContent = `牌面 ${player.cardScore}`;
    article.querySelector("[data-player-chips]").textContent = player.chips == null ? "筹码 ?" : `筹码 ${player.chips}`;
    const publicCards = article.querySelector("[data-public-cards]");
    publicCards.setAttribute("aria-label", `${player.name}的公开数字牌`);
    const cardsKey = JSON.stringify(player.cards);
    if (publicCards.dataset.cardsKey !== cardsKey) {
      publicCards.innerHTML = cardRunsHtml(player.cards);
      publicCards.dataset.cardsKey = cardsKey;
    }
    const kickButton = article.querySelector("[data-kick-player]");
    kickButton.dataset.kickPlayer = String(player.id);
    setHidden(kickButton, !current.permissions?.canKick || player.isHost);
    const currentAtIndex = E.playerList.children[index];
    if (currentAtIndex !== article) E.playerList.insertBefore(article, currentAtIndex || null);
  });
  [...E.playerList.querySelectorAll("[data-player-id]")].forEach((element) => {
    if (!retainedIds.has(element.dataset.playerId)) element.remove();
  });
}

function renderDecision(model) {
  E.actionArea.innerHTML = "";
  if (model.myTurn) {
    E.actionArea.innerHTML = `
      <button type="button" class="take-action" data-action="take"><span></span><small></small></button>
      <button type="button" class="pass-action" data-action="pass"><span>不，谢谢！</span><small></small></button>`;
  } else if (model.memberRole === "spectator") {
    E.actionArea.innerHTML = '<p class="spectator-action-note">旁观模式不会显示游戏操作按钮</p>';
  }
}

function renderDecisionFacts(model) {
  const { view: current, memberRole, me, myTurn } = model;
  if (memberRole === "spectator" && current.phase === "lobby") E.notice.textContent = "你正在旁观准备阶段，可在有空位时主动进入玩家席";
  else if (current.phase === "lobby") E.notice.textContent = `等待 ${current.capacity} 位玩家到齐后，由房主开始游戏`;
  else if (current.phase === "ended") E.notice.textContent = "所有数字牌都已被拿走，本局结算完成";
  else if (myTurn) E.notice.textContent = me.chips > 0 ? "轮到你：拿下数字牌，或支付一枚筹码拒绝" : "你没有筹码，只能拿下这张牌";
  else E.notice.textContent = `${memberRole === "spectator" ? "旁观中 · " : ""}等待 ${model.current?.name} 决定是否接受 ${current.activeCard}`;

  const take = E.actionArea.querySelector('[data-action="take"]');
  if (take) {
    take.querySelector("span").textContent = `拿下 ${current.activeCard}`;
    take.querySelector("small").textContent = current.pot ? `同时获得 ${current.pot} 枚筹码` : "接受这张数字牌";
  }
  const pass = E.actionArea.querySelector('[data-action="pass"]');
  if (pass) {
    pass.disabled = (me?.chips ?? 0) <= 0;
    pass.querySelector("small").textContent = me.chips > 0 ? `你有 ${me.chips} 枚 · 支付 1 枚` : "你有 0 枚 · 无法拒绝";
  }
}

function renderPrivateArea(model) {
  const { memberRole, me, view: current } = model;
  setHidden(E.myArea, memberRole === "spectator");
  E.myChips.textContent = me?.chips ?? "?";
  E.myCardScore.textContent = String(me?.cardScore ?? 0);
  E.myNetScore.textContent = me?.chips == null ? "?" : String(me.cardScore - me.chips);
  E.myCards.innerHTML = cardRunsHtml(me?.cards);
  const ownChipLabel = [...E.playerList.querySelectorAll("[data-player-id]")]
    .find((element) => element.dataset.playerId === String(current.selfId))
    ?.querySelector("[data-player-chips]");
  if (ownChipLabel) ownChipLabel.textContent = me?.chips == null ? "筹码 ?" : `筹码 ${me.chips}`;
}

function renderLog(model) {
  E.logList.innerHTML = model.view.logs.map((entry) => `<p>${escapeHtml(entry.text)}</p>`).join("") || '<p class="muted">暂无记录</p>';
}

function renderCountdownPartition(model) {
  const current = model.view;
  if (current.phase === "playing" && current.deadline) countdown.start(current.deadline, ACTION_SECONDS * 1000);
  else {
    countdown.stop();
    E.timerText.textContent = "--";
    E.timerBar.style.width = "0";
  }
}

function renderResult(model) {
  const current = model.view;
  setHidden(E.resultPanel, current.phase !== "ended");
  setHidden(E.resultActions, !current.permissions?.canRestart);
  if (current.phase !== "ended") return;
  const winners = current.winners.map((id) => current.players.find((player) => player.id === id)?.name).join("、");
  E.winnerText.textContent = `${winners} 获胜！`;
  E.scoreTable.innerHTML = [...current.players].sort((a, b) => a.finalScore - b.finalScore).map((player, index) => `
    <div class="score-row ${current.winners.includes(player.id) ? "winner" : ""}">
      <b>${index + 1}</b><span>${escapeHtml(player.name)}</span>
      <span>牌面 ${player.cardScore}</span><span>筹码 −${player.chips}</span><strong>${player.finalScore} 分</strong>
    </div>`).join("");
  E.removedCards.innerHTML = current.removed.map((card) => `<span>${card}</span>`).join("");
}

function render() {
  if (!view) return;
  const spectatorModel = spectatorUi.render(view);
  const model = createGame9RenderModel(view, {
    memberRole: spectatorModel.memberRole,
    roomCode: room.snapshot().roomCode
  });
  partitionRenderer ??= createGame9PartitionRenderer({
    room: renderRoomShell,
    table: renderTable,
    players: renderPlayers,
    decision: renderDecision,
    decisionFacts: renderDecisionFacts,
    privateArea: renderPrivateArea,
    log: renderLog,
    countdown: renderCountdownPartition,
    result: renderResult
  });
  partitionRenderer.render(model);
}

function playerElement(playerId) {
  if (!playerId) return null;
  return [...E.playerList.querySelectorAll("[data-player-id]")]
    .find((element) => element.dataset.playerId === String(playerId)) || null;
}

function presentationSource(event) {
  if (["game-start", "card-revealed"].includes(event.kind)) return E.deckSource;
  if (event.kind === "card-taken") return E.activeCard;
  return playerElement(event.actorId) || E.activeCard;
}

function presentationTarget(event) {
  if (["game-start", "card-revealed"].includes(event.kind)) return E.activeCard;
  if (event.kind === "chip-paid") return E.potArea;
  if (event.kind === "card-taken") return playerElement(event.actorId) || E.myArea;
  if (event.kind === "game-result") return playerElement(event.actorId) || E.activeCard;
  return E.activeCard;
}

function presentationLabel(kind) {
  return ({
    "game-start": "新局开场",
    "chip-paid": "不，谢谢！",
    "card-taken": "收下数字牌",
    "card-revealed": "翻开新牌",
    "game-result": "本局结算"
  })[kind] || "牌桌动态";
}

function pointInStage(element) {
  if (!element || !E.presentationEffects) return null;
  const rect = element.getBoundingClientRect();
  const stage = E.presentationEffects.getBoundingClientRect();
  return { x: rect.left + rect.width / 2 - stage.left, y: rect.top + rect.height / 2 - stage.top };
}

function playPresentationObject(event) {
  const source = presentationSource(event);
  const target = presentationTarget(event);
  source?.classList.add("presentation-source");
  target?.classList.add("presentation-target");
  const token = document.createElement("span");
  token.className = `presentation-token presentation-token-${event.kind}`;
  token.textContent = event.kind === "chip-paid" ? "●" : event.kind === "game-result" ? "★" : String(event.cardValue ?? "→");
  const from = pointInStage(source);
  const to = pointInStage(target);
  if (from && to) {
    token.style.setProperty("--from-x", `${from.x}px`);
    token.style.setProperty("--from-y", `${from.y}px`);
    token.style.setProperty("--to-x", `${to.x}px`);
    token.style.setProperty("--to-y", `${to.y}px`);
  }
  E.presentationEffects?.append(token);
  return () => {
    source?.classList.remove("presentation-source");
    target?.classList.remove("presentation-target");
    token.remove();
  };
}

presentation = createPresentationTimeline({
  container: E.presentationEffects,
  trailPath: E.presentationTrail,
  announcement: E.presentationAnnouncement,
  labelElement: E.presentationLabel,
  textElement: E.presentationText,
  effectsElement: E.presentationEffects,
  resolveSource: presentationSource,
  resolveTarget: presentationTarget,
  labelFor: (event) => presentationLabel(event.kind),
  beforePlay: playPresentationObject,
  durationMs: 1400,
  reducedDurationMs: 560,
  maxQueue: 16,
  sceneKey: (event) => event.sceneId || event.id,
  priorityFor: (event) => Number(event.priority) || 0,
  catchUpThreshold: 2,
  severeBacklogThreshold: 5,
  catchUpDurationMs: 620,
  severeDurationMs: 320,
  urgentPriority: 4,
  retainPriority: 3
});

async function init() {
  roomEntry.bind();
  spectatorUi.bind();
  E.playerList.onclick = (event) => {
    const button = event.target.closest?.("[data-kick-player]");
    if (!button) return;
    const player = view?.players.find((item) => item.id === button.dataset.kickPlayer);
    if (player) kickPlayer(player.id, player.name);
  };
  E.actionArea.onclick = (event) => {
    const button = event.target.closest?.("[data-action]");
    if (!button || !E.actionArea.contains(button)) return;
    if (button.dataset.action === "take") submit({ type: "take" });
    if (button.dataset.action === "pass") submit({ type: "pass" });
  };
  E.roomPlayerCountSelect.onchange = changeCapacity;
  E.startGameButton.onclick = startGame;
  E.endGameButton.onclick = endGameEarly;
  E.playAgainButton.onclick = playAgain;
  E.toggleLogButton.onclick = () => {
    E.logList.classList.toggle("collapsed");
    E.toggleLogButton.textContent = E.logList.classList.contains("collapsed") ? "展开" : "收起";
  };
  setModeVisibility(mode, E);
  const visualPlayers = Number(new URLSearchParams(location.search).get("visualTest"));
  if (visualPlayers === 6 || visualPlayers === 7) {
    mode = "guest";
    view = createVisualTestView(visualPlayers);
    enterRoom();
    E.roomCodeDisplay.textContent = `TEST-${visualPlayers}`;
    render();
    E.roomCodeDisplay.textContent = `TEST-${visualPlayers}`;
    return;
  }
  try {
    spectatorUi.applyConfig(await room.checkServer());
  }
  catch { E.connectionStatus.title = "请运行 node game9/signal-server.js"; }
}

init();
