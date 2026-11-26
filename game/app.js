"use strict";

import {
  createAuthoritativeRoomClient,
  createPresentationTimeline,
  createRoomEntryController,
  createSessionStore,
  createSpectatorUi,
  escapeHtml,
  renderConnectionStatus,
  setHidden
} from "/shared/client/index.js";
import { TOPICS, normalizeWord, uniqueTopicWords, getStartIssue } from "./rules.mjs";
import { createGame1PartitionRenderer, createGame1RenderModel } from "./render-partitions.mjs";

const PROTOCOL_VERSION = 3;
const ROOM_CAPACITY = 32;
const $ = (id) => document.getElementById(id);
const elements = Object.fromEntries([
  "lobbySettings", "lobbyGameMode", "lobbyTopic", "lobbyTopicLabel", "startHint",
  "siteHeader", "connectionStatus", "roomHeaderTools", "setupPanel", "roomPanel", "hostModeButton", "guestModeButton",
  "hostSetup", "guestSetup", "hostNameInput", "guestNameInput", "gameModeSelect",
  "topicSelectLabel", "topicSelect", "wordExtraModeLabel", "wordExtraModeSelect",
  "playerWordModeLabel", "playerWordModeSelect", "createRoomButton", "roomCodeInput", "joinIntentField",
  "joinRoomButton", "hostTools", "roomCodeDisplay", "spectatorSettingButton", "seatActionButton", "spectatorPanel", "spectatorCountBadge", "spectatorList", "startGameButton", "endGameButton",
  "playerList", "lobbyRoster", "rosterPanel", "roundRoster", "gameNotice", "wordBoard", "turnTitle", "roundBadge", "actionArea",
  "logPlayerFilter", "logList", "presentationEffects", "presentationTrail", "presentationAnnouncement",
  "presentationLabel", "presentationText"
].map((id) => [id, $(id)]));

let view = null;
let logPlayerFilter = "all";
let configuringRoom = false;
let spectatorUi = null;
let presentation = null;
let partitionRenderer = null;
let draftRoomCode = "";
const actionDraft = {
  submittedWord:"",
  submittedTrapWord:"",
  submittedWordExtra:"",
  question:"",
  guess:""
};
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
      const previousView = view;
      captureActionDraft();
      view = nextView;
      reconcileActionDraft(previousView, nextView);
      for (const waiter of versionWaiters) waiter(version);
      enterRoom();
      render();
      presentation?.sync(nextView.presentationEvents);
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
const roomEntry = createRoomEntryController({
  room,spectatorUi,
  elements:{root:elements.setupPanel,hostModeButton:elements.hostModeButton,guestModeButton:elements.guestModeButton,hostSetup:elements.hostSetup,guestSetup:elements.guestSetup,hostTools:elements.hostTools,hostNameInput:elements.hostNameInput,guestNameInput:elements.guestNameInput,roomCodeInput:elements.roomCodeInput,createRoomButton:elements.createRoomButton,joinRoomButton:elements.joinRoomButton,connectionStatus:elements.connectionStatus},
  buildCreatePayload(){configuringRoom=true;return{capacity:ROOM_CAPACITY};},
  async onCreateSuccess(){try{await configureCreatedRoom({type:"configure",gameMode:elements.gameModeSelect.value,topic:elements.topicSelect.value,wordExtraMode:elements.wordExtraModeSelect.value,playerWordMode:elements.playerWordModeSelect.value});}finally{configuringRoom=false;if(view)render();}},
  onError(){configuringRoom=false;if(view)render();},
  formatError:(kind,error)=>kind==="create"?`创建房间失败：${error.message}\n请确认已通过 node game/signal-server.js 启动。`:`加入房间失败：${error.message}`
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

function submitAction(action) {
  Promise.resolve(room.submitAction(action)).catch((error) => {
    elements.connectionStatus.textContent = `操作失败：${error.message}`;
    alert(error.message);
  });
}

function captureDraftValue(elementId, key) {
  const input = $(elementId);
  if (input) actionDraft[key] = input.value;
}

function captureActionDraft() {
  captureDraftValue("submittedWordInput", "submittedWord");
  captureDraftValue("submittedTrapWordInput", "submittedTrapWord");
  captureDraftValue("submittedWordExtraInput", "submittedWordExtra");
  captureDraftValue("questionInput", "question");
  captureDraftValue("guessInput", "guess");
}

function clearDraftGroup(group) {
  const keys = group === "submission"
    ? ["submittedWord", "submittedTrapWord", "submittedWordExtra"]
    : group === "turn" ? ["question", "guess"] : Object.keys(actionDraft);
  for (const key of keys) actionDraft[key] = "";
}

function currentPlayerId(currentView) {
  return currentView?.players?.find((player) => player.isCurrent)?.id || "";
}

function reconcileActionDraft(previousView, nextView) {
  const nextRoomCode = room.snapshot().roomCode;
  if (draftRoomCode && draftRoomCode !== nextRoomCode) clearDraftGroup("all");
  draftRoomCode = nextRoomCode;

  if (["lobby", "ended"].includes(nextView.phase)) {
    clearDraftGroup("all");
    return;
  }
  if (nextView.phase !== "collectingWords") clearDraftGroup("submission");
  if (nextView.phase !== "playing") clearDraftGroup("turn");
  if (!previousView) return;

  const previousCurrentId = currentPlayerId(previousView);
  const nextCurrentId = currentPlayerId(nextView);
  if (previousView.phase === "playing" && previousCurrentId === previousView.selfId && nextCurrentId !== nextView.selfId) {
    clearDraftGroup("turn");
  }
  const acceptedOwnQuestion = nextView.currentQuestion?.askerId === nextView.selfId
    && nextView.currentQuestion?.id !== previousView.currentQuestion?.id;
  if (acceptedOwnQuestion) actionDraft.question = "";
}

function restoreDraftInput(elementId, key) {
  const input = $(elementId);
  if (!input) return;
  input.value = actionDraft[key];
  input.addEventListener("input", () => { actionDraft[key] = input.value; });
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
  if (!view || configuringRoom || getStartIssue(view)) return;
  submitAction({ type: "start" });
}

async function updateLobbySettings() {
  if (!view?.permissions.canManage || view.phase !== "lobby" || configuringRoom) return;
  const action = { type:"configure", gameMode:elements.lobbyGameMode.value,
    topic:elements.lobbyTopic.value, wordExtraMode:view.wordExtraMode, playerWordMode:view.playerWordMode };
  configuringRoom = true;
  render();
  try { await configureCreatedRoom(action); }
  catch (error) { alert(error.message); }
  finally { configuringRoom = false; render(); }
}

function endCurrentGame() {
  if (!view || view.phase === "lobby" || !confirm("确定结束当前游戏并返回大厅吗？")) return;
  submitAction({ type: "end" });
}

function renderRoomPartition(model) {
  const current = model.view;
  document.body.dataset.phase = current.phase;
  const showWords = ["playing", "ended"].includes(current.phase);
  const roster = showWords ? elements.roundRoster : elements.lobbyRoster;
  if (elements.playerList.parentElement !== roster) {
    roster.append(elements.playerList);
    elements.wordBoard.closest("[data-play-board]").scrollTop = 0;
  }
  setHidden(elements.rosterPanel, !showWords);
  setHidden(elements.hostTools,!current.permissions?.canManage);
  setHidden(elements.startGameButton,!current.permissions?.canStart);
  setHidden(elements.endGameButton,!current.permissions?.canEnd);
  const issue = getStartIssue(current);
  elements.startGameButton.disabled = model.configuringRoom || Boolean(issue);
  elements.startGameButton.setAttribute("aria-describedby", "startHint");
  setHidden(elements.lobbySettings, current.phase !== "lobby" || !current.permissions.canManage);
  setHidden(elements.startHint, current.phase !== "lobby");
  elements.lobbyGameMode.value = current.gameMode;
  elements.lobbyGameMode.disabled = model.configuringRoom;
  elements.lobbyTopic.disabled = model.configuringRoom;
  if (current.topic) elements.lobbyTopic.value = current.topic;
  setHidden(elements.lobbyTopicLabel, current.gameMode !== "library");
  for (const option of elements.lobbyTopic.options) option.disabled = uniqueTopicWords(option.value).length < current.players.length;
  elements.startHint.textContent = model.configuringRoom ? "正在保存房间设置…" : issue?.message
    || (current.gameMode === "library" ? `当前 ${current.players.length} 人；「${current.topic}」可支持 ${uniqueTopicWords(current.topic).length} 人。` : `当前 ${current.players.length} 人，开局后每人提交词语。`);
  elements.roomCodeDisplay.textContent = model.roomCode;
}

function renderStatusPartition(model) {
  const current = model.view;
  elements.gameNotice.textContent = model.memberRole === "spectator" && current.phase === "lobby"
    ? "你正在旁观准备阶段，可在有空位时进入玩家席。"
    : current.notice;
  elements.roundBadge.textContent = `第 ${current.round} 轮`;
  elements.turnTitle.textContent = model.current?.name
    || (current.phase === "collectingWords" ? "提交词语" : current.phase === "ended" ? "本局结束" : "未开始");
}

function render() {
  if (!view) return;
  const spectatorModel = spectatorUi.render(view);
  const model = createGame1RenderModel(view,{
    memberRole:spectatorModel.memberRole,
    roomCode:room.snapshot().roomCode,
    configuringRoom,
    logPlayerFilter
  });
  partitionRenderer ??= createGame1PartitionRenderer({
    room:renderRoomPartition,
    status:renderStatusPartition,
    players:renderPlayers,
    words:(currentModel) => renderWords(currentModel.memberRole),
    decision:(currentModel) => renderActions(currentModel.memberRole),
    logFilter:renderLogFilter,
    log:renderLogEntries
  });
  partitionRenderer.render(model);
}

function renderPlayers() {
  elements.playerList.dataset.count = String(view.players.length);
  elements.playerList.classList.toggle("crowded",view.players.length > 8);
  const existing = new Map([...elements.playerList.querySelectorAll("[data-player-id]")].map((node) => [node.dataset.playerId,node]));
  const retained = new Set();
  view.players.forEach((player,index) => {
    const id = String(player.id);
    const submitted = view.submittedPlayerIds?.includes(player.id);
    const statusText = player.status === "won" ? "已猜中"
      : player.status === "eliminated" ? "已出局"
        : player.status === "left" ? "最后留场"
          : view.phase === "lobby" ? "已落座"
            : view.phase === "collectingWords" ? (submitted ? "已提交词语" : "等待提交") : "游戏中";
    const tagClass = player.status === "won" ? "won"
      : player.status === "eliminated" ? "eliminated"
        : player.status === "left" ? "out" : player.isCurrent ? "active" : "";
    let node = existing.get(id);
    if (!node) {
      node = document.createElement("div");
      node.dataset.playerId = id;
      node.innerHTML = '<span class="operator-light" aria-hidden="true"></span><span class="operator-number" data-operator-number></span><div class="player-name" data-player-name></div><div class="player-actions"><span class="tag" data-player-tag></span><button class="kick-player-button" data-kick-player type="button">移出</button></div>';
    }
    retained.add(id);
    node.className = `player-item operator-chip ${player.connected ? "online" : "offline"} ${player.id === view.selfId ? "player-self" : ""}`;
    node.title = `${player.connected ? "在线" : "离线"} · ${statusText}`;
    node.querySelector("[data-operator-number]").textContent = String(index + 1).padStart(2,"0");
    node.querySelector("[data-player-name]").textContent = `${player.name}${player.isHost ? " · 房主" : ""}`;
    const tag = node.querySelector("[data-player-tag]");
    tag.className = `tag ${tagClass}`;
    tag.textContent = player.isCurrent ? "行动" : statusText;
    const kick = node.querySelector("[data-kick-player]");
    kick.dataset.kickPlayer = id;
    setHidden(kick,!view.permissions?.canKick || player.isHost);
    const atIndex = elements.playerList.children[index];
    if (atIndex !== node) elements.playerList.insertBefore(node,atIndex || null);
  });
  [...elements.playerList.querySelectorAll("[data-player-id]")].forEach((node) => {
    if (!retained.has(node.dataset.playerId)) node.remove();
  });
}

function renderWords(memberRole) {
  elements.wordBoard.dataset.count = String(view.words.length);
  elements.wordBoard.classList.toggle("crowded", view.words.length > 8);
  elements.wordBoard.classList.toggle("dense", view.words.length > 16);
  const existing = new Map([...elements.wordBoard.querySelectorAll("[data-player-anchor]")].map((node) => [node.dataset.playerAnchor,node]));
  const retained = new Set();
  view.words.forEach((item,index) => {
    const id = String(item.id);
    const mine = item.id === view.selfId;
    const player = view.players.find((entry) => entry.id === item.id);
    const stateClass = !player?.connected ? "offline"
      : player?.status === "won" ? "won"
        : player?.status === "eliminated" ? "eliminated"
          : player?.status === "left" ? "out"
            : player?.isCurrent ? "active" : "";
    const statusLabel = player?.status === "won" ? "译码完成"
      : player?.status === "eliminated" ? "触发陷阱"
        : player?.status === "left" ? "最后留场"
          : player?.isCurrent ? "正在译码"
            : player?.connected ? "线路待命" : "信号中断";
    const value = item.status === "waiting" ? "待发牌"
      : memberRole === "spectator" ? "答案对旁观者隐藏"
        : mine ? "你的词被服务器遮住" : item.word || "未分配";
    const extra = item.extra && ["playing","ended"].includes(view.phase)
      ? `<div class="word-extra word-extra-${escapeHtml(view.wordExtraMode)}"><strong>${view.wordExtraMode === "forbidden" ? "禁问" : "提示"}：</strong>${escapeHtml(item.extra)}</div>`
      : "";
    const trap = view.playerWordMode === "trap" && item.status !== "waiting"
      ? `<div class="trap-word ${mine ? "mine" : ""}"><strong>陷阱：</strong>${memberRole === "spectator" ? "对旁观者隐藏" : mine ? "你的陷阱词被服务器遮住" : escapeHtml(item.trapWord || "未分配")}</div>`
      : "";
    let node = existing.get(id);
    if (!node) {
      node = document.createElement("article");
      node.dataset.playerAnchor = id;
    }
    retained.add(id);
    node.className = `word-card operator-card ${stateClass} ${mine ? "self-card" : ""}`;
    node.innerHTML = `<header class="operator-card-head"><span class="operator-code">OP-${String(index + 1).padStart(2,"0")}</span><div class="word-owner">${escapeHtml(item.name)}${mine ? " · 你" : ""}</div><span class="operator-state">${statusLabel}</span></header><div class="cipher-label ${mine ? "sealed" : ""}"><small>${mine ? "SEALED PERSONAL CODE" : "ASSIGNED CODE"}</small><div class="word-value ${mine ? "mine" : ""}">${escapeHtml(value)}</div></div>${trap}${extra}<footer class="operator-card-foot"><span>${player?.connected ? "LINK STABLE" : "LINK LOST"}</span><i aria-hidden="true"></i></footer>`;
    const atIndex = elements.wordBoard.children[index];
    if (atIndex !== node) elements.wordBoard.insertBefore(node,atIndex || null);
  });
  [...elements.wordBoard.querySelectorAll("[data-player-anchor]")].forEach((node) => {
    if (!retained.has(node.dataset.playerAnchor)) node.remove();
  });
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
  restoreDraftInput("questionInput", "question");
  restoreDraftInput("guessInput", "guess");
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
  restoreDraftInput("submittedWordInput", "submittedWord");
  restoreDraftInput("submittedTrapWordInput", "submittedTrapWord");
  restoreDraftInput("submittedWordExtraInput", "submittedWordExtra");
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

function renderLogFilter(model) {
  const availableIds = new Set(view.players.map((player) => player.id));
  if (logPlayerFilter !== "all" && !availableIds.has(logPlayerFilter)) logPlayerFilter = "all";
  const existing = new Map([...elements.logPlayerFilter.options].map((option) => [option.value,option]));
  const choices = [{id:"all",name:"全部玩家"},...view.players.map((player) => ({id:String(player.id),name:player.name}))];
  const retained = new Set();
  choices.forEach((choice,index) => {
    let option = existing.get(choice.id);
    if (!option) {
      option = document.createElement("option");
      option.value = choice.id;
    }
    retained.add(choice.id);
    option.textContent = choice.name;
    const atIndex = elements.logPlayerFilter.options[index];
    if (atIndex !== option) elements.logPlayerFilter.insertBefore(option,atIndex || null);
  });
  [...elements.logPlayerFilter.options].forEach((option) => {
    if (!retained.has(option.value)) option.remove();
  });
  elements.logPlayerFilter.value = logPlayerFilter;
}

function renderLogEntries() {
  const records = logPlayerFilter === "all" ? view.log : view.log.filter((item) => item.playerId === logPlayerFilter);
  if (!records.length) {
    elements.logList.innerHTML = `<p class="muted">${logPlayerFilter === "all" ? "还没有记录。" : "该玩家还没有问答记录。"}</p>`;
    return;
  }
  elements.logList.innerHTML = records.slice(0,24).map((item) => {
    const answerTags = item.type === "question"
      ? Object.values(item.answers || {}).map(({playerName,answer}) => `<span class="log-answer-tag log-answer-${escapeHtml(answer)}">${escapeHtml(playerName)}：${escapeHtml({yes:"是",no:"否",maybe:"不一定"}[answer] || "不一定")}</span>`).join("") : "";
    const detail = item.type === "question"
      ? `${item.wordExtra ? renderWordExtraNotice(item.wordExtraMode,item.wordExtra,true) : ""}<div class="log-answer-list">${answerTags || '<span class="muted">等待其他玩家回答。</span>'}</div>`
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

function presentationLabelFor(kind) {
  return ({
    "collection-open":"密文征集",
    "telegram-sealed":"电报封存",
    "codes-issued":"代号分发",
    "question-sent":"询问发出",
    "answer-received":"线路回传",
    "answers-complete":"答复齐全",
    "guess-correct":"破译成功",
    "guess-wrong":"校验失败",
    "guess-trap":"陷阱警报",
    "turn-passed":"译码权转交",
    "room-reset":"设备复位"
  })[kind] || "译码室动态";
}

function playerAnchor(playerId) {
  if (!playerId) return null;
  return elements.wordBoard.querySelector(`[data-player-anchor="${CSS.escape(String(playerId))}"]`);
}

function presentationSource(event) {
  if (["collection-open", "codes-issued", "room-reset"].includes(event.kind)) return document.querySelector(".decoder-console");
  return playerAnchor(event.actorId) || document.querySelector(".decoder-console");
}

function presentationTarget(event) {
  if (event.targetId) return playerAnchor(event.targetId) || document.querySelector(".decoder-console");
  return document.querySelector(".decoder-console");
}

function playPresentationObject(event) {
  const source = presentationSource(event);
  const target = presentationTarget(event);
  const targets = (event.targetIds || []).map(playerAnchor).filter(Boolean);
  const highlighted = [...new Set([source, target, ...targets].filter(Boolean))];
  highlighted.forEach((element) => element.classList.add("presentation-focus"));

  const centralKinds = new Set(["codes-issued", "answers-complete", "guess-correct", "guess-wrong", "guess-trap", "room-reset"]);
  if (centralKinds.has(event.kind)) document.querySelector(".decoder-console")?.classList.add("presentation-verdict");

  let token = null;
  if (source && target) {
    const stage = elements.presentationEffects.getBoundingClientRect();
    const from = source.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    token = document.createElement("span");
    token.className = `presentation-token token-${event.kind}`;
    token.textContent = ({
      "telegram-sealed":"封", "question-sent":"?", "answer-received":{ yes:"是", no:"否", maybe:"疑" }[event.answer],
      "answers-complete":"齐", "guess-correct":"准", "guess-wrong":"误", "guess-trap":"警", "turn-passed":"→"
    })[event.kind] || "译";
    token.style.setProperty("--from-x", `${from.left + from.width / 2 - stage.left}px`);
    token.style.setProperty("--from-y", `${from.top + from.height / 2 - stage.top}px`);
    token.style.setProperty("--to-x", `${to.left + to.width / 2 - stage.left}px`);
    token.style.setProperty("--to-y", `${to.top + to.height / 2 - stage.top}px`);
    elements.presentationEffects.append(token);
  }

  return () => {
    highlighted.forEach((element) => element.classList.remove("presentation-focus"));
    document.querySelector(".decoder-console")?.classList.remove("presentation-verdict");
    token?.remove();
  };
}

async function init() {
  roomEntry.bind();
  spectatorUi.bind();
  for (const topic of Object.keys(TOPICS)) {
    const option = document.createElement("option");
    option.value = topic;
    option.textContent = `${topic}（最多 ${uniqueTopicWords(topic).length} 人）`;
    elements.lobbyTopic.appendChild(option.cloneNode(true));
    elements.topicSelect.appendChild(option);
  }
  elements.startGameButton.addEventListener("click", startGame);
  elements.lobbyGameMode.addEventListener("change", updateLobbySettings);
  elements.lobbyTopic.addEventListener("change", updateLobbySettings);
  elements.endGameButton.addEventListener("click", endCurrentGame);
  elements.gameModeSelect.addEventListener("change", syncPlayerWordSettings);
  elements.playerWordModeSelect.addEventListener("change", syncPlayerWordSettings);
  elements.wordExtraModeSelect.addEventListener("change", syncPlayerWordSettings);
  elements.logPlayerFilter.addEventListener("change", () => {
    logPlayerFilter = elements.logPlayerFilter.value;
    if (view) render();
  });
  elements.playerList.addEventListener("click",(event) => {
    const button = event.target.closest("[data-kick-player]");
    if (button) kickPlayer(button.dataset.kickPlayer);
  });
  syncPlayerWordSettings();
  roomEntry.selectMode("host");
  try {
    spectatorUi.applyConfig(await room.checkServer());
  } catch {
    // The setup remains usable and create/join will show a detailed error.
  }
}

presentation = createPresentationTimeline({
  container:elements.presentationEffects,
  trailPath:elements.presentationTrail,
  announcement:elements.presentationAnnouncement,
  labelElement:elements.presentationLabel,
  textElement:elements.presentationText,
  effectsElement:elements.presentationEffects,
  resolveSource:presentationSource,
  resolveTarget:presentationTarget,
  labelFor:(event) => presentationLabelFor(event.kind),
  beforePlay:playPresentationObject,
  sceneKey:(event) => event.sceneId,
  priorityFor:(event) => Number(event.priority) || 1,
  durationMs:1500,
  reducedDurationMs:480,
  catchUpThreshold:4,
  severeBacklogThreshold:8,
  catchUpDurationMs:780,
  severeDurationMs:380,
  urgentPriority:5,
  retainPriority:4,
  maxQueue:14
});

init();
