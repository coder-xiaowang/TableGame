"use strict";

import {
  createAuthoritativeRoomClient,
  createRoomEntryController,
  createSessionStore,
  createSpectatorUi,
  escapeHtml,
  renderConnectionStatus,
  setHidden
} from "/shared/client/index.js";
import { createGame2PartitionRenderer, createGame2RenderModel } from "./render-partitions.mjs";

const PROTOCOL_VERSION = 3;
const roleForSeat = (index) => Number(index) % 2 === 0 ? "captain" : "member";
const teamIndexForSeat = (index) => Math.floor(Number(index) / 2);
const $ = (id) => document.getElementById(id);
const elements = Object.fromEntries([
  "siteHeader","connectionStatus","roomHeaderTools","setupPanel","roomPanel","hostModeButton","guestModeButton","hostSetup",
  "guestSetup","hostNameInput","guestNameInput","playerCountSelect","createRoomButton",
  "roomCodeInput","joinRoomButton","joinIntentField","hostTools","roomCodeDisplay","roomPlayerCountSelect",
  "spectatorSettingButton","seatActionButton",
  "spectatorPanel","spectatorCountBadge","spectatorList",
  "startGameButton","endGameButton","returnLobbyButton","playerList","gameNotice","roundBadge",
  "wordBadge","scoreBoard","seatBoard","idiomValue","turnTitle","teamBadge","actionArea","logList"
].map((id) => [id,$(id)]));

let view = null;
let spectatorUi = null;
let actionDraft = null;
let partitionRenderer = null;
const sessions = createSessionStore({gameId:"idiom"});
const room = createAuthoritativeRoomClient({
  protocolVersion:PROTOCOL_VERSION,
  sessionStore:sessions,
  onStatus(status) {
    renderConnectionStatus(elements.connectionStatus,status,room.snapshot().roomCode);
  },
  handlers:{
    onView(nextView) {
      captureActionDraft();
      view = nextView;
      reconcileActionDraft();
      enterRoom();
      render();
    },
    onKicked() { spectatorUi?.handleSessionEnded("kicked"); },
    onRoomExpired() { spectatorUi?.handleSessionEnded("room_expired"); }
  }
});

spectatorUi = createSpectatorUi({
  room,
  getView:() => view,
  elements:{
    joinIntentField:elements.joinIntentField,
    seatActionButton:elements.seatActionButton,
    spectatorSettingButton:elements.spectatorSettingButton,
    spectatorPanel:elements.spectatorPanel,
    spectatorCountBadge:elements.spectatorCountBadge,
    spectatorList:elements.spectatorList
  },
  notify:(message) => alert(message),
  confirmAction:(message) => confirm(message),
  onSessionEnded:() => location.reload()
});
const roomEntry = createRoomEntryController({room,spectatorUi,elements:{root:elements.setupPanel,hostModeButton:elements.hostModeButton,guestModeButton:elements.guestModeButton,hostSetup:elements.hostSetup,guestSetup:elements.guestSetup,hostTools:elements.hostTools,hostNameInput:elements.hostNameInput,guestNameInput:elements.guestNameInput,roomCodeInput:elements.roomCodeInput,createRoomButton:elements.createRoomButton,joinRoomButton:elements.joinRoomButton,connectionStatus:elements.connectionStatus},buildCreatePayload:()=>({capacity:Number(elements.playerCountSelect.value)}),formatError:(kind,error)=>kind==="create"?`创建房间失败：${error.message}\n请确认已通过 node game2/signal-server.js 启动。`:`加入房间失败：${error.message}`});

function enterRoom() {
  setHidden(elements.setupPanel,true);
  setHidden(elements.roomPanel,false);
  setHidden(elements.roomHeaderTools,false);
  elements.siteHeader.classList.add("in-room");
  setHidden(elements.hostTools,!view?.permissions?.canManage);
  elements.roomCodeDisplay.textContent = room.snapshot().roomCode;
}

function submit(action) {
  return Promise.resolve(room.submitAction(action)).catch((error) => {
    elements.connectionStatus.textContent = `操作失败：${error.message}`;
    alert(error.message);
  });
}

async function kickPlayer(playerId) {
  const player = view?.players.find((item) => item.id === playerId);
  if (!player || player.isHost || !confirm(`确定要移出 ${player.name} 吗？游戏中移出玩家会直接结束大局。`)) return;
  try {
    await room.kick(playerId);
  } catch (error) {
    alert(`移出失败：${error.message}`);
  }
}

function changeCapacity() {
  if (!view?.permissions?.canSetCapacity) return;
  submit({type:"setCapacity",capacity:Number(elements.roomPlayerCountSelect.value)});
}

function startGame() { submit({type:"start"}); }
function finishGame() {
  if (view?.phase === "playing" && confirm("确定结束当前大局并结算比分吗？")) submit({type:"end"});
}
function returnToLobby() { submit({type:"restart"}); }

function actionContext(current = view) {
  if (!current || current.phase !== "playing" || !current.selfId) return null;
  const kind = current.permissions?.canDescribe ? "describe" : current.permissions?.canGuess ? "guess" : "";
  if (!kind) return null;
  return {
    key:[room.snapshot().roomCode,current.round,current.wordNumber,current.currentActorId,current.selfId,kind].join(":"),
    kind
  };
}

function captureActionDraft() {
  const context = actionContext();
  if (!context) return;
  const input = $(context.kind === "describe" ? "descriptionInput" : "guessInput");
  if (!input) return;
  actionDraft = {
    ...context,
    value:input.value,
    focused:document.activeElement === input,
    selectionStart:input.selectionStart,
    selectionEnd:input.selectionEnd
  };
}

function reconcileActionDraft() {
  const context = actionContext();
  if (!context || actionDraft?.key !== context.key) actionDraft = null;
}

function restoreActionDraft() {
  const context = actionContext();
  if (!context) return;
  if (actionDraft?.key !== context.key) actionDraft = {...context,value:"",focused:false,selectionStart:0,selectionEnd:0};
  const input = $(context.kind === "describe" ? "descriptionInput" : "guessInput");
  if (!input) return;
  input.value = actionDraft.value;
  input.addEventListener("input",() => { if (actionDraft?.key === context.key) actionDraft.value = input.value; });
  if (!actionDraft.focused) return;
  requestAnimationFrame(() => {
    input.focus({preventScroll:true});
    if (Number.isInteger(actionDraft?.selectionStart)) input.setSelectionRange(actionDraft.selectionStart,actionDraft.selectionEnd);
  });
}

function roleText(role) { return role === "captain" ? "队长" : "队员"; }

function renderRoomPartition(model) {
  const current = model.view;
  setHidden(elements.hostTools,!current.permissions?.canManage);
  setHidden(elements.startGameButton,!current.permissions?.canStart);
  setHidden(elements.endGameButton,!current.permissions?.canEnd);
  setHidden(elements.returnLobbyButton,!current.permissions?.canRestart);
  elements.roomPlayerCountSelect.value = String(current.capacity);
  elements.roomPlayerCountSelect.disabled = !current.permissions?.canSetCapacity;
  const seatsFull = current.seats.every((seat) => seat.playerId);
  elements.startGameButton.disabled = current.players.length !== current.capacity
    || !seatsFull
    || current.players.some((player) => !player.connected);
  elements.roomCodeDisplay.textContent = model.roomCode;
}

function renderStatusPartition(model) {
  const current = model.view;
  elements.gameNotice.textContent = model.memberRole === "spectator" && current.phase === "lobby"
    ? "你正在旁观准备阶段，可在玩家席和队伍席位都有空位时加入游戏。"
    : current.notice;
  elements.roundBadge.textContent = `第 ${current.round} 轮`;
  elements.wordBadge.textContent = `第 ${current.wordNumber} 题`;
  elements.turnTitle.textContent = current.turnLabel;
  elements.teamBadge.textContent = current.phase === "playing" ? `第 ${current.turnTeamIndex + 1} 队` : "--";
}

function renderPlayersPartition(model) {
  const current = model.view;
  const existing = new Map([...elements.playerList.querySelectorAll("[data-player-id]")].map((node) => [node.dataset.playerId,node]));
  const retained = new Set();
  current.players.forEach((player,index) => {
    const id = String(player.id);
    let node = existing.get(id);
    if (!node) {
      node = document.createElement("div");
      node.dataset.playerId = id;
      node.innerHTML = '<div><div class="player-name" data-player-name></div><div class="player-meta" data-player-meta></div></div><div class="player-actions"><span class="tag" data-presence></span><button class="kick-player-button" data-kick-player type="button">移出</button></div>';
    }
    retained.add(id);
    node.className = `player-item ${player.id === current.selfId ? "player-self" : ""}`;
    node.querySelector("[data-player-name]").textContent = player.name;
    node.querySelector("[data-player-meta]").textContent = player.isHost ? "房主" : "玩家";
    const presence = node.querySelector("[data-presence]");
    presence.className = `tag ${player.connected ? "online" : "offline"}`;
    presence.textContent = player.connected ? "在线" : "离线";
    const kick = node.querySelector("[data-kick-player]");
    kick.dataset.kickPlayer = id;
    setHidden(kick,!current.permissions?.canKick || player.isHost);
    const atIndex = elements.playerList.children[index];
    if (atIndex !== node) elements.playerList.insertBefore(node,atIndex || null);
  });
  [...elements.playerList.querySelectorAll("[data-player-id]")].forEach((node) => {
    if (!retained.has(node.dataset.playerId)) node.remove();
  });
}

function renderScoresPartition(model) {
  const current = model.view;
  const highest = current.scores.length ? Math.max(...current.scores) : 0;
  elements.scoreBoard.innerHTML = current.scores.map((score,index) => `
    <div class="score-card ${current.phase !== "lobby" && score === highest ? "leader" : ""}">
      <strong>第 ${index + 1} 队</strong><span class="score-value">${score}</span>
    </div>`).join("");
}

function renderSeatsPartition(model) {
  const current = model.view;
  const playersById = new Map(current.players.map((player) => [player.id,player]));
  elements.seatBoard.innerHTML = current.seats.map((seat) => {
    const player = playersById.get(seat.playerId);
    const role = roleForSeat(seat.index);
    const team = teamIndexForSeat(seat.index) + 1;
    const mine = seat.playerId === current.selfId;
    const acting = current.phase === "playing" && seat.playerId === current.currentActorId;
    const canChoose = model.memberRole !== "spectator" && Boolean(current.selfId);
    const button = canChoose && current.phase === "lobby" && !seat.playerId
      ? `<button data-sit="${seat.index}" type="button">落座</button>`
      : canChoose && current.phase === "lobby" && mine ? '<button data-leave="1" type="button">离开队伍席位</button>' : "";
    return `<div class="seat-card ${acting ? "current" : ""}"><div class="seat-head"><strong>第 ${team} 队</strong><span class="role-chip role-${role}">${roleText(role)}</span></div><div><div class="${player ? "seat-name" : "seat-empty"}">${escapeHtml(player?.name || "空位")}</div><div class="seat-meta">席位 ${seat.index + 1}${mine ? " · 你" : ""}</div></div>${button}</div>`;
  }).join("");
}

function renderIdiomPartition(model) {
  const current = model.view;
  elements.idiomValue.classList.toggle("hidden-word",current.idiomHidden);
  if (current.phase === "lobby") elements.idiomValue.textContent = "尚未开始";
  else if (current.idiomHidden) elements.idiomValue.textContent = model.memberRole === "spectator" ? "旁观者不可见" : "队员不可见";
  else elements.idiomValue.textContent = current.idiom || "等待完整队伍";
}

function renderDecisionPartition(model) {
  const current = model.view;
  if (current.phase === "lobby") {
    elements.actionArea.innerHTML = model.memberRole === "spectator"
      ? '<p class="muted spectator-action-note">旁观者不占玩家名额和队伍席位；进入玩家席后还需选择一个队伍席位。</p>'
      : '<p class="muted">自由落座中。所有席位坐满后，由房主开始游戏。</p>';
    return;
  }
  if (current.phase === "ended") {
    const highest = Math.max(...current.scores);
    const leaders = current.scores.map((score,index) => score === highest ? `第 ${index + 1} 队` : "").filter(Boolean);
    const winner = `${leaders.join("、")}${leaders.length > 1 ? "并列第一" : "获胜"}`;
    elements.actionArea.innerHTML = `<div class="result-title">${escapeHtml(winner)}</div><p>最高分：${highest} 分</p><p>最后一题成语：${escapeHtml(current.idiom)}</p>`;
    return;
  }
  if (!current.currentActorId) {
    elements.actionArea.innerHTML = '<p class="muted">当前没有完整在线队伍，等待玩家恢复连接。</p>';
    return;
  }
  if (!current.permissions?.canDescribe && !current.permissions?.canGuess) {
    const description = current.currentDescription ? `<div class="notice"><strong>当前描述：</strong>${escapeHtml(current.currentDescription)}</div>` : "";
    const waiting = model.memberRole === "spectator"
      ? '<p class="muted spectator-action-note">旁观模式只能查看已经公开的描述、猜词记录和比分，当前成语答案不会显示。</p>'
      : '<p class="muted">等待当前队伍行动。</p>';
    elements.actionArea.innerHTML = `${description}${waiting}`;
    return;
  }
  if (current.permissions.canDescribe) {
    elements.actionArea.innerHTML = '<label>队长描述<textarea id="descriptionInput" autocomplete="off" maxlength="120" placeholder="输入给队员看的描述"></textarea></label><button class="primary" data-action="describe" type="button">提交描述</button>';
    restoreActionDraft();
    return;
  }
  elements.actionArea.innerHTML = `<div class="notice"><strong>当前描述：</strong>${escapeHtml(current.currentDescription)}</div><label>队员猜词<input id="guessInput" autocomplete="off" maxlength="12" placeholder="输入四字成语"></label><button class="primary" data-action="guess" type="button">提交猜词</button>`;
  restoreActionDraft();
}

function renderLogPartition(model) {
  const records = model.view.log || [];
  if (!records.length) {
    elements.logList.innerHTML = '<p class="muted">还没有公开记录。</p>';
    return;
  }
  elements.logList.innerHTML = records.slice(0,40).map((item) => `<div class="log-item"><div class="log-line">${escapeHtml(item.text)}</div><div class="muted">${escapeHtml(item.detail || "")}</div></div>`).join("");
}

function render() {
  if (!view) return;
  const spectatorModel = spectatorUi.render(view);
  const model = createGame2RenderModel(view,{memberRole:spectatorModel.memberRole,roomCode:room.snapshot().roomCode});
  partitionRenderer ??= createGame2PartitionRenderer({
    room:renderRoomPartition,status:renderStatusPartition,players:renderPlayersPartition,
    scores:renderScoresPartition,seats:renderSeatsPartition,idiom:renderIdiomPartition,
    decision:renderDecisionPartition,log:renderLogPartition
  });
  partitionRenderer.render(model);
}

async function init() {
  roomEntry.bind();
  spectatorUi.bind();
  elements.roomPlayerCountSelect.addEventListener("change",changeCapacity);
  elements.startGameButton.addEventListener("click",startGame);
  elements.endGameButton.addEventListener("click",finishGame);
  elements.returnLobbyButton.addEventListener("click",returnToLobby);
  elements.playerList.addEventListener("click",(event) => {
    const button = event.target.closest("[data-kick-player]");
    if (button) kickPlayer(button.dataset.kickPlayer);
  });
  elements.seatBoard.addEventListener("click",(event) => {
    const sit = event.target.closest("[data-sit]");
    if (sit) submit({type:"sit",seatIndex:Number(sit.dataset.sit)});
    const leave = event.target.closest("[data-leave]");
    if (leave) submit({type:"leaveSeat"});
  });
  elements.actionArea.addEventListener("click",(event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "describe") submit({type:"describe",text:$("descriptionInput").value});
    if (action === "guess") submit({type:"guess",text:$("guessInput").value});
  });
  roomEntry.selectMode("host");
  try { spectatorUi.applyConfig(await room.checkServer()); } catch { /* create/join shows the detailed error */ }
}

init();
