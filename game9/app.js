"use strict";

import {
  bindRoomCodeInput,
  cleanPlayerName,
  createAuthoritativeRoomClient,
  createCountdown,
  createLogEntry,
  createSessionStore,
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
let serverConfig = { spectatorsEnabled: false, spectatorLimit: 10 };
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
      alert("你已被房主移出房间。");
      location.reload();
    },
    onRoomExpired() {
      alert("房间长时间没有正式玩家在线，已经自动关闭。");
      location.reload();
    }
  }
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
    const intent = document.querySelector('input[name="joinIntent"]:checked')?.value || "play";
    const result = await room.joinRoom({
      code: E.roomCodeInput.value,
      name: E.guestNameInput.value,
      intent
    });
    if (result.autoSpectated) {
      const reason = result.assignmentReason === "game_in_progress" ? "游戏已经开始" : "玩家席已满";
      alert(`${reason}，你已进入旁观席。`);
    }
    E.connectionStatus.textContent = result.resumed
      ? `身份已恢复：${result.memberRole === "spectator" ? "旁观者" : "玩家"}`
      : result.memberRole === "spectator" ? "已进入旁观席" : "已加入玩家席";
  } catch (error) {
    alert(`加入房间失败：${error.message}`);
  } finally {
    E.joinRoomButton.disabled = false;
  }
}

async function kickMember(memberId, memberName, memberRole = "player") {
  if (memberRole === "player" && view?.phase !== "lobby") return alert("游戏开始后不能移出正式玩家。");
  if (!confirm(`确定将 ${memberName} 移出房间吗？`)) return;
  try {
    await room.kick(memberId);
  } catch (error) {
    alert(`移出失败：${error.message}`);
  }
}

async function changeSeat() {
  const currentRole = view?.roomRole || room.snapshot().memberRole;
  const intent = currentRole === "spectator" ? "play" : "spectate";
  if (intent === "spectate" && !confirm("转入旁观席后将不计入开局人数，确定继续吗？")) return;
  E.seatActionButton.disabled = true;
  try {
    await room.changeSeat(intent);
  } catch (error) {
    alert(`切换座位失败：${error.message}`);
  } finally {
    E.seatActionButton.disabled = false;
  }
}

async function toggleSpectatorSetting() {
  if (!view?.permissions?.canManage) return;
  E.spectatorSettingButton.disabled = true;
  try {
    await room.setRoomSettings({ allowSpectators: !view.allowSpectators });
  } catch (error) {
    alert(`修改旁观设置失败：${error.message}`);
  } finally {
    E.spectatorSettingButton.disabled = false;
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
  const memberRole = view.roomRole || room.snapshot().memberRole || "player";
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

  E.roomRoleBanner.dataset.role = memberRole;
  E.roomRoleTitle.textContent = memberRole === "spectator" ? "你正在旁观" : "你在玩家席";
  E.roomRoleHint.textContent = memberRole === "spectator"
    ? "你只能看到公开信息，不参与行动、计分和胜负"
    : "你是本局正式玩家，会计入开局人数";
  const canChangeNow = view.phase === "lobby";
  const isHost = room.snapshot().role === "host";
  const spectatorSeatFull = view.spectatorCount >= view.spectatorLimit;
  const playerSeatFull = view.players.length >= view.capacity;
  const showSeatAction = canChangeNow && (memberRole === "spectator" || !isHost);
  setHidden(E.seatActionButton, !showSeatAction);
  E.seatActionButton.textContent = memberRole === "spectator" ? "进入玩家席" : "转入旁观席";
  E.seatActionButton.disabled = memberRole === "spectator"
    ? playerSeatFull
    : !view.allowSpectators || spectatorSeatFull;
  E.seatActionButton.title = E.seatActionButton.disabled
    ? memberRole === "spectator" ? "玩家席已满" : "旁观席未开放或人数已满"
    : "";
  setHidden(E.spectatorSettingButton, !serverConfig.spectatorsEnabled || !view.permissions?.canManage);
  setHidden(E.spectatorPanel, !serverConfig.spectatorsEnabled && !(view.spectatorCount > 0));
  E.spectatorSettingButton.textContent = view.allowSpectators ? "旁观：开放" : "旁观：关闭";
  E.spectatorSettingButton.setAttribute("aria-pressed", String(Boolean(view.allowSpectators)));

  E.playerList.innerHTML = view.players.map((player, index) => `
    <article class="player-item ${player.id === view.selfId ? "player-self" : ""} ${!player.connected ? "player-offline" : ""} ${view.phase === "playing" && index === view.currentIndex ? "player-current" : ""}">
      <div><span class="status-dot"></span><b>${escapeHtml(player.name)}</b>${player.isHost ? '<em>房主</em>' : ""}</div>
      <div class="player-stats"><span>${player.cards.length} 张牌</span><span>牌面 ${player.cardScore}</span><span>${player.chips == null ? "筹码 ?" : `筹码 ${player.chips}`}</span></div>
      <div class="public-card-runs" aria-label="${escapeHtml(player.name)}的公开数字牌">${cardRunsHtml(player.cards)}</div>
      ${view.permissions?.canKick && !player.isHost ? `<button type="button" data-kick-player="${escapeHtml(player.id)}">移出</button>` : ""}
    </article>`).join("");
  E.playerList.querySelectorAll("[data-kick-player]").forEach((button) => {
    const player = view.players.find((item) => item.id === button.dataset.kickPlayer);
    button.onclick = () => player && kickMember(player.id, player.name, "player");
  });

  E.spectatorCountBadge.textContent = `${view.spectatorCount || 0} / ${view.spectatorLimit || serverConfig.spectatorLimit}`;
  E.spectatorList.innerHTML = view.spectators?.length ? view.spectators.map((spectator) => `
    <article class="spectator-item ${spectator.connected ? "" : "spectator-offline"}">
      <div><span class="status-dot"></span><b>${escapeHtml(spectator.name)}</b></div>
      ${view.permissions?.canManage ? `<button type="button" data-kick-spectator="${escapeHtml(spectator.id)}">移出</button>` : ""}
    </article>`).join("") : '<p class="muted">暂无旁观者</p>';
  E.spectatorList.querySelectorAll("[data-kick-spectator]").forEach((button) => {
    const spectator = view.spectators.find((item) => item.id === button.dataset.kickSpectator);
    button.onclick = () => spectator && kickMember(spectator.id, spectator.name, "spectator");
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
  E.seatActionButton.onclick = changeSeat;
  E.spectatorSettingButton.onclick = toggleSpectatorSetting;
  E.roomPlayerCountSelect.onchange = changeCapacity;
  E.startGameButton.onclick = startGame;
  E.endGameButton.onclick = endGameEarly;
  E.playAgainButton.onclick = playAgain;
  E.toggleLogButton.onclick = () => {
    E.logList.classList.toggle("collapsed");
    E.toggleLogButton.textContent = E.logList.classList.contains("collapsed") ? "展开" : "收起";
  };
  if (matchMedia("(max-width: 720px)").matches) E.spectatorPanel.removeAttribute("open");
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
    serverConfig = await room.checkServer();
    setHidden(E.joinIntentField, !serverConfig.spectatorsEnabled);
  }
  catch { E.connectionStatus.title = "请运行 node game9/signal-server.js"; }
}

init();
