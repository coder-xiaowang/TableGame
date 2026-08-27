"use strict";

import {
  bindRoomCodeInput,
  cleanPlayerName,
  createAuthoritativeRoomClient,
  createSessionStore,
  escapeHtml,
  renderConnectionStatus,
  setHidden,
  setModeVisibility
} from "/shared/client/index.js";

const PROTOCOL_VERSION = 3;
const roleForSeat = (index) => Number(index) % 2 === 0 ? "captain" : "member";
const teamIndexForSeat = (index) => Math.floor(Number(index) / 2);
const $ = (id) => document.getElementById(id);
const elements = Object.fromEntries([
  "connectionStatus","setupPanel","roomPanel","hostModeButton","guestModeButton","hostSetup",
  "guestSetup","hostNameInput","guestNameInput","playerCountSelect","createRoomButton",
  "roomCodeInput","joinRoomButton","hostTools","roomCodeDisplay","roomPlayerCountSelect",
  "startGameButton","endGameButton","returnLobbyButton","playerList","gameNotice","roundBadge",
  "wordBadge","scoreBoard","seatBoard","idiomValue","turnTitle","teamBadge","actionArea","logList"
].map((id) => [id,$(id)]));

let mode = "host";
let view = null;
const sessions = createSessionStore({gameId:"idiom"});
const room = createAuthoritativeRoomClient({
  protocolVersion:PROTOCOL_VERSION,
  sessionStore:sessions,
  onStatus(status) {
    renderConnectionStatus(elements.connectionStatus,status,room.snapshot().roomCode);
  },
  handlers:{
    onView(nextView) {
      view = nextView;
      enterRoom();
      render();
    },
    onKicked() {
      alert("你已被房主移出房间。");
      location.reload();
    }
  }
});

function enterRoom() {
  setHidden(elements.setupPanel,true);
  setHidden(elements.roomPanel,false);
  setHidden(elements.hostTools,!view?.permissions?.canManage);
  elements.roomCodeDisplay.textContent = room.snapshot().roomCode;
}

function selectMode(nextMode) {
  mode = nextMode;
  setModeVisibility(mode,{
    hostSetup:elements.hostSetup,
    guestSetup:elements.guestSetup,
    hostTools:elements.hostTools,
    hostButton:elements.hostModeButton,
    guestButton:elements.guestModeButton
  });
}

async function createGameRoom() {
  elements.createRoomButton.disabled = true;
  try {
    await room.createRoom({
      name:cleanPlayerName(elements.hostNameInput.value,"房主"),
      capacity:Number(elements.playerCountSelect.value)
    });
  } catch (error) {
    alert(`创建房间失败：${error.message}\n请确认已通过 node game2/signal-server.js 启动。`);
  } finally {
    elements.createRoomButton.disabled = false;
  }
}

async function joinGameRoom() {
  elements.joinRoomButton.disabled = true;
  try {
    const result = await room.joinRoom({
      code:elements.roomCodeInput.value,
      name:cleanPlayerName(elements.guestNameInput.value,"玩家")
    });
    if (result.resumed) elements.connectionStatus.textContent = "身份已恢复，正在同步游戏";
  } catch (error) {
    alert(`加入房间失败：${error.message}`);
  } finally {
    elements.joinRoomButton.disabled = false;
  }
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

function render() {
  if (!view) return;
  setHidden(elements.hostTools,!view.permissions?.canManage);
  setHidden(elements.startGameButton,!view.permissions?.canStart);
  setHidden(elements.endGameButton,!view.permissions?.canEnd);
  setHidden(elements.returnLobbyButton,!view.permissions?.canRestart);
  elements.roomPlayerCountSelect.value = String(view.capacity);
  elements.roomPlayerCountSelect.disabled = !view.permissions?.canSetCapacity;
  const seatsFull = view.seats.every((seat) => seat.playerId);
  elements.startGameButton.disabled = view.players.length !== view.capacity
    || !seatsFull
    || view.players.some((player) => !player.connected);
  elements.roomCodeDisplay.textContent = room.snapshot().roomCode;
  elements.gameNotice.textContent = view.notice;
  elements.roundBadge.textContent = `第 ${view.round} 轮`;
  elements.wordBadge.textContent = `第 ${view.wordNumber} 题`;
  elements.turnTitle.textContent = view.turnLabel;
  elements.teamBadge.textContent = view.phase === "playing" ? `第 ${view.turnTeamIndex + 1} 队` : "--";
  renderPlayers();
  renderScores();
  renderSeats();
  renderIdiom();
  renderActions();
  renderLog();
}

function renderScores() {
  const highest = view.scores.length ? Math.max(...view.scores) : 0;
  elements.scoreBoard.innerHTML = view.scores.map((score,index) => `
    <div class="score-card ${view.phase !== "lobby" && score === highest ? "leader" : ""}">
      <strong>第 ${index + 1} 队</strong><span class="score-value">${score}</span>
    </div>`).join("");
}

function renderPlayers() {
  elements.playerList.innerHTML = view.players.map((player) => `
    <div class="player-item ${player.id === view.selfId ? "player-self" : ""}">
      <div><div class="player-name">${escapeHtml(player.name)}</div><div class="player-meta">${player.isHost ? "房主" : "玩家"}</div></div>
      <div class="player-actions">
        <span class="tag ${player.connected ? "online" : "offline"}">${player.connected ? "在线" : "离线"}</span>
        ${view.permissions?.canKick && !player.isHost ? `<button class="kick-player-button" data-player-id="${escapeHtml(player.id)}" type="button">移出</button>` : ""}
      </div>
    </div>`).join("");
  elements.playerList.querySelectorAll(".kick-player-button").forEach((button) => {
    button.addEventListener("click",() => kickPlayer(button.dataset.playerId));
  });
}

function roleText(role) { return role === "captain" ? "队长" : "队员"; }

function renderSeats() {
  const playersById = new Map(view.players.map((player) => [player.id,player]));
  elements.seatBoard.innerHTML = view.seats.map((seat) => {
    const player = playersById.get(seat.playerId);
    const role = roleForSeat(seat.index);
    const team = teamIndexForSeat(seat.index) + 1;
    const mine = seat.playerId === view.selfId;
    const current = view.phase === "playing" && seat.playerId === view.currentActorId;
    const button = view.phase === "lobby" && !seat.playerId
      ? `<button data-sit="${seat.index}" type="button">落座</button>`
      : view.phase === "lobby" && mine ? '<button data-leave="1" type="button">离座</button>' : "";
    return `
      <div class="seat-card ${current ? "current" : ""}">
        <div class="seat-head"><strong>第 ${team} 队</strong><span class="role-chip role-${role}">${roleText(role)}</span></div>
        <div><div class="${player ? "seat-name" : "seat-empty"}">${escapeHtml(player?.name || "空位")}</div><div class="seat-meta">席位 ${seat.index + 1}${mine ? " · 你" : ""}</div></div>
        ${button}
      </div>`;
  }).join("");
  elements.seatBoard.querySelectorAll("[data-sit]").forEach((button) => {
    button.addEventListener("click",() => submit({type:"sit",seatIndex:Number(button.dataset.sit)}));
  });
  elements.seatBoard.querySelectorAll("[data-leave]").forEach((button) => {
    button.addEventListener("click",() => submit({type:"leaveSeat"}));
  });
}

function renderIdiom() {
  elements.idiomValue.classList.toggle("hidden-word",view.idiomHidden);
  if (view.phase === "lobby") elements.idiomValue.textContent = "尚未开始";
  else if (view.idiomHidden) elements.idiomValue.textContent = "队员不可见";
  else elements.idiomValue.textContent = view.idiom || "等待完整队伍";
}

function renderActions() {
  if (view.phase === "lobby") {
    elements.actionArea.innerHTML = '<p class="muted">自由落座中。所有席位坐满后，由房主开始游戏。</p>';
    return;
  }
  if (view.phase === "ended") {
    const highest = Math.max(...view.scores);
    const leaders = view.scores.map((score,index) => score === highest ? `第 ${index + 1} 队` : "").filter(Boolean);
    const winner = `${leaders.join("、")}${leaders.length > 1 ? "并列第一" : "获胜"}`;
    elements.actionArea.innerHTML = `<div class="result-title">${escapeHtml(winner)}</div><p>最高分：${highest} 分</p><p>最后一题成语：${escapeHtml(view.idiom)}</p>`;
    return;
  }
  if (!view.currentActorId) {
    elements.actionArea.innerHTML = '<p class="muted">当前没有完整在线队伍，等待玩家恢复连接。</p>';
    return;
  }
  if (!view.permissions?.canDescribe && !view.permissions?.canGuess) {
    const description = view.currentDescription
      ? `<div class="notice"><strong>当前描述：</strong>${escapeHtml(view.currentDescription)}</div>` : "";
    elements.actionArea.innerHTML = `${description}<p class="muted">等待当前队伍行动。</p>`;
    return;
  }
  if (view.permissions.canDescribe) {
    elements.actionArea.innerHTML = `<label>队长描述<textarea id="descriptionInput" autocomplete="off" maxlength="120" placeholder="输入给队员看的描述"></textarea></label><button class="primary" id="submitDescriptionButton" type="button">提交描述</button>`;
    $("submitDescriptionButton").addEventListener("click",() => submit({type:"describe",text:$("descriptionInput").value}));
    return;
  }
  elements.actionArea.innerHTML = `<div class="notice"><strong>当前描述：</strong>${escapeHtml(view.currentDescription)}</div><label>队员猜词<input id="guessInput" autocomplete="off" maxlength="12" placeholder="输入四字成语"></label><button class="primary" id="submitGuessButton" type="button">提交猜词</button>`;
  $("submitGuessButton").addEventListener("click",() => submit({type:"guess",text:$("guessInput").value}));
}

function renderLog() {
  if (!view.log.length) {
    elements.logList.innerHTML = '<p class="muted">还没有公开记录。</p>';
    return;
  }
  elements.logList.innerHTML = view.log.slice(0,40).map((item) => `
    <div class="log-item"><div class="log-line">${escapeHtml(item.text)}</div><div class="muted">${escapeHtml(item.detail || "")}</div></div>`).join("");
}

async function init() {
  bindRoomCodeInput(elements.roomCodeInput);
  elements.hostModeButton.addEventListener("click",() => selectMode("host"));
  elements.guestModeButton.addEventListener("click",() => selectMode("guest"));
  elements.createRoomButton.addEventListener("click",createGameRoom);
  elements.joinRoomButton.addEventListener("click",joinGameRoom);
  elements.roomPlayerCountSelect.addEventListener("change",changeCapacity);
  elements.startGameButton.addEventListener("click",startGame);
  elements.endGameButton.addEventListener("click",finishGame);
  elements.returnLobbyButton.addEventListener("click",returnToLobby);
  selectMode("host");
  try { await room.checkServer(); } catch { /* create/join shows the detailed error */ }
}

init();
