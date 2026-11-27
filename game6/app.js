"use strict";

import {
  bindRoomCodeInput, cleanPlayerName, createAuthoritativeRoomClient, createCountdown, createRoomEntryController,
  createPresentationTimeline, createSessionStore, createSpectatorUi, escapeHtml, renderConnectionStatus, renderCountdown, serverNow, setHidden,
  setModeVisibility
} from "/shared/client/index.js";
import {
  ACTION_SECONDS, CAPTURE_ANIMATION_MS, PLACE_ANIMATION_MS, REVEAL_MS, ROW_LIMIT, TURN_END_MS, bullheads, rowBullheads
} from "./rules.mjs";
import { createGame6PartitionRenderer, createGame6RenderModel } from "./render-partitions.mjs";

const PROTOCOL_VERSION = 3;
const $ = (id) => document.getElementById(id);
const E = Object.fromEntries([
  "siteHeader","connectionStatus","roomHeaderTools","setupPanel","roomPanel","hostModeButton","guestModeButton","hostSetup",
  "guestSetup","hostNameInput","guestNameInput","playerCountSelect","createRoomButton",
  "joinRoomButton","roomCodeInput","joinIntentField","roomCodeDisplay","hostTools","roomPlayerCountSelect",
  "spectatorSettingButton","seatActionButton",
  "startGameButton","endGameButton","playerCountBadge","playerList","notice","roundBadge",
  "turnBadge","revealPanel","revealProgress","revealedPlays","rows","turnConsole","actionTitle","actionArea","timerText","timerBar","handCount","hand",
  "turnHandPanel","selectionState","logList","toggleLogButton","spectatorPanel","spectatorCountBadge","spectatorList",
  "boardPanel","presentationEffects","presentationTrail","presentationAnnouncement","presentationLabel","presentationText"
].map((id) => [id,$(id)]));

let mode = "host";
let view = null;
let spectatorUi = null;
let presentation = null;
let partitionRenderer = null;
const sessions = createSessionStore({gameId:"bullheads"});
const countdown = createCountdown({
  onTick(value) { renderCountdown({textElement:E.timerText,barElement:E.timerBar},value); }
});
const room = createAuthoritativeRoomClient({
  protocolVersion:PROTOCOL_VERSION,
  sessionStore:sessions,
  onStatus(status) { renderConnectionStatus(E.connectionStatus,status,room.snapshot().roomCode); },
  handlers:{
    onView(nextView) { view = nextView; enterRoom(); render(); presentation?.sync(nextView.presentationEvents); },
    onKicked() { spectatorUi?.handleSessionEnded("kicked"); },
    onRoomExpired() { spectatorUi?.handleSessionEnded("room_expired"); }
  }
});

spectatorUi = createSpectatorUi({
  room,
  getView:() => view,
  elements:{
    joinIntentField:E.joinIntentField,
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
const roomEntry=createRoomEntryController({room,spectatorUi,elements:{root:E.setupPanel,hostModeButton:E.hostModeButton,guestModeButton:E.guestModeButton,hostSetup:E.hostSetup,guestSetup:E.guestSetup,hostTools:E.hostTools,hostNameInput:E.hostNameInput,guestNameInput:E.guestNameInput,roomCodeInput:E.roomCodeInput,createRoomButton:E.createRoomButton,joinRoomButton:E.joinRoomButton,connectionStatus:E.connectionStatus},buildCreatePayload:()=>({capacity:Number(E.playerCountSelect.value)}),formatError:(kind,error)=>kind==="create"?`创建房间失败：${error.message}\n请确认已通过 node game6/signal-server.js 启动。`:`加入房间失败：${error.message}`});

function enterRoom() {
  setHidden(E.setupPanel,true);
  setHidden(E.roomPanel,false);
  setHidden(E.roomHeaderTools,false);
  E.siteHeader.classList.add("in-room");
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

function bullheadMarks(points, compact) {
  return compact && points > 1 ? `🐂×${points}` : "🐂".repeat(points);
}

function cardHtml(number, options={}) {
  const points = bullheads(number);
  const classes = ["number-card",points >= 5 ? "danger-card" : "",options.selected ? "selected" : "",options.ending ? "row-ending" : ""].filter(Boolean).join(" ");
  const marks = bullheadMarks(points, options.row);
  const content = `<strong>${number}</strong><small>${marks}</small>`;
  if (!options.button) return `<div class="${classes}">${content}</div>`;
  return `<button class="${classes}" data-card="${number}" ${options.disabled ? "disabled" : ""}>${content}</button>`;
}

function playerName(playerId) {
  return view.players.find((player) => player.id === playerId)?.name || "玩家";
}

function renderRevealedPlays(model) {
  const current=model.view,plays = current.revealedPlays || [];
  setHidden(E.revealPanel,!plays.length);
  if (!plays.length) {
    E.revealedPlays.innerHTML = "";
    E.revealProgress.textContent = "";
    return;
  }
  const completed = plays.filter((play) => play.status === "done").length;
  E.revealProgress.textContent = current.phase === "revealing"
    ? "全部出牌已公开"
    : `${completed} / ${plays.length} 已放置`;
  const existing=new Map([...E.revealedPlays.querySelectorAll("[data-animation-source]")].map((node)=>[node.dataset.animationSource,node])),retained=new Set();plays.forEach((play,index)=>{const id=`${play.playerId}:${play.card}`;let node=existing.get(id);if(!node){node=document.createElement("div");node.dataset.animationSource=id;node.innerHTML=`<span class="revealed-owner"></span>${cardHtml(play.card)}<span class="revealed-state"></span>`;}retained.add(id);node.className=`revealed-play status-${play.status}`;node.style.setProperty("--player-accent",String((index*47+112)%360));node.querySelector(".revealed-owner").textContent=playerName(play.playerId);node.querySelector(".revealed-state").textContent=({waiting:"等待",active:"放置中",choosing:"选择牌列",done:"已放置"}[play.status]||"等待");const at=E.revealedPlays.children[index];if(at!==node)E.revealedPlays.insertBefore(node,at||null);});[...E.revealedPlays.querySelectorAll("[data-animation-source]")].forEach((node)=>{if(!retained.has(node.dataset.animationSource))node.remove();});
}

function renderPlayers(model) {
  const current=model.view,existing=new Map([...E.playerList.querySelectorAll("[data-player-panel]")].map((node)=>[node.dataset.playerPanel,node])),retained=new Set();current.players.forEach((player,index)=>{let node=existing.get(String(player.id));if(!node){node=document.createElement("div");node.dataset.playerPanel=String(player.id);node.innerHTML='<div class="player-top"><span data-name></span><b data-score></b></div><div class="player-meta" data-meta></div><div class="captured" data-captured></div><button class="hidden" data-kick type="button">移出</button>';node.querySelector("[data-kick]").onclick=()=>kickPlayer(node.dataset.playerPanel);}retained.add(String(player.id));const collecting=current.animation?.type==="captureAndPlace"&&current.animation.playerId===player.id;node.className=`player ${current.pendingPlayerId===player.id?"current":""} ${collecting?"score-pulse":""}`;node.querySelector("[data-name]").textContent=`${player.name}${player.isHost?" 👑":""}`;node.querySelector("[data-score]").textContent=`🐂 ${player.score}`;const selected=current.phase==="selecting"?(player.hasSelected?"已选牌":"选择中"):`${player.hand.length} 张手牌`,winner=current.winners.includes(player.id)?" · 获胜者":"";node.querySelector("[data-meta]").textContent=`${selected}${winner}${player.connected?"":" · 已离线"}`;const captured=node.querySelector("[data-captured]"),capturedKey=JSON.stringify(player.captured);if(captured.dataset.key!==capturedKey){captured.innerHTML=player.captured.map((card)=>`<span class="mini">${card} · ${bullheads(card)}🐂</span>`).join("");captured.dataset.key=capturedKey;}setHidden(node.querySelector("[data-kick]"),!current.permissions?.canKick||player.isHost);const at=E.playerList.children[index];if(at!==node)E.playerList.insertBefore(node,at||null);});[...E.playerList.querySelectorAll("[data-player-panel]")].forEach((node)=>{if(!retained.has(node.dataset.playerPanel))node.remove();});
}

function renderRows(model) {
  const current = model.view;
  const canChoose = Boolean(current.permissions?.canChooseRow);
  current.rows.forEach((row, index) => {
    let node = E.rows.children[index];
    if (!node) {
      node = document.createElement("div");
      node.dataset.row = String(index);
      node.onclick = () => {
        if (view.permissions?.canChooseRow) submit({type: "chooseRow", rowIndex: index});
      };
      node.onkeydown = (event) => {
        if (view.permissions?.canChooseRow && ["Enter", " "].includes(event.key)) {
          event.preventDefault();
          node.click();
        }
      };
      E.rows.append(node);
    }
    const animation = current.animation?.rowIndex === index ? current.animation : null;
    const capture = animation?.type === "captureAndPlace";
    const full = row.length === ROW_LIMIT;
    const key = JSON.stringify([row, capture && animation.playerId, capture && animation.points]);
    if (node.dataset.contentKey !== key) {
      const points = rowBullheads(row);
      const cards = row.map((card, i) => cardHtml(card, {row: true, ending: i === row.length - 1})).join("");
      const slots = '<span class="row-slot-empty" aria-hidden="true"></span>'.repeat(ROW_LIMIT - row.length);
      node.innerHTML = `<div class="row-label"><b>第${index + 1}列</b><span>${row.length}/${ROW_LIMIT} 张</span>${full ? "" : `<strong>${points} 牛头</strong>`}</div>${cards}${slots}`;
      if (capture) {
        node.insertAdjacentHTML("beforeend", `<div class="capture-preview"><span>${escapeHtml(playerName(animation.playerId))} 收列</span><b>+${animation.points} 牛头</b></div>`);
      } else if (full) {
        node.insertAdjacentHTML("beforeend", `<div class="row-warning"><span>再接就收</span><strong>${points} 牛头</strong></div>`);
      }
      node.dataset.contentKey = key;
    }
    node.className = ["card-row", full && "is-full", canChoose && "choice", animation && "animation-target", capture && "will-capture"].filter(Boolean).join(" ");
    if (canChoose) {
      node.setAttribute("role", "button");
      node.tabIndex = 0;
      node.setAttribute("aria-label", `收走第${index + 1}列，末张 ${row.at(-1)}，${rowBullheads(row)} 牛头`);
    } else {
      node.removeAttribute("role");
      node.removeAttribute("tabindex");
      node.removeAttribute("aria-label");
    }
  });
  while (E.rows.children.length > current.rows.length) E.rows.lastElementChild.remove();
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
    E.actionArea.textContent = view.permissions?.canChooseRow ? "直接点击桌面上的任意一列。" : `该玩家有 ${ACTION_SECONDS} 秒进行选择。`;
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
  const landing = targetRow?.querySelector(animation.type === "captureAndPlace" ? ".number-card" : ".row-slot-empty");
  if (!source || !landing) return;
  const sourceBox = source.getBoundingClientRect();
  const destination = landing.getBoundingClientRect();
  const total = Math.max(1,animation.endsAt-animation.startedAt);
  const remaining = Math.max(0,animation.endsAt-serverNow());
  const progress = Math.max(0,Math.min(1,1-remaining/total));
  const deltaX = destination.left-sourceBox.left;
  const deltaY = destination.top-sourceBox.top;
  const flying = source.cloneNode(true);
  flying.classList.add("flying-card","table-animation-card");
  flying.querySelector("small").textContent = bullheadMarks(bullheads(animation.card), true);
  Object.assign(flying.style,{
    left:`${sourceBox.left}px`,top:`${sourceBox.top}px`,width:`${destination.width}px`,height:`${destination.height}px`,
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
      left:`${start.left}px`,top:`${start.top}px`,width:`${start.width}px`,height:`${start.height}px`,
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

function renderRoom(model){const current=model.view;setHidden(E.hostTools,!current.permissions?.canManage);setHidden(E.startGameButton,!current.permissions?.canStart);setHidden(E.endGameButton,!current.permissions?.canEnd);E.startGameButton.textContent=current.phase==="roundEnd"?"开始下一局":"开始游戏";E.startGameButton.disabled=current.phase==="lobby"&&(current.players.length!==current.capacity||current.players.some((player)=>!player.connected));E.roomPlayerCountSelect.value=String(current.capacity);E.roomPlayerCountSelect.disabled=!current.permissions?.canSetCapacity;E.roomCodeDisplay.textContent=model.roomCode;E.playerCountBadge.textContent=`${current.players.length} / ${current.capacity}`;}
function renderStatus(model){E.roundBadge.textContent=`第 ${model.view.round} 局`;E.turnBadge.textContent=`第 ${model.view.turn} / 10 回合`;renderNotice();}
function renderDecision(model){E.turnConsole.dataset.phase=model.view.phase;renderAction(model.me,model.memberRole);}
function bindHandCard(node){node.onclick=()=>submit({type:"selectCard",card:Number(node.dataset.card)});}
function renderHand(model){const current=model.view,me=model.me;E.handCount.textContent=me?.hand.length||0;E.turnConsole.dataset.handExpanded=String(Boolean(model.memberRole==="player"&&current.phase==="selecting"&&!me?.hasSelected&&current.permissions?.canSelect));setHidden(E.turnHandPanel,model.memberRole==="spectator");if(model.memberRole==="spectator")return;const existing=new Map([...E.hand.querySelectorAll("[data-card]")].map((node)=>[node.dataset.card,node])),retained=new Set();(me?.hand||[]).forEach((card,index)=>{const id=String(card);let node=existing.get(id);if(!node){const template=document.createElement("template");template.innerHTML=cardHtml(card,{button:true,disabled:!current.permissions?.canSelect,selected:me.selectedCard===card});node=template.content.firstElementChild;bindHandCard(node);}retained.add(id);node.disabled=!current.permissions?.canSelect;node.classList.toggle("selected",me.selectedCard===card);const at=E.hand.children[index];if(at!==node)E.hand.insertBefore(node,at||null);});[...E.hand.querySelectorAll("[data-card]")].forEach((node)=>{if(!retained.has(node.dataset.card))node.remove();});E.selectionState.textContent=model.memberRole==="player"&&current.phase==="selecting"?(me?.hasSelected?"已锁定，等待其他玩家":"请选择一张牌"):"";setHidden(E.selectionState,!E.selectionState.textContent);}
function renderLog(model){E.logList.innerHTML=model.view.logs.map((item)=>`<div class="log-item">${escapeHtml(item.text)}</div>`).join("");}
function renderCountdownPartition(model){if(model.view.deadline)countdown.start(model.view.deadline,countdownDuration());else{countdown.stop();E.timerText.textContent="--";E.timerBar.style.width="0";}}
function renderAnimation(){playPlacementAnimation();}

function render() {
  if (!view) return;
  const spectatorModel = spectatorUi.render(view);
  const memberRole = spectatorModel.memberRole;
  const model=createGame6RenderModel(view,{memberRole,roomCode:room.snapshot().roomCode});
  partitionRenderer??=createGame6PartitionRenderer({room:renderRoom,status:renderStatus,players:renderPlayers,reveal:renderRevealedPlays,rows:renderRows,decision:renderDecision,hand:renderHand,log:renderLog,countdown:renderCountdownPartition,animation:renderAnimation});partitionRenderer.render(model);
}

function playerPanel(playerId) {
  if (!playerId) return null;
  return [...E.playerList.querySelectorAll("[data-player-panel]")]
    .find((element) => element.dataset.playerPanel === String(playerId)) || null;
}

function revealedCard(event) {
  if (!event?.actorId || !Number.isInteger(Number(event.card))) return null;
  return [...E.revealedPlays.querySelectorAll("[data-animation-source]")]
    .find((element) => element.dataset.animationSource === `${event.actorId}:${event.card}`)
    ?.querySelector(".number-card") || null;
}

function rowElement(rowIndex) {
  return Number.isInteger(Number(rowIndex)) ? E.rows.querySelector(`[data-row="${Number(rowIndex)}"]`) : null;
}

function presentationSource(event) {
  if (["card-place","row-capture","row-choice"].includes(event.kind)) return revealedCard(event) || E.revealPanel;
  if (event.kind === "selection-locked") return playerPanel(event.actorId) || E.turnConsole;
  if (event.kind === "game-result") return playerPanel(event.actorId) || E.boardPanel;
  return event.kind === "cards-revealed" ? E.revealPanel : E.boardPanel;
}

function presentationTarget(event) {
  if (["card-place","row-capture"].includes(event.kind)) return rowElement(event.rowIndex) || E.rows;
  if (event.kind === "row-choice") return playerPanel(event.actorId) || E.rows;
  if (event.kind === "selection-locked") return E.turnConsole;
  if (event.kind === "game-result") return playerPanel(event.actorId) || E.boardPanel;
  return event.kind === "cards-revealed" ? E.rows : E.boardPanel;
}

function presentationLabel(kind) {
  return ({
    "selection-locked":"秘密选牌",
    "cards-revealed":"全员亮牌",
    "card-place":"依序入列",
    "row-choice":"等待选列",
    "row-capture":"收列罚分",
    "turn-start":"下一回合",
    "round-start":"新一局",
    "round-end":"本局结束",
    "game-result":"整场结算"
  })[kind] || "牌桌动态";
}

function pointInPresentation(element) {
  if (!element || !E.presentationEffects) return null;
  const rect = element.getBoundingClientRect();
  const stage = E.presentationEffects.getBoundingClientRect();
  return {x:rect.left + rect.width / 2 - stage.left,y:rect.top + rect.height / 2 - stage.top};
}

function playPresentationEvent(event) {
  const source = presentationSource(event);
  const target = presentationTarget(event);
  const scoreTarget = event.kind === "row-capture" ? playerPanel(event.actorId) : null;
  source?.classList.add("presentation-source");
  target?.classList.add("presentation-target");
  scoreTarget?.classList.add("presentation-score-target");
  const revealed = event.kind === "cards-revealed" ? [...E.revealedPlays.children] : [];
  for (const element of revealed) element.classList.add("presentation-reveal");

  let token = null;
  if (!["card-place","row-capture"].includes(event.kind)) {
    token = document.createElement("span");
    token.className = `presentation-token presentation-token-${event.kind}`;
    token.textContent = ({"selection-locked":"✓","cards-revealed":"亮","row-choice":"?","game-result":"★","round-start":String(event.round || 1),"round-end":"✓","turn-start":"→"})[event.kind] || "→";
    const from = pointInPresentation(source);
    const to = pointInPresentation(target);
    if (from && to) {
      token.style.setProperty("--from-x",`${from.x}px`);
      token.style.setProperty("--from-y",`${from.y}px`);
      token.style.setProperty("--to-x",`${to.x}px`);
      token.style.setProperty("--to-y",`${to.y}px`);
    }
    E.presentationEffects?.append(token);
  }
  return () => {
    source?.classList.remove("presentation-source");
    target?.classList.remove("presentation-target");
    scoreTarget?.classList.remove("presentation-score-target");
    for (const element of revealed) element.classList.remove("presentation-reveal");
    token?.remove();
  };
}

presentation = createPresentationTimeline({
  container:E.presentationEffects,
  trailPath:E.presentationTrail,
  announcement:E.presentationAnnouncement,
  labelElement:E.presentationLabel,
  textElement:E.presentationText,
  effectsElement:E.presentationEffects,
  resolveSource:presentationSource,
  resolveTarget:presentationTarget,
  labelFor:(event) => presentationLabel(event.kind),
  beforePlay:playPresentationEvent,
  durationMs:1250,
  reducedDurationMs:520,
  maxQueue:20,
  sceneKey:(event) => event.sceneId || event.id,
  priorityFor:(event) => Number(event.priority) || 0,
  catchUpThreshold:2,
  severeBacklogThreshold:5,
  catchUpDurationMs:580,
  severeDurationMs:300,
  urgentPriority:4,
  retainPriority:3
});

function endGame() {
  if (confirm("确定结束当前游戏并返回准备阶段吗？所有累计分数将被清空。")) submit({type:"end"});
}

async function init() {
  roomEntry.bind();
  spectatorUi.bind();
  E.roomPlayerCountSelect.addEventListener("change",() => submit({type:"setCapacity",capacity:Number(E.roomPlayerCountSelect.value)}));
  E.startGameButton.addEventListener("click",() => submit({type:"start"}));
  E.endGameButton.addEventListener("click",endGame);
  E.toggleLogButton.addEventListener("click",() => E.logList.classList.toggle("collapsed"));
  selectMode("host");
  try { spectatorUi.applyConfig(await room.checkServer()); } catch { /* create/join presents the detailed error */ }
}

init();
