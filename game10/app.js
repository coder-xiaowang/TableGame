"use strict";

import {
  bindRoomCodeInput, cleanPlayerName, createAuthoritativeRoomClient, createCountdown, createRoomEntryController,
  createPresentationTimeline, createSessionStore, createSpectatorUi, escapeHtml, renderConnectionStatus,
  renderCountdown, setHidden, setModeVisibility
} from "/shared/client/index.js";
import { COLUMN_LENGTHS } from "./rules.js";
import { createGame10PartitionRenderer, createGame10RenderModel } from "./render-partitions.mjs";

const PROTOCOL_VERSION = 3;
const ACTION_SECONDS = 30;
const $ = (id) => document.getElementById(id);
const E = Object.fromEntries(["siteHeader", "connectionStatus", "roomHeaderTools", "setupPanel", "roomPanel", "hostModeButton", "guestModeButton", "hostSetup", "guestSetup", "hostNameInput", "guestNameInput", "playerCountSelect", "createRoomButton", "joinRoomButton", "roomCodeInput", "joinIntentField", "roomCodeDisplay", "hostTools", "roomPlayerCountSelect", "spectatorSettingButton", "seatActionButton", "spectatorPanel", "spectatorCountBadge", "spectatorList", "startGameButton", "endGameButton", "playerCountBadge", "playerList", "phaseBadge", "turnLabel", "notice", "board", "timerText", "timerBar", "diceArea", "diceHint", "actionArea", "toggleLogButton", "logList", "resultPanel", "winnerText", "resultList", "resultActions", "playAgainButton", "presentationEffects", "presentationTrail", "presentationAnnouncement", "presentationLabel", "presentationText"].map((id) => [id, $(id)]));

let mode = "host";
let view = null;
let spectatorUi = null;
let presentation = null;
let partitionRenderer = null;
const sessions = createSessionStore({ gameId: "cant-stop" });
const countdown = createCountdown({ onTick(value) { renderCountdown({ textElement: E.timerText, barElement: E.timerBar }, value); } });
const room = createAuthoritativeRoomClient({
  protocolVersion: PROTOCOL_VERSION,
  sessionStore: sessions,
  onStatus(status) { renderConnectionStatus(E.connectionStatus, status, room.snapshot().roomCode); },
  handlers: {
    onView(nextView) { view = nextView; enterRoom(); render(); presentation?.sync(nextView.presentationEvents?.filter(event => !["roll-start", "dice-settled"].includes(event.kind))); },
    onKicked() { spectatorUi?.handleSessionEnded("kicked"); },
    onRoomExpired() { spectatorUi?.handleSessionEnded("room_expired"); }
  }
});

spectatorUi = createSpectatorUi({
  room,
  getView: () => view,
  elements: {
    joinIntentField: E.joinIntentField, seatActionButton: E.seatActionButton, spectatorSettingButton: E.spectatorSettingButton,
    spectatorPanel: E.spectatorPanel, spectatorCountBadge: E.spectatorCountBadge, spectatorList: E.spectatorList
  },
  notify: (message) => alert(message),
  confirmAction: (message) => confirm(message),
  onSessionEnded: () => location.reload()
});

function currentView() { return view; }
function isHost() { return room.snapshot().role === "host"; }
function renderEntryMode() { setModeVisibility(mode, { ...E, hostButton: E.hostModeButton, guestButton: E.guestModeButton }); }
function enterRoom() { setHidden(E.setupPanel, true); setHidden(E.roomPanel, false); setHidden(E.roomHeaderTools, false); E.siteHeader.classList.add("in-room"); setHidden(E.hostTools, !isHost()); E.roomCodeDisplay.textContent = room.snapshot().roomCode; }

const roomEntry=createRoomEntryController({room,spectatorUi,elements:{root:E.setupPanel,hostModeButton:E.hostModeButton,guestModeButton:E.guestModeButton,hostSetup:E.hostSetup,guestSetup:E.guestSetup,hostTools:E.hostTools,hostNameInput:E.hostNameInput,guestNameInput:E.guestNameInput,roomCodeInput:E.roomCodeInput,createRoomButton:E.createRoomButton,joinRoomButton:E.joinRoomButton,connectionStatus:E.connectionStatus},buildCreatePayload:()=>({capacity:Number(E.playerCountSelect.value)}),formatError:(kind,error)=>kind==="create"?`创建房间失败：${error.message}\n请确认已通过 node game10/signal-server.js 启动。`:`加入房间失败：${error.message}`});

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
  const routes = Object.entries(COLUMN_LENGTHS).map(([key, length]) => {
    const column = Number(key); const owner = view.players.find((player) => player.id === view.closed[column]);
    const camp = view.players[view.currentIndex]?.progress[column] || 0;
    const top = view.phase === "playing" && !owner ? view.turnProgress[column] || 0 : 0;
    const cells = Array.from({ length }, (_, index) => {
      const step = length - index;
      const drift = Math.round(Math.sin((column * 1.7 + step) * 1.35) * 7);
      const footprint = step > camp && step <= top;
      return `<div class="route-cell${footprint ? " trail-step" : ""}" data-step="${step}" style="--drift:${drift}px;--tilt:${(drift / 2).toFixed(1)}deg;--step:${index}">${markerHtml(view, column, step)}</div>`;
    }).join("");
    const summit = owner
      ? `<span class="claim-flag" style="--flag:${owner.color}" title="${escapeHtml(owner.name)}占领"><i></i></span>`
      : '<span class="summit-peak">◆</span>';
    const label = `${column} 号路线${top > camp ? `，本回合 ${top - camp} 步尚未扎营` : ""}`;
    return `<div class="route ${owner ? "claimed" : ""}" role="group" aria-label="${label}" data-column="${column}" style="--route:${length};--owner:${owner?.color || "transparent"}"><div class="summit">${summit}</div>${cells}<b><span>${column}</span></b></div>`;
  });
  let sceneryElement = E.board.querySelector(":scope > .mountain-scenery");
  if (!sceneryElement) {
    E.board.insertAdjacentHTML("afterbegin", scenery);
    sceneryElement = E.board.querySelector(":scope > .mountain-scenery");
  }
  const existing = new Map([...E.board.querySelectorAll(":scope > .route")]
    .map((element) => [Number(element.dataset.column), element]));
  routes.forEach((markup, index) => {
    const column = Number(Object.keys(COLUMN_LENGTHS)[index]);
    const contentKey = JSON.stringify([
      view.closed[column] || null,
      view.phase === "playing" ? view.turnProgress[column] || 0 : 0,
      view.turnProgress[column] ? [view.players[view.currentIndex]?.id,view.players[view.currentIndex]?.name,view.players[view.currentIndex]?.color] : null,
      view.players.map((player) => [player.id, player.name, player.color, player.progress[column] || 0])
    ]);
    let route = existing.get(column);
    if (!route || route.dataset.contentKey !== contentKey) {
      const template = document.createElement("template");
      template.innerHTML = markup;
      const replacement = template.content.firstElementChild;
      replacement.dataset.contentKey = contentKey;
      if (route) route.replaceWith(replacement);
      else E.board.append(replacement);
      route = replacement;
    }
    const expected = E.board.children[index + 1];
    if (expected !== route) E.board.insertBefore(route, expected || null);
    existing.delete(column);
  });
  existing.forEach((element) => element.remove());
}
function renderRoom(model) {
  const { view, roomCode } = model;
  E.roomCodeDisplay.textContent = roomCode;
  E.roomPlayerCountSelect.value = String(view.capacity);
  E.roomPlayerCountSelect.disabled = !view.permissions?.canManage || view.phase !== "lobby";
  setHidden(E.hostTools, !view.permissions?.canManage);
  E.playerCountBadge.textContent = `${view.players.length} / ${view.capacity}`;
  E.startGameButton.disabled = !view.permissions?.canStart || view.players.length !== view.capacity || view.players.some((player) => !player.connected);
  setHidden(E.startGameButton, !view.permissions?.canStart);
  setHidden(E.endGameButton, !view.permissions?.canEnd && !view.permissions?.canRestart);
  E.endGameButton.textContent = view.phase === "ended" ? "返回大厅" : "结束本局";
}

function renderStatus(model) {
  const { view, current, memberRole, decisionContext } = model;
  E.phaseBadge.textContent = { lobby:"准备阶段", playing:"攀登中", ended:"登顶完成" }[view.phase];
  E.turnLabel.textContent = view.phase === "playing" ? `${current?.name || "玩家"} 的回合` : view.phase === "ended" ? "游戏结束" : "等待开始";
  if (view.phase === "lobby") E.notice.textContent = memberRole === "spectator" ? "你正在旁观准备阶段，可在有空位时进入玩家席。" : `等待 ${view.capacity} 位玩家到齐后，由房主开始游戏`;
  else if (view.phase === "ended") E.notice.textContent = "三座峰顶已经被同一位玩家占领";
  else if (view.turnStage === "preparing") E.notice.textContent = `${current.name} 正在将骰子撒入投掷盘……`;
  else if (view.turnStage === "rolling") E.notice.textContent = `${current.name} 的骰子正在投掷盘中碰撞翻滚……`;
  else if (view.turnStage === "settled") E.notice.textContent = `骰子已经停稳：${view.dice.join("、")}`;
  else if (view.turnStage === "decision") E.notice.textContent = "脚印是这回合走过的步数，扎营就能保住。";
  else if (!decisionContext.myTurn) E.notice.textContent = `等待 ${current.name} ${view.turnStage === "choose" ? "选择骰子组合" : view.turnStage === "decision" ? "继续攀登或扎营" : "掷骰子"}`;
  else E.notice.textContent = { roll:"轮到你了，掷出四颗骰子开始攀登", choose:"选择一种可用的骰子组合" }[view.turnStage] || "";
}

function renderPlayers(model) {
  const { view } = model;
  const existing = new Map([...E.playerList.querySelectorAll(":scope > [data-player-anchor]")]
    .map((element) => [element.dataset.playerAnchor, element]));
  view.players.forEach((player, index) => {
    const renderKey = JSON.stringify([player.name,player.isHost,player.connected,player.color,player.claimed,index === view.currentIndex && view.phase === "playing",player.id === view.selfId,view.permissions?.canKick]);
    let element = existing.get(player.id);
    if (!element) {
      element = document.createElement("article");
      element.dataset.playerAnchor = player.id;
    }
    if (element.dataset.renderKey !== renderKey) {
      element.dataset.renderKey = renderKey;
      element.className = `player-item ${player.id === view.selfId ? "player-self" : ""} ${index === view.currentIndex && view.phase === "playing" ? "player-current" : ""} ${!player.connected ? "player-offline" : ""}`;
      element.style.setProperty("--player", player.color);
      element.innerHTML = `<div><i class="player-color"></i><b>${escapeHtml(player.name)}</b>${player.isHost ? "<em>房主</em>" : ""}</div><span>已占领 ${player.claimed.length} / 3</span><small>${player.claimed.length ? `${player.claimed.join("、")} 号路线` : "尚未占领路线"}</small>${view.permissions?.canKick && !player.isHost ? `<button data-kick="${escapeHtml(player.id)}">移出</button>` : ""}`;
      const kickButton = element.querySelector("[data-kick]");
      if (kickButton) kickButton.onclick = () => kickPlayer(kickButton.dataset.kick);
    }
    const expected = E.playerList.children[index];
    if (expected !== element) E.playerList.insertBefore(element, expected || null);
    existing.delete(player.id);
  });
  existing.forEach((element) => element.remove());
}

// Positions in a 3 × 3 face, from the top left.
const PIPS = [[], [5], [1,9], [1,5,9], [1,3,7,9], [1,3,5,7,9], [1,3,4,6,7,9]];

function renderDice({ view, roomCode }) {
  const tray = E.diceArea;
  const liveRoll = tray.dataset.room === roomCode && Number(tray.dataset.roll) < view.rollId;
  tray.dataset.room = roomCode;
  tray.dataset.roll = view.rollId;
  const values = view.dice.length === 4 ? view.dice : [0,0,0,0];
  tray.setAttribute("aria-label", values[0] ? `骰面 ${values.join("、")}` : "等待掷骰");
  E.diceHint.textContent = view.lastBust || "";
  tray.replaceChildren(...values.map((value, index) => {
    const die = document.createElement("span");
    die.className = value ? (liveRoll ? "die landing" : "die") : "die empty";
    die.setAttribute("aria-hidden", "true");
    die.style.setProperty("--index", index);
    for (const position of PIPS[value]) {
      const pip = document.createElement("i");
      pip.style.gridArea = `${Math.ceil(position / 3)} / ${(position - 1) % 3 + 1}`;
      die.append(pip);
    }
    return die;
  }));
}

function routeChoice(option) {
  const routes = [...new Set(option.moves)];
  const distance = routes.length > 1 ? "各走 1 步" : `走 ${option.moves.length} 步`;
  return `<button class="choice-action" data-choice="${option.key}"><span>${routes.join("、")} 号线</span><small>${distance}</small></button>`;
}

function renderDecision(model) {
  const { view, memberRole, decisionContext } = model;
  E.actionArea.innerHTML = "";
  if (decisionContext.myTurn && view.turnStage === "roll") E.actionArea.innerHTML = '<button class="primary big-action" data-action="roll">掷骰子</button>';
  if (decisionContext.myTurn && view.turnStage === "choose") E.actionArea.innerHTML = view.options.map(routeChoice).join("");
  if (decisionContext.myTurn && view.turnStage === "decision") E.actionArea.innerHTML = '<button class="primary big-action" data-action="roll">继续掷骰</button><button class="stop-action" data-action="stop">扎营收手</button>';
  if (memberRole === "spectator" && view.phase === "playing") E.actionArea.innerHTML = '<p class="muted spectator-action-note">旁观模式可查看公开骰子、路线和攀登进度，但不能投骰或选择路线。</p>';
  E.actionArea.querySelectorAll("[data-action]").forEach((button)=>{button.onclick=()=>submit({type:button.dataset.action});});
  E.actionArea.querySelectorAll("[data-choice]").forEach((button)=>{button.onclick=()=>submit({type:"choose",key:button.dataset.choice});});
}

function renderLog(model) {
  E.logList.innerHTML = model.view.logs.map((entry)=>`<p>${escapeHtml(entry.text)}</p>`).join("") || '<p class="muted">暂无记录</p>';
}
function renderTimer(model) {
  const { view } = model;
  if (view.phase === "playing" && view.deadline) countdown.start(view.deadline,ACTION_SECONDS*1000);
  else { countdown.stop(); E.timerText.textContent="--"; E.timerBar.style.width="0"; }
}
function renderResult(model) {
  const { view } = model;
  setHidden(E.resultPanel,view.phase !== "ended"); setHidden(E.resultActions,!view.permissions?.canRestart);
  if (view.phase !== "ended") return;
  const winner=view.players.find((player)=>player.id === view.winnerId);
  E.winnerText.textContent=`${winner?.name || "玩家"} 征服了山峰！`;
  E.resultList.innerHTML=view.players.map((player)=>`<p><i style="background:${player.color}"></i><b>${escapeHtml(player.name)}</b><span>${player.claimed.length} 条路线</span></p>`).join("");
}

partitionRenderer=createGame10PartitionRenderer({
  room:renderRoom,status:renderStatus,players:renderPlayers,
  board:(model)=>renderBoard(model.view),dice:renderDice,
  decision:renderDecision,log:renderLog,countdown:renderTimer,result:renderResult
});

function render() {
  const view=currentView(); if(!view)return;
  const spectatorModel=spectatorUi.render(view);
  partitionRenderer.render(createGame10RenderModel(view,{memberRole:spectatorModel.memberRole,roomCode:room.snapshot().roomCode}));
}

function playerAnchor(playerId) {
  return [...E.playerList.querySelectorAll("[data-player-anchor]")]
    .find((element) => element.dataset.playerAnchor === String(playerId)) || null;
}
function routeAnchor(column) { return E.board.querySelector(`[data-column="${Number(column)}"]`); }
function presentationSource(event) {
  if (event.kind === "route-chosen") return E.diceArea;
  if (event.kind === "turn-busted") return routeAnchor(event.columns?.[0]) || E.board;
  return playerAnchor(event.actorId) || E.notice;
}
function presentationTarget(event) {
  if (["roll-start", "dice-settled"].includes(event.kind)) return E.diceArea;
  if (["route-chosen", "summit-claimed", "turn-stopped"].includes(event.kind)) return routeAnchor(event.columns?.[0]) || E.board;
  return playerAnchor(event.actorId) || E.notice;
}
function presentationLabel(kind) {
  return ({
    "game-start":"开始攀登", "turn-start":"回合交接", "roll-start":"投掷骰子",
    "dice-settled":"骰子停稳", "route-chosen":"继续攀登", "turn-stopped":"扎营保存",
    "turn-busted":"冒险爆掉", "summit-claimed":"占领峰顶", "game-result":"登顶胜利"
  })[kind] || "山间动态";
}
function presentationPoint(element) {
  if (!element || !E.presentationEffects) return null;
  const rect = element.getBoundingClientRect(); const stage = E.presentationEffects.getBoundingClientRect();
  return { x:rect.left + rect.width / 2 - stage.left, y:rect.top + rect.height / 2 - stage.top };
}
function playPresentationEvent(event) {
  const source = presentationSource(event); const target = presentationTarget(event);
  source?.classList.add("presentation-source"); target?.classList.add("presentation-target");
  const routes = (event.columns || []).map(routeAnchor).filter(Boolean);
  const retreat = [];
  if (event.kind === "turn-busted") {
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const {column, camp, top} of event.lostTrails || []) {
        const route = routeAnchor(column);
        if (!route || view.closed[column] || view.turnProgress[column]) continue;
        for (const cell of route.querySelectorAll(".route-cell")) {
          const step = Number(cell.dataset.step);
          if (step <= camp || step > top) continue;
          cell.style.setProperty("--retreat-delay", `${(top - step) * Math.min(80, 500 / (top - camp))}ms`);
          cell.classList.add("trail-retreat");
          retreat.push(cell);
        }
      }
    }
  } else {
    routes.forEach((element) => element.classList.add("presentation-route"));
  }
  let token = null;
  if (!["roll-start", "dice-settled", "turn-start"].includes(event.kind)) {
    token = document.createElement("span");
    token.className = `presentation-token presentation-token-${event.kind}`;
    token.textContent = ({"route-chosen":"▲", "turn-stopped":"⛺", "turn-busted":"×", "summit-claimed":"⚑", "game-start":"◆", "game-result":"★"})[event.kind] || "→";
    const from = presentationPoint(source); const to = presentationPoint(target);
    if (from && to) {
      token.style.setProperty("--from-x", `${from.x}px`); token.style.setProperty("--from-y", `${from.y}px`);
      token.style.setProperty("--to-x", `${to.x}px`); token.style.setProperty("--to-y", `${to.y}px`);
    }
    E.presentationEffects.append(token);
  }
  return () => {
    source?.classList.remove("presentation-source"); target?.classList.remove("presentation-target");
    routes.forEach((element) => element.classList.remove("presentation-route"));
    retreat.forEach(cell => {
      cell.classList.remove("trail-retreat");
      cell.style.removeProperty("--retreat-delay");
    });
    token?.remove();
  };
}

presentation = createPresentationTimeline({
  container:E.presentationEffects, trailPath:E.presentationTrail, announcement:E.presentationAnnouncement,
  labelElement:E.presentationLabel, textElement:E.presentationText, effectsElement:E.presentationEffects,
  resolveSource:presentationSource, resolveTarget:presentationTarget, labelFor:(event) => presentationLabel(event.kind),
  beforePlay:playPresentationEvent, durationMs:1250, reducedDurationMs:520, maxQueue:18,
  sceneKey:(event) => event.sceneId || event.id, priorityFor:(event) => Number(event.priority) || 0,
  catchUpThreshold:2, severeBacklogThreshold:5, catchUpDurationMs:580, severeDurationMs:300,
  urgentPriority:4, retainPriority:3
});

async function init() {
  roomEntry.bind();
  spectatorUi.bind();
  E.roomPlayerCountSelect.onchange = changeCapacity; E.startGameButton.onclick = startGame; E.endGameButton.onclick = endGameEarly; E.playAgainButton.onclick = playAgain;
  E.toggleLogButton.onclick = () => { E.logList.classList.toggle("collapsed"); E.toggleLogButton.textContent = E.logList.classList.contains("collapsed") ? "展开" : "收起"; };
  try { spectatorUi.applyConfig(await room.checkServer()); } catch { E.connectionStatus.title = "请运行 node game10/signal-server.js"; }
}
init();
