"use strict";

import {
  bindRoomCodeInput,
  cleanPlayerName,
  createAuthoritativeRoomClient,
  createSessionStore,
  createSpectatorUi,
  escapeHtml,
  renderConnectionStatus,
  setHidden,
  setModeVisibility
} from "/shared/client/index.js";
import { TOPICS, normalizeWord } from "./rules.mjs";

const PROTOCOL_VERSION = 3;
const ROOM_CAPACITY = 32;
const $ = (id) => document.getElementById(id);
const elements = Object.fromEntries([
  "siteHeader", "connectionStatus", "roomHeaderTools", "setupPanel", "roomPanel", "hostModeButton", "guestModeButton",
  "hostSetup", "guestSetup", "hostNameInput", "guestNameInput", "gameModeSelect",
  "topicSelectLabel", "topicSelect", "wordExtraModeLabel", "wordExtraModeSelect",
  "playerWordModeLabel", "playerWordModeSelect", "createRoomButton", "roomCodeInput", "joinIntentField",
  "joinRoomButton", "hostTools", "roomCodeDisplay", "spectatorSettingButton", "seatActionButton", "spectatorPanel", "spectatorCountBadge", "spectatorList", "startGameButton", "endGameButton",
  "playerList", "gameNotice", "wordBoard", "turnTitle", "roundBadge", "actionArea",
  "logPlayerFilter", "logList"
].map((id) => [id, $(id)]));

let mode = "host";
let view = null;
let logPlayerFilter = "all";
let configuringRoom = false;
let spectatorUi = null;
const versionWaiters = new Set();
const sessions = createSessionStore({ gameId: "guess-word" });
const room = createAuthoritativeRoomClient({
  protocolVersion: PROTOCOL_VERSION,
  sessionStore: sessions,
  onStatus(status) {
    renderConnectionStatus(elements.connectionStatus, status, room.snapshot().roomCode);
  },
  handlers: {
    onView(nextView, version) {
      view = nextView;
      for (const waiter of versionWaiters) waiter(version);
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
    joinIntentField:elements.joinIntentField,seatActionButton:elements.seatActionButton,spectatorSettingButton:elements.spectatorSettingButton,
    spectatorPanel:elements.spectatorPanel,spectatorCountBadge:elements.spectatorCountBadge,spectatorList:elements.spectatorList
  },
  notify:(message) => alert(message),confirmAction:(message) => confirm(message),onSessionEnded:() => location.reload()
});

function waitForNewerView(previousVersion, timeoutMs = 2_000) {
  if (room.snapshot().version > previousVersion) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      versionWaiters.delete(check);
      reject(new Error("等待服务器确认房间设置超时"));
    }, timeoutMs);
    function check(version) {
      if (version <= previousVersion) return;
      clearTimeout(timer);
      versionWaiters.delete(check);
      resolve();
    }
    versionWaiters.add(check);
  });
}

async function configureCreatedRoom(action) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const previousVersion = room.snapshot().version;
    try {
      await room.submitAction(action);
      await waitForNewerView(previousVersion);
      return;
    } catch (error) {
      if (attempt === 0 && error.payload?.code === "version_conflict") {
        await waitForNewerView(previousVersion);
        continue;
      }
      throw error;
    }
  }
}

function enterRoom() {
  setHidden(elements.setupPanel, true);
  setHidden(elements.roomPanel, false);
  setHidden(elements.roomHeaderTools, false);
  elements.siteHeader.classList.add("in-room");
  setHidden(elements.hostTools, !view?.permissions?.canManage);
  elements.roomCodeDisplay.textContent = room.snapshot().roomCode;
}

function selectMode(nextMode) {
  mode = nextMode;
  setModeVisibility(mode, {
    hostSetup: elements.hostSetup,
    guestSetup: elements.guestSetup,
    hostTools: elements.hostTools,
    hostButton: elements.hostModeButton,
    guestButton: elements.guestModeButton
  });
}

async function createGameRoom() {
  elements.createRoomButton.disabled = true;
  configuringRoom = true;
  try {
    await room.createRoom({
      name: cleanPlayerName(elements.hostNameInput.value, "房主"),
      capacity: ROOM_CAPACITY
    });
    await configureCreatedRoom({
      type: "configure",
      gameMode: elements.gameModeSelect.value,
      topic: elements.topicSelect.value,
      wordExtraMode: elements.wordExtraModeSelect.value,
      playerWordMode: elements.playerWordModeSelect.value
    });
  } catch (error) {
    alert(`创建房间失败：${error.message}\n请确认已通过 node game/signal-server.js 启动。`);
  } finally {
    configuringRoom = false;
    if (view) render();
    elements.createRoomButton.disabled = false;
  }
}

async function joinGameRoom() {
  elements.joinRoomButton.disabled = true;
  try {
    const result = await room.joinRoom({
      code: elements.roomCodeInput.value,
      name: cleanPlayerName(elements.guestNameInput.value, "玩家"),
      intent:spectatorUi.getJoinIntent()
    });
    elements.connectionStatus.textContent = spectatorUi.handleJoinResult(result).statusText;
  } catch (error) {
    alert(`加入房间失败：${error.message}`);
  } finally {
    elements.joinRoomButton.disabled = false;
  }
}

function submitAction(action) {
  Promise.resolve(room.submitAction(action)).catch((error) => {
    elements.connectionStatus.textContent = `操作失败：${error.message}`;
    alert(error.message);
  });
}

async function kickPlayer(playerId) {
  const player = view?.players.find((item) => item.id === playerId);
  if (!player || player.isHost || !confirm(`确定将 ${player.name} 移出房间吗？`)) return;
  try {
    await room.kick(playerId);
  } catch (error) {
    alert(`移出失败：${error.message}`);
  }
}

function startGame() {
  submitAction({ type: "start" });
}

function endCurrentGame() {
  if (!view || view.phase === "lobby" || !confirm("确定结束当前游戏并返回大厅吗？")) return;
  submitAction({ type: "end" });
}

function render() {
  if (!view) return;
  const spectatorModel = spectatorUi.render(view);
  const memberRole = spectatorModel.memberRole;
  setHidden(elements.hostTools, !view.permissions?.canManage);
  setHidden(elements.startGameButton, !view.permissions?.canStart);
  setHidden(elements.endGameButton, !view.permissions?.canEnd);
  elements.startGameButton.disabled = configuringRoom || view.players.length < 2 || view.players.some((player) => !player.connected);
  elements.roomCodeDisplay.textContent = room.snapshot().roomCode;
  elements.gameNotice.textContent = memberRole === "spectator" && view.phase === "lobby"
    ? "你正在旁观准备阶段，可在有空位时进入玩家席。"
    : view.notice;
  elements.roundBadge.textContent = `第 ${view.round} 轮`;
  const current = view.players.find((player) => player.isCurrent);
  elements.turnTitle.textContent = current?.name
    || (view.phase === "collectingWords" ? "提交词语" : view.phase === "ended" ? "本局结束" : "未开始");
  renderPlayers();
  renderWords(memberRole);
  renderActions(memberRole);
  renderLog();
}

function renderPlayers() {
  elements.playerList.innerHTML = view.players.map((player) => {
    const submitted = view.submittedPlayerIds?.includes(player.id);
    const statusText = player.status === "won" ? "已猜中"
      : player.status === "eliminated" ? "已出局"
        : player.status === "left" ? "最后留场"
          : view.phase === "lobby" ? "已落座"
            : view.phase === "collectingWords" ? (submitted ? "已提交词语" : "等待提交") : "游戏中";
    const tagClass = player.status === "won" ? "won"
      : player.status === "eliminated" ? "eliminated"
        : player.status === "left" ? "out" : player.isCurrent ? "active" : "";
    const tag = player.isCurrent ? "行动" : statusText;
    return `
      <div class="player-item ${player.id === view.selfId ? "player-self" : ""}">
        <div>
          <div class="player-name">${escapeHtml(player.name)}${player.isHost ? " · 房主" : ""}</div>
          <div class="player-meta">${player.connected ? "在线" : "离线"} · ${statusText}</div>
        </div>
        <div class="player-actions">
          <span class="tag ${tagClass}">${tag}</span>
          ${view.permissions?.canKick && !player.isHost ? `<button class="kick-player-button" data-player-id="${escapeHtml(player.id)}" type="button">移出</button>` : ""}
        </div>
      </div>`;
  }).join("");
  elements.playerList.querySelectorAll(".kick-player-button").forEach((button) => {
    button.addEventListener("click", () => kickPlayer(button.dataset.playerId));
  });
}

function renderWords(memberRole) {
  elements.wordBoard.innerHTML = view.words.map((item) => {
    const mine = item.id === view.selfId;
    const value = item.status === "waiting" ? "待发牌"
      : memberRole === "spectator" ? "答案对旁观者隐藏"
      : mine ? "你的词被服务器遮住" : item.word || "未分配";
    const extra = item.extra && ["playing", "ended"].includes(view.phase)
      ? `<div class="word-extra word-extra-${escapeHtml(view.wordExtraMode)}"><strong>${view.wordExtraMode === "forbidden" ? "禁问" : "提示"}：</strong>${escapeHtml(item.extra)}</div>`
      : "";
    const trap = view.playerWordMode === "trap" && item.status !== "waiting"
      ? `<div class="trap-word ${mine ? "mine" : ""}"><strong>陷阱：</strong>${memberRole === "spectator" ? "对旁观者隐藏" : mine ? "你的陷阱词被服务器遮住" : escapeHtml(item.trapWord || "未分配")}</div>`
      : "";
    return `
      <div class="word-card">
        <div class="word-owner">${escapeHtml(item.name)}</div>
        <div class="word-value ${mine ? "mine" : ""}">${escapeHtml(value)}</div>
        ${trap}${extra}
      </div>`;
  }).join("");
}

function renderActions(memberRole) {
  const current = view.players.find((player) => player.isCurrent);
  const me = view.players.find((player) => player.id === view.selfId);
  const myWord = view.words.find((item) => item.id === view.selfId);
  const extraNotice = current?.id === view.selfId && myWord?.extra
    ? renderWordExtraNotice(view.wordExtraMode, myWord.extra) : "";
  if (memberRole === "spectator") {
    const question = view.currentQuestion
      ? `<div class="current-question notice"><strong>${escapeHtml(view.currentQuestion.askerName)} 问：</strong>${escapeHtml(view.currentQuestion.text)}</div>` : "";
    elements.actionArea.innerHTML = `${question}<p class="muted spectator-action-note">旁观模式可查看公开问答、进度和结算记录，但不会显示任何玩家的答案词、陷阱词，也不能提交词语或参与问答。</p>`;
    return;
  }
  if (view.phase === "lobby") {
    elements.actionArea.innerHTML = '<p class="muted">至少两名在线玩家落座后，由房主开始游戏。</p>';
    return;
  }
  if (view.phase === "ended") {
    elements.actionArea.innerHTML = renderResult();
    return;
  }
  if (view.phase === "collectingWords") {
    renderWordSubmission();
    return;
  }
  if (me?.status !== "playing") {
    elements.actionArea.innerHTML = '<p class="muted">你已完成本局；可以继续旁观其他玩家。</p>';
    return;
  }
  if (view.currentQuestion) {
    renderQuestionActions(extraNotice);
    return;
  }
  if (current?.id !== view.selfId) {
    elements.actionArea.innerHTML = `<p class="muted">等待 ${escapeHtml(current?.name || "当前玩家")} 行动。</p>`;
    return;
  }
  const questionControls = view.turnQuestionAsked
    ? '<p class="muted">本轮已完成提问，可以猜词或跳过。</p>'
    : `<label>本轮问题<input id="questionInput" autocomplete="off" maxlength="200" placeholder="例如：我是动物吗？"></label>
       <button class="primary" id="submitQuestionButton" type="button">提交问题</button>`;
  elements.actionArea.innerHTML = `
    ${extraNotice}${questionControls}
    <label>猜词<input id="guessInput" autocomplete="off" maxlength="30" placeholder="输入你认为自己额头上的词"></label>
    <button id="submitGuessButton" type="button">提交猜词</button>
    <button id="skipTurnButton" type="button">跳过</button>`;
  $("submitQuestionButton")?.addEventListener("click", () => {
    submitAction({ type: "question", text: $("questionInput").value });
  });
  $("submitGuessButton").addEventListener("click", () => {
    submitAction({ type: "guess", text: $("guessInput").value });
  });
  $("skipTurnButton").addEventListener("click", () => submitAction({ type: "skip" }));
}

function renderWordSubmission() {
  const hasSubmitted = view.submittedPlayerIds?.includes(view.selfId);
  const trapField = view.playerWordMode === "trap" ? `
    <label>陷阱词<input id="submittedTrapWordInput" autocomplete="off" maxlength="30" placeholder="例如：如懿"></label>
    <p class="muted">陷阱词应与答案有一定关联；猜中陷阱词的玩家会立即出局。</p>` : "";
  const extraField = view.wordExtraMode === "none" ? "" : `
    <label>${view.wordExtraMode === "forbidden" ? "这个词的禁问信息" : "提供给猜词者的开局提示"}
      <textarea id="submittedWordExtraInput" maxlength="100" placeholder="${view.wordExtraMode === "forbidden" ? "例如：不能询问演员、导演或参演作品" : "例如：大陆电视剧中的男性角色"}"></textarea>
    </label>`;
  elements.actionArea.innerHTML = `
    <p class="muted">${view.playerWordMode === "trap" ? "请提交一个正确答案和一个陷阱词。" : "请提交一个词语。"}内容只保存在服务器；其他玩家只能看到你是否已提交。</p>
    <label>${view.playerWordMode === "trap" ? "正确答案" : "你提供的词"}<input id="submittedWordInput" autocomplete="off" maxlength="30" placeholder="例如：长颈鹿"></label>
    ${trapField}${extraField}
    <button class="primary" id="submitWordButton" type="button">${hasSubmitted ? "更新词语" : "提交词语"}</button>
    ${hasSubmitted ? '<p class="muted">你已提交；其他玩家完成前仍可更新。</p>' : ""}`;
  $("submitWordButton").addEventListener("click", () => {
    const word = $("submittedWordInput").value.trim();
    const trapWord = $("submittedTrapWordInput")?.value.trim() || "";
    const extra = $("submittedWordExtraInput")?.value.trim() || "";
    if (!word) return alert(view.playerWordMode === "trap" ? "请输入正确答案。" : "请输入你提供的词。");
    if (view.playerWordMode === "trap" && !trapWord) return alert("请输入陷阱词。");
    if (view.playerWordMode === "trap" && normalizeWord(word) === normalizeWord(trapWord)) return alert("正确答案和陷阱词不能相同。");
    if (view.wordExtraMode !== "none" && !extra) return alert("请输入附加信息。");
    submitAction({ type: "submitWord", word, trapWord, extra });
  });
}

function renderWordExtraNotice(extraMode, extra, inLog = false) {
  if (!extra || extraMode === "none") return "";
  const label = extraMode === "forbidden"
    ? (inLog ? "本题禁问规则" : "你的禁问规则")
    : (inLog ? "本题开局提示" : "你的开局提示");
  return `<div class="word-extra-notice word-extra-${escapeHtml(extraMode)}"><strong>${label}：</strong>${escapeHtml(extra)}</div>`;
}

function renderQuestionActions(extraNotice = "") {
  const question = view.currentQuestion;
  const isAsker = question.askerId === view.selfId;
  const myAnswer = question.answers[view.selfId];
  const answerNames = Object.entries(question.answers).map(([playerId, answer]) => {
    const player = view.players.find((item) => item.id === playerId);
    return `${player?.name || "玩家"}：${{ yes: "是", no: "否", maybe: "不一定" }[answer]}`;
  });
  if (isAsker) {
    elements.actionArea.innerHTML = `${extraNotice}<div class="current-question notice"><strong>你的问题：</strong>${escapeHtml(question.text)}</div>
      <p class="muted">${answerNames.length ? escapeHtml(answerNames.join("，")) : "等待其他玩家回答。"}</p>`;
    return;
  }
  if (myAnswer) {
    elements.actionArea.innerHTML = `<div class="current-question notice"><strong>${escapeHtml(question.askerName)} 问：</strong>${escapeHtml(question.text)}</div>
      ${view.playerWordMode === "trap" ? '<p class="muted">回答始终以正确答案为准，不要根据陷阱词回答。</p>' : ""}
      <p class="muted">你已回答：${escapeHtml({ yes: "是", no: "否", maybe: "不一定" }[myAnswer])}</p>`;
    return;
  }
  elements.actionArea.innerHTML = `<div class="current-question notice"><strong>${escapeHtml(question.askerName)} 问：</strong>${escapeHtml(question.text)}</div>
    ${view.playerWordMode === "trap" ? '<p class="muted">请根据正确答案作答，不要根据陷阱词作答。</p>' : ""}
    <div class="answer-grid"><button class="answer-yes" id="answerYesButton" type="button">是</button><button class="answer-no" id="answerNoButton" type="button">否</button><button class="answer-maybe" id="answerMaybeButton" type="button">不一定</button></div>`;
  $("answerYesButton").addEventListener("click", () => submitAction({ type: "answer", answer: "yes" }));
  $("answerNoButton").addEventListener("click", () => submitAction({ type: "answer", answer: "no" }));
  $("answerMaybeButton").addEventListener("click", () => submitAction({ type: "answer", answer: "maybe" }));
}

function renderResult() {
  const winnerNames = view.winners.map((id, index) => {
    const player = view.players.find((item) => item.id === id);
    return `第 ${index + 1} 名：${escapeHtml(player?.name || "玩家")}`;
  }).join("<br>");
  const survivors = view.players.filter((player) => player.status === "left").map((player) => escapeHtml(player.name)).join("、");
  const eliminated = view.players.filter((player) => player.status === "eliminated").map((player) => escapeHtml(player.name)).join("、");
  return `<p>${winnerNames || "没有玩家猜中。"}</p>
    ${survivors ? `<p>最后留场：${survivors}</p>` : ""}
    ${eliminated ? `<p class="danger">陷阱出局：${eliminated}</p>` : ""}`;
}

function renderLog() {
  const availableIds = new Set(view.players.map((player) => player.id));
  if (logPlayerFilter !== "all" && !availableIds.has(logPlayerFilter)) logPlayerFilter = "all";
  elements.logPlayerFilter.innerHTML = [
    '<option value="all">全部玩家</option>',
    ...view.players.map((player) => `<option value="${escapeHtml(player.id)}">${escapeHtml(player.name)}</option>`)
  ].join("");
  elements.logPlayerFilter.value = logPlayerFilter;
  const records = logPlayerFilter === "all" ? view.log : view.log.filter((item) => item.playerId === logPlayerFilter);
  if (!records.length) {
    elements.logList.innerHTML = `<p class="muted">${logPlayerFilter === "all" ? "还没有记录。" : "该玩家还没有问答记录。"}</p>`;
    return;
  }
  elements.logList.innerHTML = records.slice(0, 24).map((item) => {
    const answerTags = item.type === "question"
      ? Object.values(item.answers || {}).map(({ playerName, answer }) => `<span class="log-answer-tag log-answer-${escapeHtml(answer)}">${escapeHtml(playerName)}：${escapeHtml({ yes: "是", no: "否", maybe: "不一定" }[answer] || "不一定")}</span>`).join("") : "";
    const detail = item.type === "question"
      ? `${item.wordExtra ? renderWordExtraNotice(item.wordExtraMode, item.wordExtra, true) : ""}<div class="log-answer-list">${answerTags || '<span class="muted">等待其他玩家回答。</span>'}</div>`
      : `<div class="muted">${escapeHtml(item.detail || "")}</div>`;
    return `<div class="log-item"><div class="log-line">${escapeHtml(item.text)}</div>${detail}</div>`;
  }).join("");
}

function syncPlayerWordSettings() {
  const usesPlayerWords = elements.gameModeSelect.value === "playerWords";
  setHidden(elements.topicSelectLabel, usesPlayerWords);
  setHidden(elements.wordExtraModeLabel, !usesPlayerWords);
  setHidden(elements.playerWordModeLabel, !usesPlayerWords);
  const trapMode = elements.playerWordModeSelect.value === "trap";
  const hintOption = elements.wordExtraModeSelect.querySelector('option[value="hint"]');
  hintOption.disabled = trapMode;
  if (trapMode && elements.wordExtraModeSelect.value === "hint") elements.wordExtraModeSelect.value = "none";
}

async function init() {
  bindRoomCodeInput(elements.roomCodeInput);
  spectatorUi.bind();
  for (const topic of Object.keys(TOPICS)) {
    const option = document.createElement("option");
    option.value = topic;
    option.textContent = topic;
    elements.topicSelect.appendChild(option);
  }
  elements.hostModeButton.addEventListener("click", () => selectMode("host"));
  elements.guestModeButton.addEventListener("click", () => selectMode("guest"));
  elements.createRoomButton.addEventListener("click", createGameRoom);
  elements.joinRoomButton.addEventListener("click", joinGameRoom);
  elements.startGameButton.addEventListener("click", startGame);
  elements.endGameButton.addEventListener("click", endCurrentGame);
  elements.gameModeSelect.addEventListener("change", syncPlayerWordSettings);
  elements.playerWordModeSelect.addEventListener("change", syncPlayerWordSettings);
  elements.wordExtraModeSelect.addEventListener("change", syncPlayerWordSettings);
  elements.logPlayerFilter.addEventListener("change", () => {
    logPlayerFilter = elements.logPlayerFilter.value;
    if (view) renderLog();
  });
  syncPlayerWordSettings();
  selectMode("host");
  try {
    spectatorUi.applyConfig(await room.checkServer());
  } catch {
    // The setup remains usable and create/join will show a detailed error.
  }
}

init();
