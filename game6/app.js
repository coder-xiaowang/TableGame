"use strict";

import {
  bindRoomCodeInput, cleanPlayerName, createAuthoritativeRoomClient, createCountdown,
  createSessionStore, createSpectatorUi, escapeHtml, renderConnectionStatus, renderCountdown, setHidden,
  setModeVisibility
} from "/shared/client/index.js";
import {
  ACTION_SECONDS, CAPTURE_ANIMATION_MS, PLACE_ANIMATION_MS, REVEAL_MS, TURN_END_MS, bullheads
} from "./rules.mjs";

const PROTOCOL_VERSION = 3;
const $ = (id) => document.getElementById(id);
const E = Object.fromEntries([
  "connectionStatus","setupPanel","roomPanel","hostModeButton","guestModeButton","hostSetup",
  "guestSetup","hostNameInput","guestNameInput","playerCountSelect","createRoomButton",
  "joinRoomButton","roomCodeInput","joinIntentField","roomCodeDisplay","hostTools","roomPlayerCountSelect",
  "spectatorSettingButton","roomRoleBanner","roomRoleTitle","roomRoleHint","seatActionButton",
  "startGameButton","endGameButton","playerCountBadge","playerList","notice","roundBadge",
  "turnBadge","revealPanel","revealProgress","revealedPlays","rows","turnConsole","actionTitle","actionArea","timerText","timerBar","handCount","hand",
  "turnHandPanel","selectionState","logList","toggleLogButton","spectatorPanel","spectatorCountBadge","spectatorList"
].map((id) => [id,$(id)]));

let mode = "host";
let view = null;
let spectatorUi = null;
const sessions = createSessionStore({gameId:"bullheads"});
const countdown = createCountdown({
  onTick(value) { renderCountdown({textElement:E.timerText,barElement:E.timerBar},value); }
});
const room = createAuthoritativeRoomClient({
  protocolVersion:PROTOCOL_VERSION,
  sessionStore:sessions,
  onStatus(status) { renderConnectionStatus(E.connectionStatus,status,room.snapshot().roomCode); },
  handlers:{
    onView(nextView) { view = nextView; enterRoom(); render(); },
    onKicked() { spectatorUi?.handleSessionEnded("kicked"); },
    onRoomExpired() { spectatorUi?.handleSessionEnded("room_expired"); }
  }
});

spectatorUi = createSpectatorUi({
  room,
  getView:() => view,
  elements:{
    joinIntentField:E.joinIntentField,
    roomRoleBanner:E.roomRoleBanner,
    roomRoleTitle:E.roomRoleTitle,
    roomRoleHint:E.roomRoleHint,
    seatActionButton:E.seatActionButton,
    spectatorSettingButton:E.spectatorSettingButton,
    spectatorPanel:E.spectatorPanel,
    spectatorCountBadge:E.spectatorCountBadge,
    spectatorList:E.spectatorList
  },
  notify:(message) => alert(message),
  confirmAction:(message) => confirm(message),
  onSessionEnded:() => location.reload()
});

function enterRoom() {
  setHidden(E.setupPanel,true);
  setHidden(E.roomPanel,false);
  setHidden(E.hostTools,!view?.permissions?.canManage);
  E.roomCodeDisplay.textContent = room.snapshot().roomCode;
}

function selectMode(nextMode) {
  mode = nextMode;
  setModeVisibility(mode,{
    hostSetup:E.hostSetup,guestSetup:E.guestSetup,hostTools:E.hostTools,
    hostButton:E.hostModeButton,guestButton:E.guestModeButton
  });
}

async function createGameRoom() {
  E.createRoomButton.disabled = true;
  try {
    await room.createRoom({
      name:cleanPlayerName(E.hostNameInput.value,"房主"),
      capacity:Number(E.playerCountSelect.value)
    });
  } catch (error) {
    alert(`创建房间失败：${error.message}\n请确认已通过 node game6/signal-server.js 启动。`);
  } finally {
    E.createRoomButton.disabled = false;
  }
}

async function joinGameRoom() {
  E.joinRoomButton.disabled = true;
  try {
    const result = await room.joinRoom({
      code:E.roomCodeInput.value,
      name:cleanPlayerName(E.guestNameInput.value,"玩家"),
      intent:spectatorUi.getJoinIntent()
    });
    E.connectionStatus.textContent = spectatorUi.handleJoinResult(result).statusText;
  } catch (error) {
    alert(`加入房间失败：${error.message}`);
  } finally {
    E.joinRoomButton.disabled = false;
  }
}

function submit(action) {
  return Promise.resolve(room.submitAction(action)).catch((error) => {
    E.connectionStatus.textContent = `操作失败：${error.message}`;
    alert(error.message);
  });
}

async function kickPlayer(playerId) {
  const player = view?.players.find((item) => item.id === playerId);
  if (!player || player.isHost || !confirm(`确定要移出 ${player.name} 吗？游戏中移出玩家会取消当前对局并返回大厅。`)) return;
  try { await room.kick(playerId); }
  catch (error) { alert(`移出失败：${error.message}`); }
}

function cardHtml(number, options={}) {
  const points = bullheads(number);
  const classes = ["number-card",points >= 5 ? "danger-card" : "",options.selected ? "selected" : ""].filter(Boolean).join(" ");
  const content = `<strong>${number}</strong><small>${"🐂".repeat(points)}</small>`;
  if (!options.button) return `<div class="${classes}">${content}</div>`;
  return `<button class="${classes}" data-card="${number}" ${options.disabled ? "disabled" : ""}>${content}</button>`;
}

function playerName(playerId) {
  return view.players.find((player) => player.id === playerId)?.name || "玩家";
}

function renderRevealedPlays() {
  const plays = view.revealedPlays || [];
  setHidden(E.revealPanel,!plays.length);
  if (!plays.length) {
    E.revealedPlays.innerHTML = "";
    E.revealProgress.textContent = "";
    return;
  }
  const completed = plays.filter((play) => play.status === "done").length;
  E.revealProgress.textContent = view.phase === "revealing"
    ? "全部出牌已公开"
    : `${completed} / ${plays.length} 已放置`;
  E.revealedPlays.innerHTML = plays.map((play,index) => `
    <div class="revealed-play status-${play.status}" data-animation-source="${play.playerId}:${play.card}" style="--player-accent:${(index*47+112)%360}">
      <span class="revealed-owner">${escapeHtml(playerName(play.playerId))}</span>
      ${cardHtml(play.card)}
      <span class="revealed-state">${{waiting:"等待",active:"放置中",choosing:"选择牌列",done:"已放置"}[play.status] || "等待"}</span>
    </div>`).join("");
}

function renderPlayers() {
  E.playerList.innerHTML = view.players.map((player) => {
    const selected = view.phase === "selecting" ? (player.hasSelected ? "已选牌" : "选择中") : `${player.hand.length} 张手牌`;
    const winner = view.winners.includes(player.id) ? " · 获胜者" : "";
    const collecting = view.animation?.type === "captureAndPlace" && view.animation.playerId === player.id;
    return `<div class="player ${view.pendingPlayerId === player.id ? "current" : ""} ${collecting ? "score-pulse" : ""}" data-player-panel="${escapeHtml(player.id)}">
      <div class="player-top"><span>${escapeHtml(player.name)}${player.isHost ? " 👑" : ""}</span><b>🐂 ${player.score}</b></div>
      <div class="player-meta">${selected}${winner}${player.connected ? "" : " · 已离线"}</div>
      <div class="captured">${player.captured.map((card) => `<span class="mini">${card} · ${bullheads(card)}🐂</span>`).join("")}</div>
      ${view.permissions?.canKick && !player.isHost ? `<button data-player-id="${escapeHtml(player.id)}" type="button">移出</button>` : ""}
    </div>`;
  }).join("");
  E.playerList.querySelectorAll("[data-player-id]").forEach((button) => {
    button.addEventListener("click",() => kickPlayer(button.dataset.playerId));
  });
}

function renderRows() {
  E.rows.innerHTML = view.rows.map((row,index) => `
    <div class="card-row ${view.permissions?.canChooseRow ? "choice" : ""} ${view.animation?.rowIndex === index ? "animation-target" : ""} ${view.animation?.rowIndex === index && view.animation.type === "captureAndPlace" ? "will-capture" : ""}" data-row="${index}">
      <div class="row-label">${index + 1}</div>${row.map((card) => cardHtml(card)).join("")}
      ${view.animation?.rowIndex === index && view.animation.type === "captureAndPlace" ? `<div class="capture-preview">${escapeHtml(playerName(view.animation.playerId))} 收列<br><b>+${view.animation.points} 🐂</b></div>` : ""}
    </div>`).join("");
  if (view.permissions?.canChooseRow) {
    E.rows.querySelectorAll("[data-row]").forEach((element) => {
      element.addEventListener("click",() => submit({type:"chooseRow",rowIndex:Number(element.dataset.row)}));
    });
  }
}

function renderNotice() {
  if (view.phase === "lobby") {
    E.notice.textContent = view.players.length === view.capacity
      ? "玩家已经到齐，房主可以开始游戏。"
      : `等待玩家加入：${view.players.length} / ${view.capacity}`;
  } else if (view.phase === "selecting") {
    E.notice.textContent = `第 ${view.round} 局第 ${view.turn} 回合：所有玩家秘密选择一张牌。`;
  } else if (view.phase === "revealing") {
    E.notice.textContent = "本轮出牌已经全部公开，即将按照牌面数字从小到大依次放置。";
  } else if (view.phase === "placing") {
    E.notice.textContent = `${playerName(view.pendingPlayerId)} 的 ${view.pendingCard} 正在放入第 ${Number(view.animation?.rowIndex) + 1} 列。`;
  } else if (view.phase === "choosingRow") {
    const player = view.players.find((item) => item.id === view.pendingPlayerId);
    E.notice.textContent = `${player?.name || "玩家"} 打出的 ${view.pendingCard} 比四列都小，必须选择一列收走。`;
  } else if (view.phase === "roundEnd") {
    E.notice.textContent = `第 ${view.round} 局结束，所有玩家累计分数均未达到 66，等待房主开始下一局。`;
  } else if (view.phase === "gameEnd") {
    const names = view.players.filter((player) => view.winners.includes(player.id)).map((player) => player.name);
    E.notice.textContent = `有玩家累计达到 66 个牛头，游戏结束。${names.join("、")} 以最低罚分获胜！`;
  } else {
    E.notice.textContent = "本轮出牌已经全部放置，准备开始下一回合。";
  }
}

function renderAction(me, memberRole) {
  E.actionArea.innerHTML = "";
  if (memberRole === "spectator") {
    E.actionTitle.textContent = view.phase === "lobby" ? "旁观准备阶段" : "正在旁观牌局";
    E.actionArea.innerHTML = '<p class="spectator-action-note">旁观模式只显示公开牌局信息，不提供选牌或选列操作。</p>';
    return;
  }
  if (view.phase === "selecting") {
    E.actionTitle.textContent = me.hasSelected ? `已选择 ${me.selectedCard ?? ""}`.trim() : "选择一张手牌";
    E.actionArea.textContent = me.hasSelected ? "你的牌已经锁定，其他玩家看不到牌面。" : "点击下方手牌完成选择，提交后不能更改。";
  } else if (view.phase === "revealing") {
    E.actionTitle.textContent = "公开本轮出牌";
    E.actionArea.textContent = "请查看上方出牌区；将从最小的牌开始逐张处理。";
  } else if (view.phase === "placing") {
    E.actionTitle.textContent = view.animation?.type === "captureAndPlace" ? "收走第六张所在牌列" : "正在放置卡牌";
    E.actionArea.textContent = view.animation?.type === "captureAndPlace"
      ? `${playerName(view.pendingPlayerId)} 将收走第 ${view.animation.rowIndex + 1} 列并获得 ${view.animation.points} 个牛头。`
      : `${playerName(view.pendingPlayerId)} 的 ${view.pendingCard} 正在移动到第 ${view.animation.rowIndex + 1} 列。`;
  } else if (view.phase === "choosingRow") {
    const player = view.players.find((item) => item.id === view.pendingPlayerId);
    E.actionTitle.textContent = view.permissions?.canChooseRow ? "选择收走一列" : `等待 ${player?.name || "玩家"} 选列`;
    E.actionArea.textContent = view.permissions?.canChooseRow ? "直接点击桌面上的任意一列。" : "该玩家有 15 秒进行选择。";
  } else if (view.phase === "roundEnd") {
    E.actionTitle.textContent = "本局结束";
    E.actionArea.textContent = view.permissions?.canStart ? "点击左侧“开始下一局”继续游戏。" : "等待房主开始下一局。";
  } else if (view.phase === "gameEnd") {
    E.actionTitle.textContent = "整场游戏结束";
    E.actionArea.textContent = "累计罚分最低的玩家获胜。房主可以结束游戏并返回大厅。";
  } else if (view.phase === "lobby") {
    E.actionTitle.textContent = "等待开始";
    E.actionArea.textContent = "玩家到齐后由房主开始游戏。";
  } else {
    E.actionTitle.textContent = "本轮完成";
    E.actionArea.textContent = "稍后将开始下一回合秘密选牌。";
  }
}

function playPlacementAnimation() {
  document.querySelectorAll(".table-animation-card").forEach((element) => element.remove());
  const animation = view.animation;
  if (!animation || view.phase !== "placing" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const source = [...E.revealedPlays.querySelectorAll("[data-animation-source]")]
    .find((element) => element.dataset.animationSource === `${animation.playerId}:${animation.card}`)
    ?.querySelector(".number-card");
  const targetRow = E.rows.querySelector(`[data-row="${animation.rowIndex}"]`);
  if (!source || !targetRow) return;
  const sourceBox = source.getBoundingClientRect();
  const cards = targetRow.querySelectorAll(":scope > .number-card");
  const lastCard = cards[cards.length-1];
  const rowBox = targetRow.getBoundingClientRect();
  const lastBox = lastCard?.getBoundingClientRect();
  const targetLeft = animation.type === "captureAndPlace"
    ? rowBox.left + Math.min(rowBox.width - sourceBox.width - 12,44)
    : Math.min(rowBox.right-sourceBox.width-12,(lastBox?.right || rowBox.left+44)+8);
  const targetTop = rowBox.top + (rowBox.height-sourceBox.height)/2;
  const total = Math.max(1,animation.endsAt-animation.startedAt);
  const remaining = Math.max(0,animation.endsAt-Date.now());
  const progress = Math.max(0,Math.min(1,1-remaining/total));
  const deltaX = targetLeft-sourceBox.left;
  const deltaY = targetTop-sourceBox.top;
  const flying = document.createElement("div");
  flying.className = `number-card flying-card table-animation-card ${bullheads(animation.card) >= 5 ? "danger-card" : ""}`;
  flying.innerHTML = `<strong>${animation.card}</strong><small>${"🐂".repeat(bullheads(animation.card))}</small>`;
  Object.assign(flying.style,{
    left:`${sourceBox.left}px`,top:`${sourceBox.top}px`,
    transform:`translate(${deltaX*progress}px,${deltaY*progress}px) rotate(${progress*3}deg)`,
    transitionDuration:`${remaining}ms`
  });
  document.body.append(flying);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    flying.style.transform = `translate(${deltaX}px,${deltaY}px) rotate(3deg)`;
  }));
  window.setTimeout(() => flying.remove(),remaining+100);
  if (animation.type === "captureAndPlace") playCaptureCollection(animation,targetRow,progress,remaining);
}

function playCaptureCollection(animation, targetRow, progress, remaining) {
  const playerPanel = [...E.playerList.querySelectorAll("[data-player-panel]")]
    .find((element) => element.dataset.playerPanel === animation.playerId);
  if (!playerPanel) return;
  const destination = playerPanel.getBoundingClientRect();
  [...targetRow.querySelectorAll(":scope > .number-card")].forEach((card,index) => {
    const start = card.getBoundingClientRect();
    const clone = card.cloneNode(true);
    const deltaX = destination.left+destination.width/2-start.left-start.width/2+(index-2)*4;
    const deltaY = destination.top+destination.height/2-start.top-start.height/2;
    clone.classList.add("capture-flying-card","table-animation-card");
    Object.assign(clone.style,{
      left:`${start.left}px`,top:`${start.top}px`,
      opacity:String(1-progress*.85),
      transform:`translate(${deltaX*progress}px,${deltaY*progress}px) scale(${1-progress*.72}) rotate(${(index-2)*progress*5}deg)`,
      transitionDuration:`${remaining}ms`,transitionDelay:`${Math.min(index*35,remaining/5)}ms`
    });
    document.body.append(clone);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      clone.style.opacity = "0";
      clone.style.transform = `translate(${deltaX}px,${deltaY}px) scale(.28) rotate(${(index-2)*5}deg)`;
    }));
    window.setTimeout(() => clone.remove(),remaining+index*35+100);
  });
}

function countdownDuration() {
  if (["selecting","choosingRow"].includes(view.phase)) return ACTION_SECONDS*1000;
  if (view.phase === "revealing") return REVEAL_MS;
  if (view.phase === "turnEnding") return TURN_END_MS;
  if (view.phase === "placing") return view.animation?.endsAt-view.animation?.startedAt
    || (view.animation?.type === "captureAndPlace" ? CAPTURE_ANIMATION_MS : PLACE_ANIMATION_MS);
  return 0;
}

function render() {
  if (!view) return;
  const spectatorModel = spectatorUi.render(view);
  const memberRole = spectatorModel.memberRole;
  const me = view.players.find((player) => player.id === view.selfId);
  setHidden(E.hostTools,!view.permissions?.canManage);
  setHidden(E.startGameButton,!view.permissions?.canStart);
  setHidden(E.endGameButton,!view.permissions?.canEnd);
  E.startGameButton.textContent = view.phase === "roundEnd" ? "开始下一局" : "开始游戏";
  E.startGameButton.disabled = view.phase === "lobby" && (view.players.length !== view.capacity || view.players.some((player) => !player.connected));
  E.roomPlayerCountSelect.value = String(view.capacity);
  E.roomPlayerCountSelect.disabled = !view.permissions?.canSetCapacity;
  E.roomCodeDisplay.textContent = room.snapshot().roomCode;
  E.playerCountBadge.textContent = `${view.players.length} / ${view.capacity}`;
  E.roundBadge.textContent = `第 ${view.round} 局`;
  E.turnBadge.textContent = `第 ${view.turn} / 10 回合`;
  E.handCount.textContent = me?.hand.length || 0;
  E.turnConsole.dataset.phase = view.phase;
  E.turnConsole.dataset.handExpanded = String(Boolean(memberRole === "player" && view.phase === "selecting" && !me?.hasSelected && view.permissions?.canSelect));
  setHidden(E.turnHandPanel,memberRole === "spectator");
  renderPlayers();
  renderRevealedPlays();
  renderRows();
  renderNotice();
  renderAction(me,memberRole);
  E.hand.innerHTML = (me?.hand || []).map((card) => cardHtml(card,{
    button:true,disabled:!view.permissions?.canSelect,selected:me.selectedCard === card
  })).join("");
  E.hand.querySelectorAll("[data-card]").forEach((button) => {
    button.addEventListener("click",() => submit({type:"selectCard",card:Number(button.dataset.card)}));
  });
  E.selectionState.textContent = memberRole === "player" && view.phase === "selecting" ? (me?.hasSelected ? "已锁定，等待其他玩家" : "请选择一张牌") : "";
  setHidden(E.selectionState,!E.selectionState.textContent);
  E.logList.innerHTML = view.logs.map((item) => `<div class="log-item">${escapeHtml(item.text)}</div>`).join("");
  if (view.deadline) countdown.start(view.deadline,countdownDuration());
  else {
    countdown.stop();
    E.timerText.textContent = "--";
    E.timerBar.style.width = "0";
  }
  playPlacementAnimation();
}

function endGame() {
  if (confirm("确定结束当前游戏并返回准备阶段吗？所有累计分数将被清空。")) submit({type:"end"});
}

async function init() {
  bindRoomCodeInput(E.roomCodeInput);
  E.hostModeButton.addEventListener("click",() => selectMode("host"));
  E.guestModeButton.addEventListener("click",() => selectMode("guest"));
  E.createRoomButton.addEventListener("click",createGameRoom);
  E.joinRoomButton.addEventListener("click",joinGameRoom);
  spectatorUi.bind();
  E.roomPlayerCountSelect.addEventListener("change",() => submit({type:"setCapacity",capacity:Number(E.roomPlayerCountSelect.value)}));
  E.startGameButton.addEventListener("click",() => submit({type:"start"}));
  E.endGameButton.addEventListener("click",endGame);
  E.toggleLogButton.addEventListener("click",() => E.logList.classList.toggle("collapsed"));
  selectMode("host");
  try { spectatorUi.applyConfig(await room.checkServer()); } catch { /* create/join presents the detailed error */ }
}

init();
