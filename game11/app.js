"use strict";

import {
  bindRoomCodeInput, cleanPlayerName, createAuthoritativeRoomClient, createCountdown,
  createSessionStore, createSpectatorUi, escapeHtml, renderConnectionStatus, renderCountdown, setHidden,
  setModeVisibility
} from "/shared/client/index.js";
import { isValidCode, validateClues } from "./rules.js";

const PROTOCOL_VERSION = 3;
const CLUE_SECONDS = 150;
const GUESS_SECONDS = 100;
const REVEAL_SECONDS = 8;
const $ = (id) => document.getElementById(id);
const ids = ["masthead","connectionStatus","roomHeaderTools","setupPanel","roomPanel","hostModeButton","guestModeButton","hostSetup","guestSetup","hostNameInput","guestNameInput","playerCountSelect","createRoomButton","joinRoomButton","roomCodeInput","joinIntentField","roomCodeDisplay","seatActionButton","spectatorSettingButton","spectatorPanel","spectatorCountBadge","spectatorList","phaseBadge","roundText","timerWrap","timerText","timerBar","hostTools","startGameButton","endGameButton","notice","lobbyArea","gameArea","myTeamBadge","keywordRack","secretCode","operationTitle","encryptorName","clueComposer","clue1","clue2","clue3","submitCluesButton","clueDisplay","guessComposer","guessRoleText","guess1","guess2","guess3","submitGuessButton","waitingText","whiteScore","blackScore","historyList","resultPanel","winnerText","finalKeywords","finalRecords"];
const E = Object.fromEntries(ids.map((id) => [id, $(id)]));
const TEAM_NAME = { white: "白队", black: "黑队" };

let mode = "host";
let view = null;
let guessEditorKey = "";
let spectatorUi = null;
const sessions = createSessionStore({ gameId: "decrypto" });
const countdown = createCountdown({ onTick(value) { renderCountdown({ textElement:E.timerText, barElement:E.timerBar }, value); } });
const room = createAuthoritativeRoomClient({
  protocolVersion: PROTOCOL_VERSION,
  sessionStore: sessions,
  onStatus(status) { renderConnectionStatus(E.connectionStatus, status, room.snapshot().roomCode); },
  handlers: {
    onView(nextView) { view = nextView; if (nextView.roomRole === "spectator") guessEditorKey = ""; enterRoom(); render(); },
    onKicked() { spectatorUi?.handleSessionEnded("kicked"); },
    onRoomExpired() { spectatorUi?.handleSessionEnded("room_expired"); }
  }
});

spectatorUi = createSpectatorUi({
  room,
  getView: () => view,
  elements: {
    joinIntentField:E.joinIntentField, seatActionButton:E.seatActionButton,
    spectatorSettingButton:E.spectatorSettingButton, spectatorPanel:E.spectatorPanel,
    spectatorCountBadge:E.spectatorCountBadge, spectatorList:E.spectatorList
  },
  notify: (message) => alert(message),
  confirmAction: (message) => confirm(message),
  onSessionEnded: () => location.reload()
});

const currentView = () => view;
const sortedTeam = (players, team) => players.filter((player) => player.team === team).sort((a, b) => a.seat - b.seat);

function enterRoom() {
  setHidden(E.setupPanel, true);
  setHidden(E.roomPanel, false);
  setHidden(E.roomHeaderTools, false);
  E.masthead.classList.add("in-room");
  E.roomCodeDisplay.textContent = room.snapshot().roomCode;
}

function submit(action) {
  return room.submitAction(action).catch((error) => alert(`操作失败：${error.message}`));
}

async function createGameRoom() {
  E.createRoomButton.disabled = true;
  try {
    await room.createRoom({
      name: cleanPlayerName(E.hostNameInput.value, "情报主管"),
      capacity: Number(E.playerCountSelect.value)
    });
  } catch (error) {
    alert(`创建失败：${error.message}\n请确认已运行 node game11/signal-server.js`);
  } finally {
    E.createRoomButton.disabled = false;
  }
}

async function joinGameRoom() {
  E.joinRoomButton.disabled = true;
  try {
    const result = await room.joinRoom({
      code: E.roomCodeInput.value,
      name: cleanPlayerName(E.guestNameInput.value, "译码员"),
      intent: spectatorUi.getJoinIntent()
    });
    E.connectionStatus.textContent = spectatorUi.handleJoinResult(result).statusText;
  } catch (error) {
    alert(`加入失败：${error.message}`);
  } finally {
    E.joinRoomButton.disabled = false;
  }
}

function startGame() { submit({ type: "start" }); }
function endGameEarly() {
  if (confirm("确定结束行动并返回大厅吗？")) submit({ type: "end" });
}

function renderLobby(current, memberRole) {
  guessEditorKey = "";
  const me = current.players.find((player) => player.id === current.selfId);
  E.lobbyArea.innerHTML = ["white", "black"].map((team) => {
    const list = sortedTeam(current.players, team);
    return `<div class="panel team-column ${team}"><div class="team-head"><h2>${TEAM_NAME[team]}</h2><button data-sit="${team}" ${current.permissions?.canSit ? "" : "disabled"}>${me?.team === team ? "已入座" : "加入此队"}</button></div>${list.length ? list.map((player, index) => `<div class="seat"><i class="${player.connected ? "online" : "offline"}"></i><span><b>${index + 1}. ${escapeHtml(player.name)}</b>${player.isHost ? " · 房主" : ""}</span><span class="seat-actions">${player.id === current.selfId && current.permissions?.canMove ? '<button data-move="-1">↑</button><button data-move="1">↓</button>' : ""}</span></div>`).join("") : "<p>等待人员入座</p>"}</div>`;
  }).join("") + `<div class="panel bench"><b>未入座</b><div class="bench-list">${current.players.filter((player) => !player.team).map((player) => `<span class="player-chip">${escapeHtml(player.name)}${player.id === current.selfId && current.permissions?.canSit ? ' <button data-sit="white">入座</button>' : ""}</span>`).join("") || "无"}</div>${memberRole === "spectator" ? '<p class="spectator-action-note">你在旁观席，不占队伍名额；进入玩家席后会先回到未分队状态，再自行选择队伍。</p>' : ""}</div>`;
  E.lobbyArea.querySelectorAll("[data-sit]").forEach((button) => { button.onclick = () => submit({ type:"sit", team:button.dataset.sit }); });
  E.lobbyArea.querySelectorAll("[data-move]").forEach((button) => { button.onclick = () => submit({ type:"move", direction:Number(button.dataset.move) }); });
}

function scoreHtml(current, team) {
  const value = current.teams[team];
  return `<div class="score-team"><h3>${TEAM_NAME[team]}</h3><div class="score-tokens">截获 ${"●".repeat(value.interceptions)}${"○".repeat(2-value.interceptions)}　误传 ${"◆".repeat(value.miscommunications)}${"◇".repeat(2-value.miscommunications)}</div></div>`;
}

function codeText(code) { return code?.length ? code.join(" - ") : "未提交"; }

function renderGame(current, memberRole) {
  const me = current.players.find((player) => player.id === current.selfId);
  const active = TEAM_NAME[current.turnTeam];
  const encryptor = current.players.find((player) => player.id === current.encryptorId);
  const own = me?.team ? current.teams[me.team] : null;
  E.myTeamBadge.textContent = TEAM_NAME[me?.team] || "观察员";
  E.myTeamBadge.className = `team-badge ${me?.team || ""}`;
  E.keywordRack.innerHTML = own?.keywords.map((word, index) => `<div class="keyword"><b>${index+1}</b><span>${escapeHtml(word)}</span></div>`).join("") || `<p>${memberRole === "spectator" ? "双方关键词在行动结束前均对旁观者保密。" : "你没有队伍关键词。"}</p>`;
  setHidden(E.secretCode, !current.code);
  E.secretCode.textContent = current.code ? `本轮密码：${codeText(current.code)}` : "";
  E.operationTitle.textContent = `${active}传讯`;
  E.encryptorName.textContent = encryptor ? `传讯者：${encryptor.name}` : "";
  setHidden(E.clueComposer, !current.permissions?.canSubmitClues);
  E.clueDisplay.innerHTML = current.clues.map((clue, index) => `<div class="clue-card"><b>${index+1}</b><span>${escapeHtml(clue)}</span></div>`).join("");

  const guessRole = current.permissions?.guessRole;
  const canGuess = current.phase === "guess"
    && ((guessRole === "decode" && !current.guessStatus.decode)
      || (guessRole === "intercept" && !current.guessStatus.intercept));
  const editorKey = `${current.round}:${current.turnTeam}:${current.selfId}`;
  if (canGuess && guessEditorKey !== editorKey) {
    [E.guess1.value, E.guess2.value, E.guess3.value] = ["1", "2", "3"];
    guessEditorKey = editorKey;
  }
  setHidden(E.guessComposer, !canGuess);
  if (canGuess && current.guessDraft) {
    [E.guess1.value, E.guess2.value, E.guess3.value] = current.guessDraft.map(String);
  }
  if (canGuess) {
    const roleText = guessRole === "decode"
      ? `你是${active}指定的提交者，请提交己方破译。`
      : `你是${TEAM_NAME[me?.team]}指定的提交者，请提交拦截猜测。`;
    E.guessRoleText.textContent = `${roleText}${current.guessDraft ? " 当前选择已保存，超时将自动锁定。" : " 修改选择后会自动保存；若不修改，请点击按钮确认当前选择。"}`;
  }

  if (current.phase === "tiebreak") {
    const canSubmit = current.permissions?.canSubmitTiebreak;
    setHidden(E.guessComposer, !canSubmit);
    E.guessRoleText.textContent = "最终裁决：依次输入你认为对方 1–4 号位置的关键词。";
    if (canSubmit && !document.querySelector(".tie-word")) {
      document.querySelector(".code-inputs").innerHTML = [1,2,3,4].map((number) => `<input class="tie-word" maxlength="30" placeholder="${number} 号关键词">`).join("");
      E.submitGuessButton.textContent = "提交关键词猜测";
    }
  }

  E.waitingText.innerHTML = `${escapeHtml(statusText(current))}${memberRole === "spectator" ? '<p class="spectator-action-note">旁观模式仅显示公开提示、提交状态和已揭晓记录；双方关键词、当前密码、猜码草稿与最终裁决答案不会提前显示。</p>' : ""}`;
  E.whiteScore.innerHTML = scoreHtml(current, "white");
  E.blackScore.innerHTML = scoreHtml(current, "black");
  renderHistory(current);
}

function statusText(current) {
  if (current.phase === "clue") return current.permissions?.canSubmitClues ? "请按密码顺序写出三条全新提示。" : "传讯者正在编写三条提示……";
  if (current.phase === "guess") return `己方破译：${current.guessStatus.decode ? "已锁定" : "等待提交"}　·　拦截：${current.round === 1 ? "首轮跳过" : current.guessStatus.intercept ? "已锁定" : "等待提交"}`;
  if (current.phase === "reveal") {
    const record = current.records.at(-1);
    return `密码 ${codeText(record.code)}　·　${record.intercepted ? "对方截获成功" : "未被截获"}　·　${record.miscommunicated ? "己方发生误传" : "己方破译成功"}`;
  }
  if (current.phase === "tiebreak") return "净胜分相同：双方正在猜测对方四个关键词。";
  return "";
}

function renderHistory(current) {
  E.historyList.innerHTML = [...current.records].reverse().map((record) => `<article class="record ${record.team}"><div class="record-head"><span>第 ${record.round} 轮 · ${TEAM_NAME[record.team]}传讯</span><span>${codeText(record.code)}</span></div><div class="record-clues">${record.clues.map((clue,index) => `<span>${index+1}. ${escapeHtml(clue)} → ${record.code[index]}</span>`).join("")}</div><div class="record-result">己方 ${codeText(record.decodeGuess)} ${record.miscommunicated ? "✕ 误传" : "✓"}　/　对方 ${record.round === 1 ? "首轮不拦截" : codeText(record.interceptGuess)+(record.intercepted ? " ✓ 截获" : " ✕")}</div></article>`).join("") || "<p>提示公开后，推理档案会记录在这里。</p>";
}

function renderResult(current) {
  const names = current.outcome.winners.map((team) => TEAM_NAME[team]);
  E.winnerText.textContent = names.length === 2 ? "最终裁决仍然平手，双方共同获胜" : `${names[0]}完成截码任务`;
  E.finalKeywords.innerHTML = ["white","black"].map((team) => `<div><b>${TEAM_NAME[team]}</b><p>${current.teams[team].keywords.map((word,index) => `${index+1}. ${escapeHtml(word)}`).join("　")}</p></div>`).join("");
  E.finalRecords.innerHTML = `共完成 ${current.records.length} 次传讯，全部密码与提示已在上方档案公开。`;
}

function canStartView(current) {
  const white = sortedTeam(current.players, "white");
  const black = sortedTeam(current.players, "black");
  return current.permissions?.canStart
    && current.players.length === current.capacity
    && !current.players.some((player) => !player.connected || !player.team)
    && white.length >= 2
    && black.length >= 2;
}

function noticeText(current) {
  const encryptor = current.players.find((player) => player.id === current.encryptorId);
  return current.phase === "ended"
    ? "行动结束，双方机密现已公开。"
    : `第 ${current.round} 轮，${TEAM_NAME[current.turnTeam]}传讯${encryptor ? `，当前传讯者：${encryptor.name}` : ""}`;
}

function render() {
  const current = currentView();
  if (!current) return;
  const spectatorModel = spectatorUi.render(current);
  const memberRole = spectatorModel.memberRole;
  const lobby = current.phase === "lobby";
  const ended = current.phase === "ended";
  if (lobby && !E.guess1.isConnected) populateCodeSelects();
  E.roomCodeDisplay.textContent = room.snapshot().roomCode;
  setHidden(E.hostTools, !current.permissions?.canManage);
  E.phaseBadge.textContent = {lobby:"等待部署",clue:"编写提示",guess:"猜码中",reveal:"密码公开",tiebreak:"最终裁决",ended:"行动结束"}[current.phase];
  E.roundText.textContent = `第 ${current.round} / 8 轮`;
  setHidden(E.lobbyArea, !lobby);
  setHidden(E.gameArea, lobby || ended);
  setHidden(E.resultPanel, !ended);
  setHidden(E.startGameButton, !current.permissions?.canStart);
  E.startGameButton.disabled = !canStartView(current);
  setHidden(E.endGameButton, !current.permissions?.canEnd);
  E.notice.textContent = lobby
    ? memberRole === "spectator"
      ? "你正在旁观部署阶段，可在玩家席有空位时切换身份。"
      : `当前 ${current.players.length} / ${current.capacity} 人；所有人入座且每队至少 2 人后开始。`
    : `${memberRole === "spectator" ? "正在旁观 · " : ""}${noticeText(current)}`;
  renderLobby(current, memberRole);
  if (!lobby) renderGame(current, memberRole);
  if (ended) renderResult(current);
  if (current.deadline) {
    const duration = current.phase === "clue" ? CLUE_SECONDS : current.phase === "reveal" ? REVEAL_SECONDS : GUESS_SECONDS;
    countdown.start(current.deadline, duration * 1000);
    setHidden(E.timerWrap, false);
  } else {
    countdown.stop();
    setHidden(E.timerWrap, true);
  }
}

function populateCodeSelects() {
  const container = document.querySelector(".code-inputs");
  if (!E.guess1.isConnected) {
    container.innerHTML = '<select id="guess1"></select><select id="guess2"></select><select id="guess3"></select>';
    E.guess1 = $("guess1"); E.guess2 = $("guess2"); E.guess3 = $("guess3");
  }
  for (const select of [E.guess1,E.guess2,E.guess3]) {
    select.innerHTML = [1,2,3,4].map((number) => `<option value="${number}">${number}</option>`).join("");
    select.onchange = saveGuessDraft;
  }
  E.guess2.value = "2";
  E.guess3.value = "3";
  E.submitGuessButton.textContent = "锁定团队答案";
}

function saveGuessDraft() {
  const current = currentView();
  if (current?.phase !== "guess" || !current.permissions?.guessRole) return;
  const code = [E.guess1.value,E.guess2.value,E.guess3.value].map(Number);
  if (!isValidCode(code)) {
    E.guessRoleText.textContent = "当前组合包含重复数字，尚未保存；超时仍会采用上一次合法选择。";
    return;
  }
  submit({type:"guessDraft",code});
}

E.hostModeButton.onclick = () => { mode="host"; setModeVisibility(mode,{...E,hostButton:E.hostModeButton,guestButton:E.guestModeButton}); };
E.guestModeButton.onclick = () => { mode="guest"; setModeVisibility(mode,{...E,hostButton:E.hostModeButton,guestButton:E.guestModeButton}); };
E.createRoomButton.onclick = createGameRoom;
E.joinRoomButton.onclick = joinGameRoom;
spectatorUi.bind();
E.startGameButton.onclick = startGame;
E.endGameButton.onclick = endGameEarly;
E.submitCluesButton.onclick = () => {
  const current = currentView();
  const me = current.players.find((player) => player.id === current.selfId);
  const clues = [E.clue1.value,E.clue2.value,E.clue3.value];
  const error = validateClues(clues,current.teams[me.team].keywords,me.usedClues || []);
  if (error) return alert(error);
  submit({type:"clues",clues});
};
E.submitGuessButton.onclick = () => {
  const current = currentView();
  if (current.phase === "tiebreak") {
    submit({type:"tiebreak",words:[...document.querySelectorAll(".tie-word")].map((input) => input.value)});
    return;
  }
  const code = [E.guess1.value,E.guess2.value,E.guess3.value].map(Number);
  if (!isValidCode(code)) return alert("三位密码不能包含重复数字。");
  submit({type:"guess",code});
};
bindRoomCodeInput(E.roomCodeInput);
populateCodeSelects();
setModeVisibility(mode,{...E,hostButton:E.hostModeButton,guestButton:E.guestModeButton});
room.checkServer().then((config) => spectatorUi.applyConfig(config)).catch(()=>{});
