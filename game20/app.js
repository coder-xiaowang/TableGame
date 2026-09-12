"use strict";

import {
  bindRoomCodeInput, cleanPlayerName, createAuthoritativeRoomClient, createCountdown, createSessionStore,
  createSpectatorUi, escapeHtml, renderConnectionStatus, renderCountdown, setHidden, setModeVisibility
} from "/shared/client/index.js";

const PROTOCOL_VERSION = 3;
const PHASE_MS = { secretReveal: 30000, questioning: 300000, firstVote: 30000, secondVote: 30000, tieBreak: 20000 };
const ROLE_LABEL = { master: "主持人", insider: "局内人", common: "普通人" };
const ANSWER_LABEL = { yes: "是", no: "不是", unknown: "不知道" };
const PHASE_LABEL = { lobby: "等待讨论开始", secretReveal: "秘密确认身份", questioning: "限时猜词", discussion: "寻找局内人", firstVote: "审查猜中者", secondVote: "最终指控", tieBreak: "猜中者裁决平票", roundEnd: "本轮结算" };
const $ = (id) => document.getElementById(id);
const E = Object.fromEntries([
  "hero","connectionStatus","roomHeaderTools","setupPanel","roomPanel","hostModeButton","guestModeButton","hostSetup","guestSetup",
  "hostNameInput","guestNameInput","playerCountSelect","createRoomButton","joinRoomButton","roomCodeInput","joinIntentField","roomCodeDisplay",
  "hostTools","roomPlayerCountSelect","spectatorSettingButton","seatActionButton","startGameButton","nextRoundButton","endGameButton",
  "notice","phaseTitle","roundNumber","players","focusLabel","focusText","focusHint","answerEchoes","controlDock","actionTitle","actionHint","actionButtons",
  "timerText","timerBar","secretPanel","roleLabel","secretRole","secretWord","commonWins","insiderWins","failedRounds","toggleLogButton","logList",
  "spectatorPanel","spectatorCountBadge","spectatorList"
].map((id) => [id, $(id)]));

let mode = "host";
let view = null;
let spectatorUi = null;
let selectingGuesser = false;

const sessions = createSessionStore({ gameId: "insider" });
const countdown = createCountdown({ onTick(value) { renderCountdown({ textElement: E.timerText, barElement: E.timerBar }, value); } });
const room = createAuthoritativeRoomClient({
  protocolVersion: PROTOCOL_VERSION,
  sessionStore: sessions,
  onStatus(status) { renderConnectionStatus(E.connectionStatus, status, room.snapshot().roomCode); },
  handlers: {
    onView(nextView) {
      view = nextView;
      if (!view.permissions.canMarkCorrectGuesser) selectingGuesser = false;
      enterRoom();
      render();
    },
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

function submit(action) {
  return Promise.resolve(room.submitAction(action)).catch((error) => {
    E.connectionStatus.textContent = `操作失败：${error.message}`;
    alert(error.message);
    return null;
  });
}

function player(id) { return view.players.find((item) => item.id === id) || null; }
function nameOf(id) { return player(id)?.name || "玩家"; }

function enterRoom() {
  setHidden(E.setupPanel, true);
  setHidden(E.roomPanel, false);
  setHidden(E.roomHeaderTools, false);
  E.hero.classList.add("in-room");
  E.roomCodeDisplay.textContent = room.snapshot().roomCode;
}

async function createGameRoom() {
  E.createRoomButton.disabled = true;
  try {
    await room.createRoom({ name: cleanPlayerName(E.hostNameInput.value, "房主"), capacity: Number(E.playerCountSelect.value) });
  } catch (error) {
    alert(`创建失败：${error.message}\n请确认已启动 game20 服务。`);
  } finally { E.createRoomButton.disabled = false; }
}

async function joinGameRoom() {
  E.joinRoomButton.disabled = true;
  try {
    const result = await room.joinRoom({ code: E.roomCodeInput.value, name: cleanPlayerName(E.guestNameInput.value, "玩家"), intent: spectatorUi.getJoinIntent() });
    E.connectionStatus.textContent = spectatorUi.handleJoinResult(result).statusText;
  } catch (error) { alert(`加入失败：${error.message}`); }
  finally { E.joinRoomButton.disabled = false; }
}

async function kickPlayer(playerId) {
  const target = player(playerId);
  if (!target || target.isHost || !confirm(`确定移出 ${target.name} 吗？`)) return;
  try { await room.kick(playerId); } catch (error) { alert(error.message); }
}

function targetMode() {
  if (selectingGuesser && view.permissions.canMarkCorrectGuesser) return "guesser";
  if (view.permissions.canSecondVote) return "secondVote";
  if (view.permissions.canResolveTie) return "tieBreak";
  return null;
}

function eligibleTargetIds(kind) {
  if (kind === "guesser") return new Set(view.players.filter((item) => item.id !== view.masterId).map((item) => item.id));
  if (kind === "secondVote") return new Set(view.players.filter((item) => item.id !== view.masterId && item.id !== view.guessedById).map((item) => item.id));
  if (kind === "tieBreak") return new Set(view.tieCandidates);
  return new Set();
}

function choosePlayer(kind, playerId) {
  if (kind === "guesser") {
    if (!confirm(`确认 ${nameOf(playerId)} 说出了正确答案吗？`)) return;
    selectingGuesser = false;
    submit({ type: "markCorrectGuesser", playerId });
  } else if (kind === "secondVote") submit({ type: "submitSecondVote", targetId: playerId });
  else if (kind === "tieBreak") submit({ type: "resolveTie", targetId: playerId });
}

function renderPlayers() {
  const selfIndex = view.players.findIndex((item) => item.id === view.selfId);
  const ordered = selfIndex < 0 ? view.players : [...view.players.slice(selfIndex), ...view.players.slice(0, selfIndex)];
  const kind = targetMode();
  const targets = eligibleTargetIds(kind);
  E.players.dataset.count = String(ordered.length);
  E.players.innerHTML = ordered.map((item, index) => {
    const angle = -90 + (180 / ordered.length) + index * (360 / ordered.length);
    const radians = angle * Math.PI / 180;
    const x = 50 + Math.cos(radians) * 41;
    const y = 51 + Math.sin(radians) * 38;
    const targetable = targets.has(item.id);
    const badges = [
      item.isMaster ? '<span class="badge master">主持人</span>' : "",
      item.isGuesser ? '<span class="badge guesser">猜中者</span>' : "",
      item.role && !item.isMaster ? `<span class="badge role">${escapeHtml(ROLE_LABEL[item.role])}</span>` : "",
      view.phase === "discussion" && view.readyIds.includes(item.id) ? '<span class="badge">已准备</span>' : "",
      view.phase === "firstVote" && view.submittedFirstVoteIds.includes(item.id) ? '<span class="badge">已投票</span>' : "",
      view.phase === "secondVote" && view.submittedSecondVoteIds.includes(item.id) ? '<span class="badge">已投票</span>' : ""
    ].join("");
    return `<article data-player-anchor="${escapeHtml(item.id)}" style="--seat-x:${x.toFixed(2)}%;--seat-y:${y.toFixed(2)}%" class="player-seat ${item.id === view.selfId ? "self" : ""} ${item.isMaster ? "master" : ""} ${!item.connected ? "offline" : ""} ${targetable ? "targetable" : ""}" ${targetable ? `data-target-id="${escapeHtml(item.id)}" role="button" tabindex="0" aria-label="选择 ${escapeHtml(item.name)}"` : ""}>
      <div class="seat-head"><div><b>${escapeHtml(item.name)}${item.id === view.selfId ? " · 你" : ""}</b><small>${item.isHost ? "房主 · " : ""}${item.connected ? "在线" : "离线"}</small></div>${view.permissions.canManage && view.phase === "lobby" && !item.isHost ? `<button class="small" data-kick="${escapeHtml(item.id)}" type="button">移出</button>` : ""}</div>
      <div class="seat-badges">${badges || '<span class="badge">身份隐藏</span>'}</div>
    </article>`;
  }).join("");
  E.players.querySelectorAll("[data-kick]").forEach((button) => { button.onclick = (event) => { event.stopPropagation(); kickPlayer(button.dataset.kick); }; });
  E.players.querySelectorAll("[data-target-id]").forEach((seat) => {
    const choose = () => choosePlayer(kind, seat.dataset.targetId);
    seat.onclick = (event) => { if (!event.target.closest("[data-kick]")) choose(); };
    seat.onkeydown = (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); choose(); } };
  });
}

function addButton(text, handler, className = "", disabled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.className = className;
  button.disabled = disabled;
  button.onclick = handler;
  E.actionButtons.append(button);
  return button;
}

function renderSecret(memberRole) {
  const show = memberRole === "player" && view.phase !== "lobby";
  setHidden(E.secretPanel, !show);
  if (!show) return;
  E.secretRole.textContent = ROLE_LABEL[view.privateRole] || "等待分配";
  E.secretWord.textContent = view.secretWord ? `秘密答案：${view.secretWord.text}` : view.phase === "roundEnd" ? "" : "你不知道本轮答案";
}

function renderActions(memberRole) {
  E.actionButtons.innerHTML = "";
  E.actionHint.textContent = "";
  renderSecret(memberRole);
  if (memberRole === "spectator") {
    E.actionTitle.textContent = view.phase === "lobby" ? "正在旁观准备阶段" : `正在旁观：${PHASE_LABEL[view.phase]}`;
    E.actionHint.textContent = view.phase === "roundEnd" ? "本轮身份和答案已经公开。" : "旁观者只能看到公开进度，不会收到答案、隐藏身份或未结算投票。";
    return;
  }
  if (view.phase === "lobby") {
    E.actionTitle.textContent = "等待玩家到齐";
    E.actionHint.textContent = `当前 ${view.players.length}/${view.capacity} 人；房主在所有玩家在线后开始。`;
    return;
  }
  if (view.phase === "secretReveal") {
    E.actionTitle.textContent = view.permissions.canAcknowledgeSecret ? "确认你的秘密信息" : "等待秘密确认";
    E.actionHint.textContent = view.privateRole === "common" ? "普通人不知道答案，请等待主持人与局内人确认。" : "记住答案和身份后再确认；其他玩家看不到这里。";
    if (view.permissions.canAcknowledgeSecret) addButton("我已看清，开始准备", () => submit({ type: "acknowledgeSecret" }), "primary");
    return;
  }
  if (view.phase === "questioning") {
    if (view.permissions.canShowMasterAnswer) {
      E.actionTitle.textContent = selectingGuesser ? "点击说出答案的玩家" : "主持限时问答";
      E.actionHint.textContent = selectingGuesser ? "桌面上可选择的玩家席已经发光；点错前仍会要求二次确认。" : "通过语音回答；网页按钮可以向所有人同步最近一次回答。";
      if (!selectingGuesser) {
        addButton("是", () => submit({ type: "showMasterAnswer", answer: "yes" }), "answer-yes");
        addButton("不是", () => submit({ type: "showMasterAnswer", answer: "no" }), "answer-no");
        addButton("不知道", () => submit({ type: "showMasterAnswer", answer: "unknown" }), "answer-unknown");
        addButton("有人猜中", () => { selectingGuesser = true; renderPlayers(); renderActions(memberRole); }, "primary");
      } else addButton("取消选择", () => { selectingGuesser = false; renderPlayers(); renderActions(memberRole); });
    } else {
      E.actionTitle.textContent = "通过语音向主持人提问";
      E.actionHint.textContent = view.privateRole === "insider" ? "你知道答案：自然地引导讨论，同时隐藏自己的身份。" : "问题应当能由主持人回答“是”“不是”或“不知道”。";
    }
    return;
  }
  if (view.phase === "discussion") {
    E.actionTitle.textContent = "讨论谁在暗中引导";
    E.actionHint.textContent = `猜中者是 ${nameOf(view.guessedById)}。所有在线玩家准备后可提前投票，否则等待等时讨论结束。`;
    if (view.permissions.canReadyToVote) addButton("我已准备投票", () => submit({ type: "readyToVote" }), "primary");
    else addButton("已准备，等待其他玩家", () => {}, "", true);
    return;
  }
  if (view.phase === "firstVote") {
    E.actionTitle.textContent = `猜中者 ${nameOf(view.guessedById)} 是局内人吗？`;
    if (view.selfId === view.guessedById) E.actionHint.textContent = "你是猜中者，不能参加这次表决，请等待其他玩家审查。";
    else if (view.permissions.canFirstVote) {
      E.actionHint.textContent = "选择在结算前只有你和服务器知道；超过全部合资格玩家一半才构成指控。";
      addButton("是，指控他", () => submit({ type: "submitFirstVote", accuse: true }), "answer-no");
      addButton("否，排除他", () => submit({ type: "submitFirstVote", accuse: false }), "answer-yes");
    } else E.actionHint.textContent = `你的选择已提交，等待其余玩家。${view.myFirstVote == null ? "" : `你选择了：${view.myFirstVote ? "指控" : "排除"}。`}`;
    return;
  }
  if (view.phase === "secondVote") {
    E.actionTitle.textContent = view.permissions.canSecondVote ? "点击玩家席，投出最终指控" : "等待最终投票";
    E.actionHint.textContent = view.permissions.canSecondVote ? "发光玩家是合法候选人。选择在全员提交前不会公开。" : `你的投票已经提交给 ${nameOf(view.mySecondVote)}。`;
    return;
  }
  if (view.phase === "tieBreak") {
    E.actionTitle.textContent = view.permissions.canResolveTie ? "由你裁决最高票平局" : `等待猜中者 ${nameOf(view.guessedById)} 裁决`;
    E.actionHint.textContent = view.permissions.canResolveTie ? "直接点击一名发光的平票候选人。" : "超时后服务器会在平票候选人中随机选择。";
    return;
  }
  if (view.phase === "roundEnd") {
    const label = view.result.winnerSide === "common" ? "普通阵营获胜" : view.result.winnerSide === "insider" ? "局内人获胜" : "全员失败";
    E.actionTitle.textContent = label;
    E.actionHint.textContent = `${view.result.reason} 正确答案是“${view.result.answer}”，局内人是 ${nameOf(view.result.insiderId)}。`;
  }
}

function renderPublicFocus() {
  const echoes = (view.answerHistory || []).slice(0, 6);
  E.answerEchoes.innerHTML = echoes.map((entry, index) => `<span class="answer-echo answer-${entry.answer}" style="--echo-delay:${index * 45}ms">${ANSWER_LABEL[entry.answer] || "?"}</span>`).join("");
  E.answerEchoes.classList.toggle("empty", echoes.length === 0);
  E.focusLabel.textContent = "CURRENT SIGNAL";
  if (view.phase === "lobby") { E.focusText.textContent = "答案尚未藏入房间"; E.focusHint.textContent = "等待正式玩家到齐"; return; }
  if (view.phase === "secretReveal") { E.focusText.textContent = "秘密正在传递"; E.focusHint.textContent = `主持人与局内人正在确认答案 · ${view.secretConfirmedCount}/2`; return; }
  if (view.phase === "questioning") {
    const latest = view.answerHistory[0];
    E.focusLabel.textContent = "MASTER SAYS";
    E.focusText.textContent = latest ? ANSWER_LABEL[latest.answer] : "请开始提问";
    E.focusHint.textContent = latest ? "主持人最近一次同步回答" : "通过语音提出可以判断的问题";
    return;
  }
  if (view.phase === "discussion") { E.focusText.textContent = `${nameOf(view.guessedById)} 找到了答案`; E.focusHint.textContent = "现在回想：是谁让讨论快速接近真相？"; return; }
  if (view.phase === "firstVote") { E.focusText.textContent = `审查 ${nameOf(view.guessedById)}`; E.focusHint.textContent = `${view.submittedFirstVoteIds.length}/${view.players.length - 1} 已提交`; return; }
  if (view.phase === "secondVote") { E.focusText.textContent = "真正的局内人是谁？"; E.focusHint.textContent = `第一次投票 ${view.firstVoteResult.yesCount}/${view.firstVoteResult.eligibleCount} 票指控 · 本轮 ${view.submittedSecondVoteIds.length}/${view.players.length} 已提交`; return; }
  if (view.phase === "tieBreak") { E.focusText.textContent = "最高票出现平局"; E.focusHint.textContent = `候选：${view.tieCandidates.map((id) => `${nameOf(id)} ${view.secondVoteResult.counts[id]}票`).join("、")}`; return; }
  const label = view.result.winnerSide === "common" ? "普通阵营识破了引导" : view.result.winnerSide === "insider" ? "局内人隐藏到了最后" : "答案没有被找到";
  E.focusLabel.textContent = "ROUND REVEAL";
  E.focusText.textContent = label;
  const voteNote = view.secondVoteResult?.accusedId
    ? ` · 最终指控：${nameOf(view.secondVoteResult.accusedId)}`
    : view.firstVoteResult ? ` · 猜中者指控票：${view.firstVoteResult.yesCount}/${view.firstVoteResult.eligibleCount}` : "";
  E.focusHint.textContent = `答案：${view.result.answer} · 局内人：${nameOf(view.result.insiderId)}${voteNote}`;
}

function renderLog() {
  E.logList.innerHTML = view.logs.map((entry) => `<div class="log-item">${escapeHtml(entry.text)}</div>`).join("") || '<p class="muted">暂无公开记录</p>';
}

function render() {
  if (!view) return;
  const model = spectatorUi.render(view);
  const memberRole = model.memberRole;
  setHidden(E.hostTools, !view.permissions.canManage);
  setHidden(E.startGameButton, !view.permissions.canStart);
  setHidden(E.nextRoundButton, !view.permissions.canNextRound);
  setHidden(E.endGameButton, !view.permissions.canEnd);
  E.startGameButton.disabled = view.players.length !== view.capacity || view.players.some((item) => !item.connected);
  E.nextRoundButton.disabled = view.players.some((item) => !item.connected);
  E.roomPlayerCountSelect.value = String(view.capacity);
  E.roomPlayerCountSelect.disabled = !view.permissions.canSetCapacity;
  E.phaseTitle.textContent = PHASE_LABEL[view.phase] || "服务器结算中";
  E.roundNumber.textContent = String(view.round);
  E.commonWins.textContent = String(view.stats.commonWins);
  E.insiderWins.textContent = String(view.stats.insiderWins);
  E.failedRounds.textContent = String(view.stats.failedRounds);
  E.notice.textContent = view.phase === "lobby" ? `等待玩家加入：${view.players.length}/${view.capacity}` : `第 ${view.round} 轮 · ${PHASE_LABEL[view.phase]}${view.masterId ? ` · 主持人：${nameOf(view.masterId)}` : ""}`;
  E.controlDock.dataset.role = memberRole;
  renderPlayers();
  renderPublicFocus();
  renderActions(memberRole);
  renderLog();
  if (view.deadline) countdown.start(view.deadline, view.phase === "discussion" ? Math.max(1000, view.guessElapsedMs) : PHASE_MS[view.phase] || 30000);
  else { countdown.stop(); E.timerText.textContent = "--"; E.timerBar.style.width = "0"; }
}

function selectMode(nextMode) {
  mode = nextMode;
  setModeVisibility(mode, { hostButton: E.hostModeButton, guestButton: E.guestModeButton, hostSetup: E.hostSetup, guestSetup: E.guestSetup, hostTools: E.hostTools });
}

async function init() {
  bindRoomCodeInput(E.roomCodeInput);
  E.hostModeButton.onclick = () => selectMode("host");
  E.guestModeButton.onclick = () => selectMode("guest");
  E.createRoomButton.onclick = createGameRoom;
  E.joinRoomButton.onclick = joinGameRoom;
  E.roomPlayerCountSelect.onchange = () => submit({ type: "setCapacity", capacity: Number(E.roomPlayerCountSelect.value) });
  E.startGameButton.onclick = () => submit({ type: "start" });
  E.nextRoundButton.onclick = () => submit({ type: "nextRound" });
  E.endGameButton.onclick = () => { if (confirm("确定结束当前讨论并返回准备阶段吗？")) submit({ type: "end" }); };
  E.toggleLogButton.onclick = () => { const collapsed = E.logList.classList.toggle("collapsed"); E.toggleLogButton.textContent = collapsed ? "展开" : "收起"; };
  spectatorUi.bind();
  selectMode("host");
  try { spectatorUi.applyConfig(await room.checkServer()); } catch { /* 创建或加入时显示连接错误 */ }
}

init();
