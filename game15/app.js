"use strict";

import {
  bindRoomCodeInput,
  cleanPlayerName,
  createAuthoritativeRoomClient,
  createCountdown,
  createSessionStore,
  escapeHtml,
  renderConnectionStatus,
  renderCountdown,
  setHidden,
  setModeVisibility
} from "/shared/client/index.js";
import { COLOR_LABELS, COLORS, validateMeld } from "./rules.mjs";

const PROTOCOL_VERSION = 3;
const ACTION_SECONDS = 90;
const $ = (id) => document.getElementById(id);
const E = Object.fromEntries([
  "connectionStatus", "setupPanel", "roomPanel", "hostModeButton", "guestModeButton", "hostSetup",
  "guestSetup", "hostNameInput", "guestNameInput", "playerCountSelect", "createRoomButton", "joinRoomButton",
  "roomCodeInput", "roomCodeDisplay", "hostTools", "roomPlayerCountSelect", "startGameButton", "nextGameButton",
  "restartMatchButton", "endGameButton", "scoreboard", "toggleLogButton", "logList", "notice", "controlDock",
  "actionTitle", "actionHint", "actionButtons", "timerText", "timerBar", "handHint", "hand", "gameNumber",
  "totalGames", "poolCount", "changeNotice", "table", "newMeldActions", "resultPanel", "resultTitle", "resultScores"
].map((id) => [id, $(id)]));

let mode = "host";
let view = null;
let draft = null;
let selectedTileId = null;
let handSort = "color";
let markRequested = false;
let markedTurnId = null;
let changeTimer = null;

const sessions = createSessionStore({ gameId: "rummikub" });
const countdown = createCountdown({
  onTick(value) { renderCountdown({ textElement: E.timerText, barElement: E.timerBar }, value); }
});

const room = createAuthoritativeRoomClient({
  protocolVersion: PROTOCOL_VERSION,
  sessionStore: sessions,
  onStatus(status) { renderConnectionStatus(E.connectionStatus, status, room.snapshot().roomCode); },
  handlers: {
    onView(nextView) {
      const keepDraft = draft && nextView.phase === "playing" && nextView.turnId === draft.turnId
        && nextView.currentPlayerId === nextView.selfId;
      view = nextView;
      if (!keepDraft) initializeDraft();
      if (view.turnEdited) {
        markRequested = false;
        markedTurnId = view.turnId;
      } else if (markedTurnId === view.turnId && !draftChanged()) {
        markedTurnId = null;
      }
      enterRoom();
      render();
      if (view.permissions.canAct && view.turnEdited && draft && !draftChanged() && !markRequested) {
        markRequested = true;
        queueMicrotask(() => submit({ type: "resetEdit" }).finally(() => { markRequested = false; }));
      }
    },
    onKicked() { alert("你已被房主移出房间。"); location.reload(); }
  }
});

function submit(action) {
  return Promise.resolve(room.submitAction(action)).catch((error) => {
    E.connectionStatus.textContent = `操作失败：${error.message}`;
    alert(error.message);
    return null;
  });
}

function enterRoom() {
  setHidden(E.setupPanel, true);
  setHidden(E.roomPanel, false);
  E.roomCodeDisplay.textContent = room.snapshot().roomCode;
}

async function createGameRoom() {
  E.createRoomButton.disabled = true;
  try {
    await room.createRoom({ name: cleanPlayerName(E.hostNameInput.value, "房主"), capacity: Number(E.playerCountSelect.value) });
  } catch (error) {
    alert(`创建失败：${error.message}\n请确认已通过 node game15/signal-server.js 启动服务。`);
  } finally { E.createRoomButton.disabled = false; }
}

async function joinGameRoom() {
  E.joinRoomButton.disabled = true;
  try { await room.joinRoom({ code: E.roomCodeInput.value, name: cleanPlayerName(E.guestNameInput.value, "玩家") }); }
  catch (error) { alert(`加入失败：${error.message}`); }
  finally { E.joinRoomButton.disabled = false; }
}

async function kickPlayer(playerId) {
  const player = view.players.find((item) => item.id === playerId);
  if (!player || player.isHost || !confirm(`确定移出 ${player.name} 吗？进行中的比赛会返回大厅。`)) return;
  try { await room.kick(playerId); } catch (error) { alert(error.message); }
}

function serverTableLayout() {
  return (view?.table || []).map((meld) => ({ id: meld.id, kind: meld.kind, tileIds: meld.tiles.map((tile) => tile.id) }));
}

function initializeDraft() {
  if (!view || view.phase !== "playing" || !view.permissions.canAct) {
    draft = null;
    selectedTileId = null;
    return;
  }
  const table = serverTableLayout();
  draft = {
    turnId: view.turnId,
    base: JSON.stringify(table),
    table,
    handIds: view.hand.map((tile) => tile.id),
    originalHandIds: new Set(view.hand.map((tile) => tile.id)),
    undo: []
  };
  selectedTileId = null;
  markRequested = false;
  markedTurnId = view.turnEdited ? view.turnId : null;
}

function tileMap() {
  return new Map([
    ...(view?.table || []).flatMap((meld) => meld.tiles),
    ...(view?.hand || [])
  ].map((tile) => [tile.id, tile]));
}

function draftChanged() {
  return Boolean(draft && JSON.stringify(draft.table) !== draft.base);
}

function snapshotDraft() {
  return { table: structuredClone(draft.table), handIds: [...draft.handIds] };
}

function requestEditMark() {
  if (!view?.permissions.canAct || view.turnEdited || markRequested || markedTurnId === view.turnId) return;
  markRequested = true;
  markedTurnId = view.turnId;
  submit({ type: "beginEdit" }).finally(() => { markRequested = false; });
}

function mutateDraft(callback) {
  if (!draft || !view.permissions.canAct) return;
  draft.undo.push(snapshotDraft());
  draft.undo = draft.undo.slice(-60);
  callback();
  draft.table = draft.table.filter((meld) => meld.tileIds.length);
  selectedTileId = null;
  if (draftChanged()) requestEditMark();
  render();
}

function locateDraftTile(id) {
  const handIndex = draft?.handIds.indexOf(id) ?? -1;
  if (handIndex >= 0) return { place: "hand", index: handIndex };
  for (let meldIndex = 0; meldIndex < (draft?.table.length || 0); meldIndex += 1) {
    const tileIndex = draft.table[meldIndex].tileIds.indexOf(id);
    if (tileIndex >= 0) return { place: "table", meldIndex, tileIndex };
  }
  return null;
}

function tileLocked(id) {
  const self = view.players.find((player) => player.id === view.selfId);
  if (self?.opened) return false;
  return view.table.some((meld) => meld.tiles.some((tile) => tile.id === id));
}

function removeDraftTile(id) {
  const location = locateDraftTile(id);
  if (!location) return false;
  if (location.place === "hand") draft.handIds.splice(location.index, 1);
  else draft.table[location.meldIndex].tileIds.splice(location.tileIndex, 1);
  return true;
}

function moveTileToMeld(id, meldIndex, beforeId = null) {
  if (!draft || tileLocked(id) || meldIndex < 0 || meldIndex >= draft.table.length) return;
  const self = view.players.find((player) => player.id === view.selfId);
  const destinationIsOriginal = draft.table[meldIndex].tileIds.some((tileId) => !draft.originalHandIds.has(tileId));
  if (!self.opened && destinationIsOriginal) return;
  mutateDraft(() => {
    removeDraftTile(id);
    const destination = draft.table[meldIndex];
    const index = beforeId ? destination.tileIds.indexOf(beforeId) : -1;
    destination.tileIds.splice(index >= 0 ? index : destination.tileIds.length, 0, id);
  });
}

function moveTileToHand(id) {
  if (!draft?.originalHandIds.has(id)) return;
  mutateDraft(() => { removeDraftTile(id); draft.handIds.push(id); });
  if (!draftChanged() && view.turnEdited) submit({ type: "resetEdit" });
}

function moveTileToNewMeld(id, kind) {
  if (!draft || tileLocked(id) || !["group", "run"].includes(kind)) return;
  mutateDraft(() => {
    removeDraftTile(id);
    draft.table.push({ id: `draft-${Date.now()}-${draft.table.length}`, kind, tileIds: [id] });
  });
}

function toggleMeldKind(index) {
  if (!draft?.table[index]) return;
  const self = view.players.find((player) => player.id === view.selfId);
  if (!self.opened && draft.table[index].tileIds.some((id) => !draft.originalHandIds.has(id))) return;
  mutateDraft(() => { draft.table[index].kind = draft.table[index].kind === "group" ? "run" : "group"; });
}

function undoDraft() {
  const previous = draft?.undo.pop();
  if (!previous) return;
  draft.table = previous.table;
  draft.handIds = previous.handIds;
  selectedTileId = null;
  if (!draftChanged() && view.turnEdited) submit({ type: "resetEdit" });
  render();
}

function resetDraft() {
  if (!draft) return;
  draft.table = JSON.parse(draft.base);
  draft.handIds = view.hand.map((tile) => tile.id);
  draft.undo = [];
  selectedTileId = null;
  if (view.turnEdited) submit({ type: "resetEdit" });
  render();
}

function activeLayout() {
  return draft && view.permissions.canAct ? draft.table : serverTableLayout();
}

function checkedMeld(meld) {
  const map = tileMap();
  return validateMeld({ kind: meld.kind, tiles: meld.tileIds.map((id) => map.get(id)).filter(Boolean) });
}

function draftStatus() {
  if (!draft) return { changed: false, valid: true, used: 0, score: 0 };
  const results = draft.table.map(checkedMeld);
  const used = [...draft.originalHandIds].filter((id) => !draft.handIds.includes(id)).length;
  const baseIds = new Set(view.table.flatMap((meld) => meld.tiles.map((tile) => tile.id)));
  const newScore = draft.table.reduce((total, meld, index) => {
    return meld.tileIds.some((id) => baseIds.has(id)) ? total : total + (results[index].score || 0);
  }, 0);
  return { changed: draftChanged(), valid: results.every((result) => result.valid), used, score: newScore };
}

function tileHtml(tile, { source = "table", changed = false, locked = false, assignment = null } = {}) {
  const color = tile.joker ? "joker" : tile.color;
  const label = tile.joker ? "★" : tile.number;
  const assignmentText = tile.joker && assignment ? `${COLOR_LABELS[assignment.color]}${assignment.number}` : "";
  return `<button type="button" class="tile tile-${color} ${selectedTileId === tile.id ? "selected" : ""} ${changed ? "recently-changed" : ""} ${locked ? "locked" : ""}" draggable="${!locked}" data-tile-id="${escapeHtml(tile.id)}" data-source="${source}">
    <span>${label}</span>${assignmentText ? `<small>${escapeHtml(assignmentText)}</small>` : ""}
  </button>`;
}

function sortedHandIds() {
  if (!draft) return view.hand.map((tile) => tile.id);
  const map = tileMap();
  const colorRank = new Map(COLORS.map((color, index) => [color, index]));
  return [...draft.handIds].sort((leftId, rightId) => {
    const left = map.get(leftId), right = map.get(rightId);
    if (left.joker !== right.joker) return left.joker ? 1 : -1;
    if (left.joker) return left.id.localeCompare(right.id);
    return handSort === "color"
      ? colorRank.get(left.color) - colorRank.get(right.color) || left.number - right.number
      : left.number - right.number || colorRank.get(left.color) - colorRank.get(right.color);
  });
}

function renderHand() {
  const map = tileMap();
  const ids = view.permissions.canAct && draft ? sortedHandIds() : view.hand.map((tile) => tile.id);
  E.hand.innerHTML = ids.map((id) => tileHtml(map.get(id), { source: "hand" })).join("")
    || '<p class="waiting">牌架已经清空。</p>';
  E.handHint.textContent = view.phase === "playing"
    ? `${ids.length}张 · ${view.players.find((player) => player.id === view.selfId)?.opened ? "已完成开牌" : "尚未完成30分开牌"}`
    : "开局获得14张牌";
}

function renderTable() {
  const map = tileMap();
  const layout = activeLayout();
  const changedIds = new Set(view.lastChange?.until > Date.now() ? view.lastChange.tileIds : []);
  const self = view.players.find((player) => player.id === view.selfId);
  E.table.innerHTML = layout.map((meld, meldIndex) => {
    const checked = checkedMeld(meld);
    const assignmentMap = new Map((checked.assignments || []).map((item) => [item.tileId, item]));
    const locked = Boolean(view.permissions.canAct && !self.opened && meld.tileIds.some((id) => !draft.originalHandIds.has(id)));
    return `<article class="meld ${checked.valid ? "valid" : "invalid"} ${locked ? "locked-meld" : ""}" data-meld-index="${meldIndex}">
      <header><b>${meld.kind === "group" ? "数字组" : "顺子"}</b><span>${checked.valid ? `${checked.score}分` : checked.error}</span>${view.permissions.canAct && !locked ? `<button type="button" data-toggle-kind="${meldIndex}">改为${meld.kind === "group" ? "顺子" : "数字组"}</button>` : ""}</header>
      <div class="meld-tiles">
        ${meld.tileIds.map((id) => tileHtml(map.get(id), { changed: changedIds.has(id), locked, assignment: assignmentMap.get(id) })).join("")}
        ${view.permissions.canAct && !locked ? `<button type="button" class="drop-end" data-drop-meld="${meldIndex}">放到末尾</button>` : ""}
      </div>
    </article>`;
  }).join("") || '<div class="empty-table"><b>牌桌还是空的</b><span>当前玩家完成30分开牌后，公共牌组会出现在这里。</span></div>';
  setHidden(E.newMeldActions, !view.permissions.canAct);
}

function addAction(text, handler, className = "", disabled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.className = className;
  button.disabled = disabled;
  button.addEventListener("click", handler);
  E.actionButtons.append(button);
}

function renderActions() {
  E.actionButtons.innerHTML = "";
  E.actionHint.textContent = "";
  const current = view.players.find((player) => player.id === view.currentPlayerId);
  if (view.phase === "lobby") {
    E.actionTitle.textContent = "等待玩家到齐";
    E.actionHint.textContent = `当前${view.players.length}/${view.capacity}人，比赛固定进行${view.capacity}局。`;
    return;
  }
  if (view.phase === "gameEnd" || view.phase === "matchEnd") {
    E.actionTitle.textContent = view.phase === "matchEnd" ? "比赛全部结束" : `第${view.gameNumber}局结束`;
    E.actionHint.textContent = view.phase === "matchEnd" ? "最终名次已经结算。" : "所有玩家在线后，由房主开始下一局。";
    return;
  }
  if (!view.permissions.canAct) {
    E.actionTitle.textContent = `等待${current?.name || "当前玩家"}行动`;
    E.actionHint.textContent = view.turnEdited ? "对方正在整理私密草稿，确认后牌桌会一次性更新。" : "你可以观察公共牌桌并规划自己的回合。";
    return;
  }
  const status = draftStatus();
  const self = view.players.find((player) => player.id === view.selfId);
  E.actionTitle.textContent = self.opened ? "整理牌桌并提交" : "完成至少30分的首次开牌";
  E.actionHint.textContent = status.changed
    ? `${status.valid ? "当前草稿中的牌组全部合法" : "仍有不合法或未完成牌组"} · 已使用${status.used}张手牌${self.opened ? "" : ` · 新牌组${status.score}分`}`
    : "拖动牌块，或先点一张牌再点目标位置。草稿只有你能看到。";
  addAction("撤销一步", undoDraft, "", !draft.undo.length);
  addAction("重置本回合", resetDraft, "", !status.changed);
  addAction(handSort === "color" ? "手牌改按数字整理" : "手牌改按颜色整理", () => { handSort = handSort === "color" ? "number" : "color"; renderHand(); });
  const ready = status.changed && status.valid && status.used > 0 && (self.opened || status.score >= 30) && view.turnEdited && !markRequested;
  addAction("确认并公布牌桌", () => submit({ type: "commitLayout", layout: draft.table }), "primary", !ready);
  if (view.permissions.canDraw) addAction("摸1张并结束回合", () => {
    if (!status.changed || confirm("当前草稿会被撤销，然后摸1张并结束回合。确定吗？")) submit({ type: "draw" });
  }, "draw-action");
  if (view.permissions.canPassEmpty) addAction("牌池已空：声明无法出牌", () => {
    if (!status.changed || confirm("当前草稿会被撤销，并声明无法出牌。确定吗？")) submit({ type: "passEmpty" });
  }, "draw-action");
}

function renderScoreboard() {
  E.scoreboard.innerHTML = view.players.map((player) => `<div class="score-row ${player.id === view.currentPlayerId && view.phase === "playing" ? "current" : ""}">
    <span><b>${escapeHtml(player.name)}</b><small>${player.connected ? "在线" : "离线"}${player.opened ? " · 已开牌" : ""}</small></span>
    <span><b>${player.score}</b><small>${player.wins}胜 · 手牌${player.handCount}</small></span>
    ${view.permissions.canKick && !player.isHost ? `<button type="button" data-kick="${escapeHtml(player.id)}">移出</button>` : ""}
  </div>`).join("");
  E.scoreboard.querySelectorAll("[data-kick]").forEach((button) => button.addEventListener("click", () => kickPlayer(button.dataset.kick)));
}

function renderChangeNotice() {
  if (changeTimer) clearTimeout(changeTimer);
  const change = view.lastChange;
  const active = change && change.until > Date.now();
  setHidden(E.changeNotice, !active);
  if (!active) return;
  const actor = view.players.find((player) => player.id === change.actorId);
  E.changeNotice.textContent = `${actor?.name || "一名玩家"}刚刚更新了牌桌，高亮牌块为本次发生变化的位置。`;
  changeTimer = setTimeout(() => { setHidden(E.changeNotice, true); renderTable(); }, change.until - Date.now());
}

function renderResult() {
  const result = view.gameResult;
  setHidden(E.resultPanel, !result);
  if (!result) return;
  const winners = result.winnerIds.map((id) => view.players.find((player) => player.id === id)?.name).filter(Boolean);
  E.resultTitle.textContent = `${winners.join("、")}赢得第${view.gameNumber}局`;
  E.resultScores.innerHTML = result.scores.map((item) => {
    const player = view.players.find((candidate) => candidate.id === item.playerId);
    return `<div><span>${escapeHtml(player?.name || "玩家")} · 剩余${item.remaining}点</span><b>${item.delta >= 0 ? "+" : ""}${item.delta}</b></div>`;
  }).join("");
}

function renderLog() {
  E.logList.innerHTML = view.logs.map((entry) => `<div class="log-item">${escapeHtml(entry.text)}</div>`).join("") || '<p class="waiting">暂无记录</p>';
}

function render() {
  if (!view) return;
  const current = view.players.find((player) => player.id === view.currentPlayerId);
  setHidden(E.hostTools, !view.permissions.canManage);
  setHidden(E.startGameButton, !view.permissions.canStart);
  setHidden(E.nextGameButton, !view.permissions.canNextGame);
  setHidden(E.restartMatchButton, !view.permissions.canRestartMatch);
  setHidden(E.endGameButton, !view.permissions.canEnd);
  E.startGameButton.disabled = view.players.length !== view.capacity || view.players.some((player) => !player.connected);
  E.nextGameButton.disabled = view.players.some((player) => !player.connected);
  E.restartMatchButton.disabled = view.players.some((player) => !player.connected);
  E.roomPlayerCountSelect.value = String(view.capacity);
  E.roomPlayerCountSelect.disabled = !view.permissions.canSetCapacity;
  E.gameNumber.textContent = String(view.gameNumber);
  E.totalGames.textContent = String(view.totalGames);
  E.poolCount.textContent = String(view.poolCount);
  E.notice.textContent = view.phase === "lobby" ? `等待玩家加入：${view.players.length}/${view.capacity}`
    : view.phase === "playing" ? `当前行动：${current?.name || "玩家"}${view.turnEdited ? " · 正在整理草稿" : ""}`
      : view.phase === "gameEnd" ? `第${view.gameNumber}局结束，等待下一局` : "固定局数比赛已经结束";
  E.controlDock.dataset.expanded = String(Boolean(view.permissions.canAct));
  renderScoreboard();
  renderActions();
  renderHand();
  renderTable();
  renderChangeNotice();
  renderResult();
  renderLog();
  if (view.deadline) countdown.start(view.deadline, ACTION_SECONDS * 1000);
  else { countdown.stop(); E.timerText.textContent = "--"; E.timerBar.style.width = "0"; }
}

function handleTileClick(id) {
  if (!view.permissions.canAct || tileLocked(id)) return;
  if (!selectedTileId || selectedTileId === id) {
    selectedTileId = selectedTileId === id ? null : id;
    render();
    return;
  }
  const target = locateDraftTile(id);
  if (target?.place === "table") moveTileToMeld(selectedTileId, target.meldIndex, id);
  else if (target?.place === "hand" && draft.originalHandIds.has(selectedTileId)) moveTileToHand(selectedTileId);
}

function bindBoardEvents() {
  document.addEventListener("click", (event) => {
    const tile = event.target.closest("[data-tile-id]");
    if (tile) return handleTileClick(tile.dataset.tileId);
    const end = event.target.closest("[data-drop-meld]");
    if (end && selectedTileId) return moveTileToMeld(selectedTileId, Number(end.dataset.dropMeld));
    const toggle = event.target.closest("[data-toggle-kind]");
    if (toggle) return toggleMeldKind(Number(toggle.dataset.toggleKind));
    const fresh = event.target.closest("[data-new-kind]");
    if (fresh && selectedTileId) return moveTileToNewMeld(selectedTileId, fresh.dataset.newKind);
  });
  document.addEventListener("dragstart", (event) => {
    const tile = event.target.closest("[data-tile-id]");
    if (!tile || tile.classList.contains("locked")) return event.preventDefault();
    selectedTileId = tile.dataset.tileId;
    event.dataTransfer.setData("text/plain", selectedTileId);
    event.dataTransfer.effectAllowed = "move";
  });
  document.addEventListener("dragover", (event) => {
    if (event.target.closest("[data-tile-id], [data-drop-meld], [data-drop-hand], [data-new-kind]")) event.preventDefault();
  });
  document.addEventListener("drop", (event) => {
    const id = event.dataTransfer.getData("text/plain") || selectedTileId;
    if (!id) return;
    event.preventDefault();
    const targetTile = event.target.closest("[data-tile-id]");
    if (targetTile) {
      const target = locateDraftTile(targetTile.dataset.tileId);
      if (target?.place === "table") moveTileToMeld(id, target.meldIndex, targetTile.dataset.tileId);
      else if (target?.place === "hand") moveTileToHand(id);
      return;
    }
    const meld = event.target.closest("[data-drop-meld]");
    if (meld) return moveTileToMeld(id, Number(meld.dataset.dropMeld));
    const fresh = event.target.closest("[data-new-kind]");
    if (fresh) return moveTileToNewMeld(id, fresh.dataset.newKind);
    if (event.target.closest("[data-drop-hand]")) moveTileToHand(id);
  });
}

function selectMode(nextMode) {
  mode = nextMode;
  setModeVisibility(mode, { hostButton: E.hostModeButton, guestButton: E.guestModeButton, hostSetup: E.hostSetup, guestSetup: E.guestSetup, hostTools: E.hostTools });
}

function init() {
  bindRoomCodeInput(E.roomCodeInput);
  bindBoardEvents();
  E.hostModeButton.addEventListener("click", () => selectMode("host"));
  E.guestModeButton.addEventListener("click", () => selectMode("guest"));
  E.createRoomButton.addEventListener("click", createGameRoom);
  E.joinRoomButton.addEventListener("click", joinGameRoom);
  E.roomPlayerCountSelect.addEventListener("change", () => submit({ type: "setCapacity", capacity: Number(E.roomPlayerCountSelect.value) }));
  E.startGameButton.addEventListener("click", () => submit({ type: "start" }));
  E.nextGameButton.addEventListener("click", () => submit({ type: "nextGame" }));
  E.restartMatchButton.addEventListener("click", () => submit({ type: "restartMatch" }));
  E.endGameButton.addEventListener("click", () => { if (confirm("确定结束当前比赛并返回房间大厅吗？")) submit({ type: "end" }); });
  E.toggleLogButton.addEventListener("click", () => {
    const collapsed = E.logList.classList.toggle("collapsed");
    E.toggleLogButton.textContent = collapsed ? "展开" : "收起";
  });
  selectMode("host");
  room.checkServer().catch(() => {});
}

init();
