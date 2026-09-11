"use strict";

import {
  bindRoomCodeInput, cleanPlayerName, createAuthoritativeRoomClient, createCountdown, createSessionStore,
  createPresentationTimeline, createSpectatorUi, escapeHtml, renderConnectionStatus, renderCountdown, setHidden, setModeVisibility
} from "/shared/client/index.js";

const PROTOCOL_VERSION = 3;
const PHASE_MS = { secretReveal: 30000, questioning: 480000, accusationVote: 30000, timeoutNomination: 20000, timeoutVote: 30000 };
const PHASE_LABEL = {
  lobby: "等待行动组集结", secretReveal: "秘密身份确认", questioning: "限时问答",
  accusationVote: "临时指认表决", timeoutNomination: "超时顺序提名", timeoutVote: "最终全票表决", roundEnd: "本轮结算"
};
const $ = (id) => document.getElementById(id);
const E = Object.fromEntries([
  "hero","connectionStatus","roomHeaderTools","setupPanel","roomPanel","hostModeButton","guestModeButton","hostSetup","guestSetup",
  "hostNameInput","guestNameInput","playerCountSelect","createRoomButton","joinRoomButton","roomCodeInput","joinIntentField","roomCodeDisplay",
  "hostTools","roomPlayerCountSelect","spectatorSettingButton","seatActionButton","startGameButton","nextRoundButton","endGameButton",
  "notice","phaseTitle","roundNumber","intelligenceTable","players","focusLabel","focusText","focusHint","presentationEffects","presentationTrail",
  "presentationAnnouncement","presentationLabel","presentationText","controlDock","actionTitle","actionHint","actionButtons",
  "timerText","timerBar","secretPanel","secretRole","secretLocation","secretLocationRole","locationList","scoreboard","toggleLogButton","logList",
  "spectatorPanel","spectatorCountBadge","spectatorList"
].map((id) => [id, $(id)]));

let mode = "host";
let view = null;
let spectatorUi = null;
let selectionMode = null;
let presentation = null;

const sessions = createSessionStore({ gameId: "spyfall" });
const countdown = createCountdown({ onTick(value) { renderCountdown({ textElement: E.timerText, barElement: E.timerBar }, value); } });
const room = createAuthoritativeRoomClient({
  protocolVersion: PROTOCOL_VERSION,
  sessionStore: sessions,
  onStatus(status) { renderConnectionStatus(E.connectionStatus, status, room.snapshot().roomCode); },
  handlers: {
    onView(nextView) {
      view = nextView;
      if (!selectionStillLegal()) selectionMode = null;
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

function player(id) { return view?.players.find((item) => item.id === id) || null; }
function nameOf(id) { return player(id)?.name || "玩家"; }

function seatFor(playerId) {
  return [...E.players.querySelectorAll("[data-player-id]")].find((seat) => seat.dataset.playerId === String(playerId)) || null;
}

function presentationKindLabel(kind) {
  return {
    "question-ready": "提问权交接", question: "定向提问", "answer-complete": "回答完成",
    accusation: "紧急指认", "vote-submitted": "秘密表决", "vote-rejected": "指认驳回",
    "nomination-ready": "超时提名", nomination: "最终提名", "nomination-next": "提名权交接",
    "location-reveal": "间谍摊牌", "round-result": "本轮结案"
  }[kind] || "行动动态";
}

function playPresentationObject(event) {
  const source = seatFor(event.actorId);
  const target = seatFor(event.targetId) || E.intelligenceTable.querySelector(".public-focus");
  const highlighted = [source, target].filter(Boolean);
  highlighted.forEach((element) => element.classList.add("presentation-focus"));
  if (["accusation", "nomination", "location-reveal"].includes(event.kind)) E.intelligenceTable.classList.add("alert-event");

  let token = null;
  if (source && target && event.actorId !== event.targetId) {
    const stageRect = E.intelligenceTable.getBoundingClientRect();
    const from = source.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    token = document.createElement("span");
    token.className = "presentation-token";
    token.textContent = ["question", "answer-complete", "question-ready"].includes(event.kind) ? "?" : "!";
    token.style.setProperty("--from-x", `${from.left + from.width / 2 - stageRect.left}px`);
    token.style.setProperty("--from-y", `${from.top + from.height / 2 - stageRect.top}px`);
    token.style.setProperty("--to-x", `${to.left + to.width / 2 - stageRect.left}px`);
    token.style.setProperty("--to-y", `${to.top + to.height / 2 - stageRect.top}px`);
    E.presentationEffects.append(token);
  }
  return () => {
    highlighted.forEach((element) => element.classList.remove("presentation-focus"));
    E.intelligenceTable.classList.remove("alert-event");
    token?.remove();
  };
}

function selectionStillLegal() {
  if (!view || !selectionMode) return false;
  return selectionMode === "question" ? view.permissions.canSelectQuestionTarget
    : selectionMode === "accuse" ? view.permissions.canAccuse
      : selectionMode === "nominate" ? view.permissions.canNominate : false;
}

function enterRoom() {
  setHidden(E.setupPanel, true);
  setHidden(E.roomPanel, false);
  setHidden(E.roomHeaderTools, false);
  E.hero.classList.add("in-room");
  E.roomCodeDisplay.textContent = room.snapshot().roomCode;
}

async function createGameRoom() {
  E.createRoomButton.disabled = true;
  try { await room.createRoom({ name: cleanPlayerName(E.hostNameInput.value, "房主"), capacity: Number(E.playerCountSelect.value) }); }
  catch (error) { alert(`创建失败：${error.message}\n请确认已启动 game21 服务。`); }
  finally { E.createRoomButton.disabled = false; }
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

function targetIds() {
  if (!selectionMode || !view.selfId) return new Set();
  if (selectionMode === "question") return new Set(view.players.filter((item) => item.id !== view.selfId && item.id !== view.blockedTargetId).map((item) => item.id));
  if (["accuse", "nominate"].includes(selectionMode)) return new Set(view.players.filter((item) => item.id !== view.selfId).map((item) => item.id));
  return new Set();
}

function chooseTarget(targetId) {
  const target = player(targetId);
  if (!target) return;
  if (selectionMode === "question") submit({ type: "selectQuestionTarget", targetId });
  else if (selectionMode === "accuse" && confirm(`确认消耗本轮唯一一次指认机会，指认 ${target.name} 是间谍吗？`)) submit({ type: "accuse", targetId });
  else if (selectionMode === "nominate" && confirm(`确认提名 ${target.name} 接受全票表决吗？`)) submit({ type: "nominate", targetId });
  selectionMode = null;
}

function renderPlayers() {
  const selfIndex = view.players.findIndex((item) => item.id === view.selfId);
  const ordered = selfIndex < 0 ? view.players : [...view.players.slice(selfIndex), ...view.players.slice(0, selfIndex)];
  const leftCount = Math.floor(ordered.length / 2);
  const rightCount = ordered.length - leftCount;
  const targets = targetIds();
  E.players.innerHTML = ordered.map((item, index) => {
    const side = index < leftCount ? "left" : "right";
    const sideIndex = side === "left" ? index : index - leftCount;
    const sideCount = side === "left" ? leftCount : rightCount;
    const y = sideCount === 1 ? 50 : 7 + 86 * (sideIndex + .5) / sideCount;
    const active = [view.questionerId, view.questionTargetId, view.currentNominatorId].includes(item.id);
    const badges = [
      item.id === view.questionerId ? '<span class="badge question">提问者</span>' : "",
      item.id === view.questionTargetId ? '<span class="badge">回答中</span>' : "",
      item.id === view.currentNominatorId && view.phase === "timeoutNomination" ? '<span class="badge question">当前提名</span>' : "",
      item.accusationUsed ? '<span class="badge">已用指认</span>' : "",
      item.role === "spy" ? '<span class="badge spy">间谍</span>' : item.role === "operative" ? `<span class="badge">特工${item.locationRole ? ` · ${escapeHtml(item.locationRole)}` : ""}</span>` : ""
    ].join("");
    const targetable = targets.has(item.id);
    const responseState = view.phase === "accusationVote" && view.accusation?.targetId === item.id ? "accused" : view.phase === "timeoutVote" && view.nomination?.targetId === item.id ? "accused" : "";
    const voted = [...(view.submittedAccusationVoteIds || []), ...(view.submittedTimeoutVoteIds || [])].includes(item.id);
    return `<article data-player-id="${escapeHtml(item.id)}" data-side="${side}" style="--seat-y:${y}%" class="player-seat ${item.id === view.selfId ? "self" : ""} ${!item.connected ? "offline" : ""} ${active ? "active" : ""} ${targetable ? "targetable" : ""} ${responseState} ${voted ? "responded" : ""}" ${targetable ? `data-target-id="${escapeHtml(item.id)}" role="button" tabindex="0"` : ""}>
      <div class="seat-head"><div><b>${escapeHtml(item.name)}${item.id === view.selfId ? " · 你" : ""}</b><small>${item.isHost ? "房主 · " : ""}${item.connected ? "在线" : "离线"} · ${item.score}分</small></div>${view.permissions.canManage && view.phase === "lobby" && !item.isHost ? `<button class="small" data-kick="${escapeHtml(item.id)}" type="button">移出</button>` : ""}</div>
      <div class="seat-badges">${badges || '<span class="badge">身份保密</span>'}</div>
    </article>`;
  }).join("");
  E.players.querySelectorAll("[data-kick]").forEach((button) => { button.onclick = (event) => { event.stopPropagation(); kickPlayer(button.dataset.kick); }; });
  E.players.querySelectorAll("[data-target-id]").forEach((seat) => {
    const choose = () => chooseTarget(seat.dataset.targetId);
    seat.onclick = choose;
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

function beginSelection(kind) {
  selectionMode = selectionMode === kind ? null : kind;
  renderPlayers();
  renderActions(view.memberRole || "player");
}

function addLocationGuess() {
  const wrap = document.createElement("div");
  wrap.className = "location-select";
  const select = document.createElement("select");
  select.setAttribute("aria-label", "选择猜测地点");
  select.innerHTML = '<option value="">选择地点……</option>' + view.locations.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "danger";
  button.textContent = "公开并猜测";
  button.onclick = () => {
    const chosen = view.locations.find((item) => item.id === select.value);
    if (chosen && confirm(`确认公开间谍身份并猜测地点是“${chosen.name}”吗？该操作不可撤销。`)) submit({ type: "spyGuess", locationId: chosen.id });
  };
  wrap.append(select, button);
  E.actionButtons.append(wrap);
}

function renderSecret(memberRole) {
  const show = memberRole === "player" && view.phase !== "lobby";
  setHidden(E.secretPanel, !show);
  if (!show) return;
  if (view.phase === "roundEnd" && view.result) {
    E.secretRole.textContent = view.privateRole === "spy" ? "间谍" : "普通特工";
    E.secretLocation.textContent = `地点：${view.result.location.name}`;
    E.secretLocationRole.textContent = view.privateLocationRole ? `你的身份：${view.privateLocationRole}` : "你在本轮是潜伏间谍";
  } else if (view.privateRole === "spy") {
    E.secretRole.textContent = "你是间谍";
    E.secretLocation.textContent = "地点未知";
    E.secretLocationRole.textContent = "倾听问答，在暴露前猜出地点";
  } else {
    E.secretRole.textContent = "普通特工";
    E.secretLocation.textContent = `地点：${view.privateLocation?.name || "—"}`;
    E.secretLocationRole.textContent = `你的身份：${view.privateLocationRole || "—"}`;
  }
}

function renderActions(memberRole) {
  E.actionButtons.innerHTML = "";
  renderSecret(memberRole);
  if (memberRole === "spectator") {
    E.actionTitle.textContent = view.phase === "lobby" ? "正在旁观准备阶段" : `正在旁观：${PHASE_LABEL[view.phase]}`;
    E.actionHint.textContent = view.phase === "roundEnd" ? "本轮秘密已经公开。" : "旁观者只接收公开流程，不会获得地点、间谍身份或未结算投票。";
    return;
  }
  if (view.phase === "lobby") {
    E.actionTitle.textContent = "等待玩家到齐";
    E.actionHint.textContent = `当前 ${view.players.length}/${view.capacity} 人，房主将在所有正式玩家在线后开始五轮比赛。`;
    return;
  }
  if (view.phase === "secretReveal") {
    E.actionTitle.textContent = view.permissions.canAcknowledgeSecret ? "查看并确认秘密档案" : "等待所有玩家确认身份";
    E.actionHint.textContent = `${view.secretConfirmedCount}/${view.players.length} 人已确认。请记住信息，不要通过共享屏幕泄露。`;
    if (view.permissions.canAcknowledgeSecret) addButton("我已看清，确认身份", () => submit({ type: "acknowledgeSecret" }), "primary");
    return;
  }
  if (view.phase === "questioning") {
    if (selectionMode === "accuse") {
      E.actionTitle.textContent = "点击要指认的玩家";
      E.actionHint.textContent = "确认后将消耗你本轮唯一一次主动指认机会，并暂停问答倒计时。";
    } else if (view.permissions.canCompleteAnswer) {
      E.actionTitle.textContent = `请回答 ${nameOf(view.questionerId)} 的问题`;
      E.actionHint.textContent = "通过语音回答后确认完成；之后由你选择下一位玩家提问。";
      addButton("回答完成，接棒提问", () => submit({ type: "completeAnswer" }), "primary");
    } else if (view.permissions.canSelectQuestionTarget) {
      E.actionTitle.textContent = selectionMode === "question" ? "点击桌面上的提问对象" : "轮到你提出问题";
      E.actionHint.textContent = view.blockedTargetId ? `不能立即反问 ${nameOf(view.blockedTargetId)}。` : "选择任意另一名玩家，通过语音提问。";
      addButton(selectionMode === "question" ? "取消选择" : "选择提问对象", () => beginSelection("question"), "primary");
    } else {
      E.actionTitle.textContent = view.questionTargetId ? `${nameOf(view.questionerId)} 正在询问 ${nameOf(view.questionTargetId)}` : `等待 ${nameOf(view.questionerId)} 选择提问对象`;
      E.actionHint.textContent = "仔细倾听问题和回答，寻找言语中的破绽。";
    }
    if (view.permissions.canAccuse) addButton(selectionMode === "accuse" ? "取消指认" : "发起一次指认", () => beginSelection("accuse"), "danger");
    if (view.permissions.canSpyGuess) addLocationGuess();
    return;
  }
  if (view.phase === "accusationVote") {
    E.actionTitle.textContent = `${nameOf(view.accusation.accuserId)} 指认 ${nameOf(view.accusation.targetId)}`;
    if (view.selfId === view.accusation.targetId) E.actionHint.textContent = "你是被指认者，不能参与这次表决。";
    else if (view.permissions.canVoteAccusation) {
      E.actionHint.textContent = "必须除嫌疑人外全票赞成才会公开身份。你的选择在结算前保密。";
      addButton("赞成指认", () => submit({ type: "voteAccusation", agree: true }), "danger");
      addButton("反对指认", () => submit({ type: "voteAccusation", agree: false }));
    } else E.actionHint.textContent = `已提交 ${view.submittedAccusationVoteIds.length}/${view.players.length - 1} 票，等待其他玩家。`;
    return;
  }
  if (view.phase === "timeoutNomination") {
    E.actionTitle.textContent = `等待 ${nameOf(view.currentNominatorId)} 提名嫌疑人`;
    E.actionHint.textContent = `提名进度 ${view.nominationIndex + 1}/${view.nominationCount}。全部提名均未获全票时，间谍获胜。`;
    if (view.permissions.canNominate) {
      addButton(selectionMode === "nominate" ? "取消选择" : "选择嫌疑人", () => beginSelection("nominate"), "primary");
      addButton("跳过本次提名", () => submit({ type: "skipNomination" }));
    }
    return;
  }
  if (view.phase === "timeoutVote") {
    E.actionTitle.textContent = `${nameOf(view.nomination.nominatorId)} 提名 ${nameOf(view.nomination.targetId)}`;
    if (view.selfId === view.nomination.targetId) E.actionHint.textContent = "你是被提名者，不能参与表决。";
    else if (view.permissions.canVoteTimeout) {
      E.actionHint.textContent = "只有全票赞成才会公开身份，否则继续下一位玩家的提名。";
      addButton("赞成提名", () => submit({ type: "voteTimeoutNomination", agree: true }), "danger");
      addButton("反对提名", () => submit({ type: "voteTimeoutNomination", agree: false }));
    } else E.actionHint.textContent = `已提交 ${view.submittedTimeoutVoteIds.length}/${view.players.length - 1} 票。`;
    return;
  }
  if (view.phase === "roundEnd") {
    E.actionTitle.textContent = view.matchComplete ? "五轮行动全部结束" : `第${view.round}轮结算完成`;
    E.actionHint.textContent = `${view.result.reason} 地点是“${view.result.location.name}”，间谍是 ${nameOf(view.result.spyId)}。${view.matchComplete ? ` 比赛优胜者：${view.result.winners.map(nameOf).join("、")}。` : ""}`;
  }
}

function renderFocus() {
  E.focusLabel.textContent = "CASE STATUS";
  if (view.phase === "lobby") { E.focusText.textContent = "地点尚未确定"; E.focusHint.textContent = "等待行动组集结"; return; }
  if (view.phase === "secretReveal") { E.focusText.textContent = "秘密档案正在分发"; E.focusHint.textContent = `${view.secretConfirmedCount}/${view.players.length} 人已确认`; return; }
  if (view.phase === "questioning") {
    E.focusText.textContent = view.questionTargetId ? `${nameOf(view.questionerId)} → ${nameOf(view.questionTargetId)}` : `${nameOf(view.questionerId)} 正在选择对象`;
    E.focusHint.textContent = view.questionTargetId ? "通过语音完成一问一答" : "回答者将成为下一位提问者";
    return;
  }
  if (view.phase === "accusationVote") { E.focusText.textContent = `指认：${nameOf(view.accusation.targetId)}`; E.focusHint.textContent = `发起者 ${nameOf(view.accusation.accuserId)} · ${view.submittedAccusationVoteIds.length}/${view.players.length - 1} 已提交`; return; }
  if (view.phase === "timeoutNomination") { E.focusText.textContent = `${nameOf(view.currentNominatorId)} 正在提名`; E.focusHint.textContent = `第 ${view.nominationIndex + 1}/${view.nominationCount} 次机会`; return; }
  if (view.phase === "timeoutVote") { E.focusText.textContent = `最终嫌疑人：${nameOf(view.nomination.targetId)}`; E.focusHint.textContent = `${view.submittedTimeoutVoteIds.length}/${view.players.length - 1} 已提交`; return; }
  E.focusLabel.textContent = "DECLASSIFIED";
  E.focusText.textContent = `${view.result.location.name} · 间谍 ${nameOf(view.result.spyId)}`;
  E.focusHint.textContent = view.result.reason;
}

function renderSidebar() {
  E.locationList.innerHTML = view.locations.map((item) => `<span class="location-chip">${escapeHtml(item.name)}</span>`).join("");
  E.scoreboard.innerHTML = [...view.players].sort((a, b) => b.score - a.score).map((item) => `<div class="score-row"><span>${escapeHtml(item.name)}</span><b>${item.score}分</b></div>`).join("");
  E.logList.innerHTML = view.logs.map((entry) => `<div class="log-item">${escapeHtml(entry.text)}</div>`).join("") || '<p class="muted">暂无公开记录</p>';
}

function render() {
  if (!view) return;
  const model = spectatorUi.render(view);
  const memberRole = model.memberRole;
  view.memberRole = memberRole;
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
  E.notice.textContent = view.phase === "lobby" ? `等待玩家加入：${view.players.length}/${view.capacity}` : `第 ${view.round}/${view.matchRounds} 轮 · ${PHASE_LABEL[view.phase]} · 发牌者：${nameOf(view.dealerId)}`;
  E.controlDock.dataset.role = memberRole;
  renderPlayers();
  renderFocus();
  renderActions(memberRole);
  renderSidebar();
  if (view.deadline) countdown.start(view.deadline, PHASE_MS[view.phase] || 30000);
  else { countdown.stop(); E.timerText.textContent = "--"; E.timerBar.style.width = "0"; }
}

presentation = createPresentationTimeline({
  container: E.intelligenceTable,
  trailPath: E.presentationTrail,
  announcement: E.presentationAnnouncement,
  labelElement: E.presentationLabel,
  textElement: E.presentationText,
  effectsElement: E.presentationEffects,
  resolveSource: (event) => seatFor(event.actorId),
  resolveTarget: (event) => seatFor(event.targetId) || E.intelligenceTable.querySelector(".public-focus"),
  labelFor: (event) => presentationKindLabel(event.kind),
  beforePlay: playPresentationObject,
  durationMs: 2300,
  reducedDurationMs: 950
});

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
  E.endGameButton.onclick = () => { if (confirm("确定结束当前比赛并清空本场得分吗？")) submit({ type: "end" }); };
  E.toggleLogButton.onclick = () => { const collapsed = E.logList.classList.toggle("collapsed"); E.toggleLogButton.textContent = collapsed ? "展开" : "收起"; };
  spectatorUi.bind();
  selectMode("host");
  try { spectatorUi.applyConfig(await room.checkServer()); } catch { /* 创建或加入时展示连接错误 */ }
}

init();
