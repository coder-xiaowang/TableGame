"use strict";

import {
  bindRoomCodeInput,
  cleanPlayerName,
  createCountdown,
  createHostTimer,
  createLogEntry,
  createRoomClient,
  createSessionStore,
  escapeHtml,
  prependLimited,
  renderConnectionStatus,
  renderCountdown,
  setHidden,
  setModeVisibility,
  shuffle
} from "/shared/client/index.js";
import { cardScore, finalScore, startingChips } from "./rules.js";

const PROTOCOL_VERSION = 2;
const ACTION_SECONDS = 30;
const $ = (id) => document.getElementById(id);
const E = Object.fromEntries([
  "connectionStatus", "setupPanel", "roomPanel", "hostModeButton", "guestModeButton", "hostSetup",
  "guestSetup", "hostNameInput", "guestNameInput", "playerCountSelect", "createRoomButton",
  "joinRoomButton", "roomCodeInput", "roomCodeDisplay", "hostTools", "roomPlayerCountSelect",
  "startGameButton", "endGameButton", "playerCountBadge", "playerList", "phaseBadge", "deckCount",
  "notice", "activeCard", "potCount", "timerText", "timerBar", "actionArea", "logList",
  "toggleLogButton", "myChips", "myCardScore", "myNetScore", "myCards", "resultPanel",
  "winnerText", "scoreTable", "removedCards", "resultActions", "playAgainButton"
].map((id) => [id, $(id)]));

let mode = "host";
let state = null;
let guestView = null;
const sessions = createSessionStore({ gameId: "no-thanks" });
const hostTimer = createHostTimer();
const countdown = createCountdown({
  onTick(value) { renderCountdown({ textElement: E.timerText, barElement: E.timerBar }, value); }
});

const room = createRoomClient({
  protocolVersion: PROTOCOL_VERSION,
  sessionStore: sessions,
  onStatus(status) { renderConnectionStatus(E.connectionStatus, status, room.snapshot().roomCode); },
  handlers: {
    onHello: admitPlayer,
    onPresence: updatePresence,
    onAction: applyAction,
    onView(view) {
      guestView = view;
      enterRoom();
      render();
    },
    onRejected(message) {
      alert(message || "房主拒绝了加入请求。");
      location.reload();
    },
    onKicked() {
      alert("你已被房主移出房间。");
      location.reload();
    }
  }
});

function makePlayer(id, name, isHost = false) {
  return { id, name, isHost, connected: true, chips: 0, cards: [] };
}

function makeLobby(capacity, host) {
  return {
    phase: "lobby",
    capacity,
    players: [host],
    deck: [],
    removed: [],
    activeCard: null,
    pot: 0,
    currentIndex: 0,
    deadline: 0,
    winners: [],
    logs: []
  };
}

function log(text) {
  prependLimited(state.logs, createLogEntry(text), 100);
}

function currentPlayer() {
  return state?.players[state.currentIndex] || null;
}

function currentView() {
  return mode === "host" ? (state ? buildView(room.snapshot().playerId) : null) : guestView;
}

function enterRoom() {
  setHidden(E.setupPanel, true);
  setHidden(E.roomPanel, false);
  setHidden(E.hostTools, mode !== "host");
  E.roomCodeDisplay.textContent = room.snapshot().roomCode;
}

async function createGameRoom() {
  const name = cleanPlayerName(E.hostNameInput.value, "房主");
  E.createRoomButton.disabled = true;
  try {
    const result = await room.createRoom({ name });
    state = makeLobby(Number(E.playerCountSelect.value), makePlayer(result.playerId, name, true));
    E.roomPlayerCountSelect.value = String(state.capacity);
    enterRoom();
    render();
  } catch (error) {
    alert(`创建房间失败：${error.message}\n请确认已通过 node game9/signal-server.js 启动。`);
  } finally {
    E.createRoomButton.disabled = false;
  }
}

async function joinGameRoom() {
  E.joinRoomButton.disabled = true;
  try {
    await room.joinRoom({ code: E.roomCodeInput.value, name: E.guestNameInput.value });
    E.connectionStatus.textContent = "已连接，等待房主同步状态";
  } catch (error) {
    alert(`加入房间失败：${error.message}`);
  } finally {
    E.joinRoomButton.disabled = false;
  }
}

function admitPlayer(playerId, payload) {
  if (!state || mode !== "host") return;
  const existing = state.players.find((player) => player.id === playerId);
  if (existing) {
    existing.connected = true;
    return sync();
  }
  if (state.phase !== "lobby") return room.reject(playerId, "游戏已经开始，暂时不能加入新玩家。");
  if (state.players.length >= state.capacity) return room.reject(playerId, "房间人数已满。");
  const name = cleanPlayerName(payload.name, "玩家");
  state.players.push(makePlayer(playerId, name));
  log(`${name} 加入了房间`);
  sync();
}

function updatePresence(playerId, connected) {
  const player = state?.players.find((item) => item.id === playerId);
  if (!player || player.connected === connected) return;
  player.connected = connected;
  log(`${player.name} ${connected ? "重新连接" : "暂时离线"}`);
  sync();
}

async function kickPlayer(playerId) {
  if (state.phase !== "lobby") return alert("游戏开始后不能移出玩家。");
  const player = state.players.find((item) => item.id === playerId);
  if (!player || player.isHost || !confirm(`确定将 ${player.name} 移出房间吗？`)) return;
  try {
    await room.kick(playerId);
    state.players = state.players.filter((item) => item.id !== playerId);
    log(`${player.name} 被移出房间`);
    sync();
  } catch (error) {
    alert(`移出失败：${error.message}`);
  }
}

function changeCapacity() {
  if (!state || state.phase !== "lobby") return;
  const capacity = Number(E.roomPlayerCountSelect.value);
  if (capacity < state.players.length) {
    E.roomPlayerCountSelect.value = String(state.capacity);
    return alert("人数不能少于当前已加入的玩家数。");
  }
  state.capacity = capacity;
  sync();
}

function startGame() {
  if (!state || state.phase !== "lobby") return;
  if (state.players.length !== state.capacity) return alert(`需要 ${state.capacity} 位玩家到齐。`);
  if (state.players.some((player) => !player.connected)) return alert("请等待所有玩家恢复连接后再开始。");
  const cards = shuffle(Array.from({ length: 33 }, (_, index) => index + 3));
  state.removed = cards.splice(0, 9).sort((a, b) => a - b);
  state.deck = cards;
  state.pot = 0;
  state.winners = [];
  state.logs = [];
  const chips = startingChips(state.capacity);
  state.players.forEach((player) => { player.cards = []; player.chips = chips; });
  state.currentIndex = Math.floor(Math.random() * state.players.length);
  state.activeCard = state.deck.pop();
  state.phase = "playing";
  log(`游戏开始，${currentPlayer().name} 首先行动`);
  beginTurn();
}

function resetGameToLobby() {
  hostTimer.clear();
  state.phase = "lobby";
  state.deck = [];
  state.removed = [];
  state.activeCard = null;
  state.pot = 0;
  state.deadline = 0;
  state.winners = [];
  state.logs = [];
  state.players.forEach((player) => { player.cards = []; player.chips = 0; });
  sync();
}

function endGameEarly() {
  if (!state || state.phase !== "playing" || !confirm("确定结束当前游戏并返回大厅吗？")) return;
  resetGameToLobby();
}

function playAgain() {
  if (mode !== "host" || !state || state.phase !== "ended") return;
  resetGameToLobby();
}

function beginTurn() {
  hostTimer.clear();
  if (state.phase !== "playing") return sync();
  state.deadline = hostTimer.schedule(ACTION_SECONDS, () => {
    if (state.phase !== "playing") return;
    const player = currentPlayer();
    log(`${player.name} 行动超时，自动拿下 ${state.activeCard}`);
    takeCard(player, true);
  });
  sync();
}

function applyAction(playerId, action) {
  if (!state || state.phase !== "playing") return;
  const player = currentPlayer();
  if (!player || player.id !== playerId) return;
  if (action?.type === "pass") {
    if (player.chips <= 0) return;
    player.chips -= 1;
    state.pot += 1;
    log(`${player.name} 说了“不，谢谢”，牌上增加 1 枚筹码`);
    state.currentIndex = (state.currentIndex + 1) % state.players.length;
    beginTurn();
  } else if (action?.type === "take") {
    takeCard(player);
  }
}

function takeCard(player, fromTimeout = false) {
  if (state.phase !== "playing" || currentPlayer()?.id !== player.id) return;
  hostTimer.clear();
  const card = state.activeCard;
  const collected = state.pot;
  player.cards.push(card);
  player.cards.sort((a, b) => a - b);
  player.chips += collected;
  log(`${player.name} 拿下 ${card}${collected ? `，并获得 ${collected} 枚筹码` : ""}${fromTimeout ? "（超时）" : ""}`);
  state.pot = 0;
  if (!state.deck.length) return finishGame();
  state.activeCard = state.deck.pop();
  beginTurn();
}

function finishGame() {
  hostTimer.clear();
  state.phase = "ended";
  state.deadline = 0;
  state.activeCard = null;
  const best = Math.min(...state.players.map(finalScore));
  state.winners = state.players.filter((player) => finalScore(player) === best).map((player) => player.id);
  log(`${state.winners.map((id) => state.players.find((player) => player.id === id).name).join("、")} 以 ${best} 分获胜`);
  sync();
}

function buildView(viewerId) {
  const reveal = state.phase === "ended";
  return {
    selfId: viewerId,
    phase: state.phase,
    capacity: state.capacity,
    currentIndex: state.currentIndex,
    activeCard: state.activeCard,
    pot: state.pot,
    deckCount: state.deck.length,
    deadline: state.deadline,
    winners: state.winners,
    removed: reveal ? state.removed : [],
    logs: state.logs,
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      isHost: player.isHost,
      connected: player.connected,
      cards: player.cards,
      cardScore: cardScore(player.cards),
      chips: player.id === viewerId || reveal ? player.chips : null,
      finalScore: reveal ? finalScore(player) : null
    }))
  };
}

function broadcast() {
  if (mode !== "host" || !state) return;
  for (const player of state.players) {
    if (!player.isHost) room.sendView(player.id, buildView(player.id)).catch(() => {});
  }
}

function sync() {
  render();
  broadcast();
}

function submit(action) {
  Promise.resolve(room.submitAction(action)).catch((error) => {
    E.connectionStatus.textContent = `操作发送失败：${error.message}`;
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
    logs: [
      createLogEntry("橘子船长说了“不，谢谢”，牌上增加 1 枚筹码"),
      createLogEntry("薄荷汽水拿下 21，并获得 4 枚筹码"),
      createLogEntry("这是一组用于检查 6–7 人布局的模拟数据")
    ],
    players
  };
}

function render() {
  const view = currentView();
  if (!view) return;
  const me = view.players.find((player) => player.id === view.selfId);
  const current = view.players[view.currentIndex];
  const myTurn = view.phase === "playing" && current?.id === view.selfId;

  E.roomCodeDisplay.textContent = room.snapshot().roomCode;
  E.roomPlayerCountSelect.value = String(view.capacity);
  E.roomPlayerCountSelect.disabled = view.phase !== "lobby";
  E.playerCountBadge.textContent = `${view.players.length} / ${view.capacity}`;
  E.startGameButton.disabled = view.phase !== "lobby" || view.players.length !== view.capacity || view.players.some((p) => !p.connected);
  setHidden(E.startGameButton, view.phase !== "lobby");
  setHidden(E.endGameButton, mode !== "host" || view.phase !== "playing");
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
      ${mode === "host" && view.phase === "lobby" && !player.isHost ? `<button type="button" data-kick="${player.id}">移出</button>` : ""}
    </article>`).join("");
  E.playerList.querySelectorAll("[data-kick]").forEach((button) => {
    button.onclick = () => kickPlayer(button.dataset.kick);
  });

  if (view.phase === "lobby") E.notice.textContent = `等待 ${view.capacity} 位玩家到齐后，由房主开始游戏`;
  else if (view.phase === "ended") E.notice.textContent = "所有数字牌都已被拿走，本局结算完成";
  else if (myTurn) E.notice.textContent = me.chips > 0 ? "轮到你：拿下数字牌，或支付一枚筹码拒绝" : "你没有筹码，只能拿下这张牌";
  else E.notice.textContent = `等待 ${current?.name} 决定是否接受 ${view.activeCard}`;

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
  }

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
  setHidden(E.resultActions, mode !== "host" || view.phase !== "ended");
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
    guestView = createVisualTestView(visualPlayers);
    enterRoom();
    E.roomCodeDisplay.textContent = `TEST-${visualPlayers}`;
    render();
    E.roomCodeDisplay.textContent = `TEST-${visualPlayers}`;
    return;
  }
  try { await room.checkServer(); }
  catch { E.connectionStatus.title = "请运行 node game9/signal-server.js"; }
}

init();
