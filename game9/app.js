"use strict";

import {
  bindRoomCodeInput,
  cleanPlayerName,
  createAuthoritativeRoomClient,
  createCountdown,
  createLogEntry,
  createSessionStore,
  createSpectatorUi,
  escapeHtml,
  renderConnectionStatus,
  renderCountdown,
  setHidden,
  setModeVisibility
} from "/shared/client/index.js";
import { cardScore } from "./rules.js";

const PROTOCOL_VERSION = 3;
const ACTION_SECONDS = 30;
const $ = (id) => document.getElementById(id);
const E = Object.fromEntries([
  "connectionStatus", "setupPanel", "roomPanel", "hostModeButton", "guestModeButton", "hostSetup",
  "guestSetup", "hostNameInput", "guestNameInput", "playerCountSelect", "createRoomButton",
  "joinRoomButton", "roomCodeInput", "joinIntentField", "roomCodeDisplay", "hostTools", "roomPlayerCountSelect",
  "spectatorSettingButton", "roomRoleBanner", "roomRoleTitle", "roomRoleHint", "seatActionButton",
  "startGameButton", "endGameButton", "playerCountBadge", "playerList", "phaseBadge", "deckCount",
  "notice", "activeCard", "potCount", "timerText", "timerBar", "actionArea", "logList",
  "toggleLogButton", "spectatorPanel", "spectatorCountBadge", "spectatorList", "myArea",
  "myChips", "myCardScore", "myNetScore", "myCards", "resultPanel",
  "winnerText", "scoreTable", "removedCards", "resultActions", "playAgainButton"
].map((id) => [id, $(id)]));

let mode = "host";
let view = null;
let spectatorUi = null;
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
    roomRoleBanner: E.roomRoleBanner,
    roomRoleTitle: E.roomRoleTitle,
    roomRoleHint: E.roomRoleHint,
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
  setHidden(E.hostTools, !view?.permissions?.canManage);
  E.roomCodeDisplay.textContent = room.snapshot().roomCode;
}

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
    deadline: Date.now() + ACTION_SECONDS * 1000,
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

function render() {
  if (!view) return;
  const spectatorModel = spectatorUi.render(view);
  const memberRole = spectatorModel.memberRole;
  const me = view.players.find((player) => player.id === view.selfId);
  const current = view.players[view.currentIndex];
  const myTurn = memberRole === "player" && view.phase === "playing" && current?.id === view.selfId;

  E.roomCodeDisplay.textContent = room.snapshot().roomCode;
  E.roomPlayerCountSelect.value = String(view.capacity);
  E.roomPlayerCountSelect.disabled = view.phase !== "lobby" || !view.permissions?.canManage;
  E.playerCountBadge.textContent = `${view.players.length} / ${view.capacity}`;
  E.startGameButton.disabled = view.phase !== "lobby" || view.players.length !== view.capacity || view.players.some((p) => !p.connected);
  setHidden(E.startGameButton, !view.permissions?.canStart);
  setHidden(E.endGameButton, !view.permissions?.canEnd);
  E.phaseBadge.textContent = { lobby: "准备阶段", playing: "游戏进行中", ended: "结算完成" }[view.phase];
  E.deckCount.textContent = String(view.deckCount);
  E.potCount.textContent = String(view.pot);
  E.activeCard.textContent = view.activeCard ?? "—";
  E.activeCard.classList.toggle("empty", view.activeCard == null);
  E.activeCard.style.setProperty("--tilt", `${((Number(view.activeCard) || 0) % 7) - 3}deg`);

  E.playerList.innerHTML = view.players.map((player, index) => `
    <article class="player-item ${player.id === view.selfId ? "player-self" : ""} ${!player.connected ? "player-offline" : ""} ${view.phase === "playing" && index === view.currentIndex ? "player-current" : ""}">
      <div><span class="status-dot"></span><b>${escapeHtml(player.name)}</b>${player.isHost ? '<em>房主</em>' : ""}</div>
      <div class="player-stats"><span>${player.cards.length} 张牌</span><span>牌面 ${player.cardScore}</span><span>${player.chips == null ? "筹码 ?" : `筹码 ${player.chips}`}</span></div>
      <div class="public-card-runs" aria-label="${escapeHtml(player.name)}的公开数字牌">${cardRunsHtml(player.cards)}</div>
      ${view.permissions?.canKick && !player.isHost ? `<button type="button" data-kick-player="${escapeHtml(player.id)}">移出</button>` : ""}
    </article>`).join("");
  E.playerList.querySelectorAll("[data-kick-player]").forEach((button) => {
    const player = view.players.find((item) => item.id === button.dataset.kickPlayer);
    button.onclick = () => player && kickPlayer(player.id, player.name);
  });

  if (memberRole === "spectator" && view.phase === "lobby") E.notice.textContent = "你正在旁观准备阶段，可在有空位时主动进入玩家席";
  else if (view.phase === "lobby") E.notice.textContent = `等待 ${view.capacity} 位玩家到齐后，由房主开始游戏`;
  else if (view.phase === "ended") E.notice.textContent = "所有数字牌都已被拿走，本局结算完成";
  else if (myTurn) E.notice.textContent = me.chips > 0 ? "轮到你：拿下数字牌，或支付一枚筹码拒绝" : "你没有筹码，只能拿下这张牌";
  else E.notice.textContent = `${memberRole === "spectator" ? "旁观中 · " : ""}等待 ${current?.name} 决定是否接受 ${view.activeCard}`;

  E.actionArea.innerHTML = "";
  if (myTurn) {
    const take = document.createElement("button");
    take.className = "take-action";
    take.innerHTML = `<span>拿下 ${view.activeCard}</span><small>${view.pot ? `同时获得 ${view.pot} 枚筹码` : "接受这张数字牌"}</small>`;
    take.onclick = () => submit({ type: "take" });
    const pass = document.createElement("button");
    pass.className = "pass-action";
    pass.disabled = me.chips <= 0;
    pass.innerHTML = `<span>不，谢谢！</span><small>${me.chips > 0 ? "支付 1 枚筹码" : "没有筹码，无法拒绝"}</small>`;
    pass.onclick = () => submit({ type: "pass" });
    E.actionArea.append(take, pass);
  } else if (memberRole === "spectator") {
    E.actionArea.innerHTML = '<p class="spectator-action-note">旁观模式不会显示游戏操作按钮</p>';
  }

  setHidden(E.myArea, memberRole === "spectator");
  E.myChips.textContent = me?.chips ?? "?";
  E.myCardScore.textContent = String(me?.cardScore ?? 0);
  E.myNetScore.textContent = me?.chips == null ? "?" : String(me.cardScore - me.chips);
  E.myCards.innerHTML = cardRunsHtml(me?.cards);
  E.logList.innerHTML = view.logs.map((entry) => `<p>${escapeHtml(entry.text)}</p>`).join("") || '<p class="muted">暂无记录</p>';

  if (view.phase === "playing" && view.deadline) countdown.start(view.deadline, ACTION_SECONDS * 1000);
  else {
    countdown.stop();
    E.timerText.textContent = "--";
    E.timerBar.style.width = "0";
  }

  setHidden(E.resultPanel, view.phase !== "ended");
  setHidden(E.resultActions, !view.permissions?.canRestart);
  if (view.phase === "ended") {
    const winners = view.winners.map((id) => view.players.find((player) => player.id === id)?.name).join("、");
    E.winnerText.textContent = `${winners} 获胜！`;
    E.scoreTable.innerHTML = [...view.players].sort((a, b) => a.finalScore - b.finalScore).map((player, index) => `
      <div class="score-row ${view.winners.includes(player.id) ? "winner" : ""}">
        <b>${index + 1}</b><span>${escapeHtml(player.name)}</span>
        <span>牌面 ${player.cardScore}</span><span>筹码 −${player.chips}</span><strong>${player.finalScore} 分</strong>
      </div>`).join("");
    E.removedCards.innerHTML = view.removed.map((card) => `<span>${card}</span>`).join("");
  }
}

async function init() {
  bindRoomCodeInput(E.roomCodeInput);
  E.hostModeButton.onclick = () => {
    mode = "host";
    setModeVisibility(mode, E);
  };
  E.guestModeButton.onclick = () => {
    mode = "guest";
    setModeVisibility(mode, E);
  };
  E.createRoomButton.onclick = createGameRoom;
  E.joinRoomButton.onclick = joinGameRoom;
  spectatorUi.bind();
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
