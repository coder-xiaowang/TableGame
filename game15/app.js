"use strict";

import {
  bindRoomCodeInput,
  cleanPlayerName,
  createAuthoritativeRoomClient,
  createCountdown,
  createRoomEntryController,
  createSessionStore,
  createScopedDraftStore,
  createSpectatorUi,
  escapeHtml,
  renderConnectionStatus,
  renderCountdown,
  serverNow,
  setHidden,
  setModeVisibility
} from "/shared/client/index.js";
import { COLOR_LABELS, COLORS, validateMeld } from "./rules.mjs";
import { createGame15PartitionRenderer, createGame15RenderModel } from "./render-partitions.mjs";
import { createEditSynchronizer } from "./edit-sync.mjs";
import { draftContext, restoreDraft } from "./draft-state.mjs";

const PROTOCOL_VERSION = 3;
const ACTION_SECONDS = 90;
const $ = (id) => document.getElementById(id);
const E = Object.fromEntries([
  "hero", "connectionStatus", "roomHeaderTools", "setupPanel", "roomPanel", "hostModeButton", "guestModeButton", "hostSetup",
  "guestSetup", "hostNameInput", "guestNameInput", "playerCountSelect", "createRoomButton", "joinRoomButton",
  "roomCodeInput", "joinIntentField", "roomCodeDisplay", "hostTools", "roomPlayerCountSelect",
  "spectatorSettingButton", "seatActionButton",
  "spectatorPanel", "spectatorCountBadge", "spectatorList", "startGameButton", "nextGameButton",
  "restartMatchButton", "endGameButton", "scoreboard", "toggleLogButton", "logList", "notice", "controlDock",
  "actionTitle", "actionHint", "actionButtons", "timerText", "timerBar", "handZone", "handHint", "hand", "gameNumber",
  "totalGames", "poolCount", "changeNotice", "table", "newMeldActions", "resultPanel", "resultTitle", "resultScores"
].map((id) => [id, $(id)]));

let mode = "host";
let view = null;
let draft = null;
let selectedTileId = null;
let handSort = "color";
let turnSubmitPending = false;
let restoredDraft = false;
let changeTimer = null;
let spectatorUi = null;

const sessions = createSessionStore({ gameId: "rummikub" });
const draftStore = createScopedDraftStore("rummikub");
const editSync = createEditSynchronizer({
  getState: () => ({ key: draftContext(view, room.snapshot().roomCode), edited: Boolean(view?.turnEdited), dirty: draftChanged() }),
  send: action => room.submitAction(action),
  onChange: () => render()
});
const countdown = createCountdown({
  onTick(value) { renderCountdown({ textElement: E.timerText, barElement: E.timerBar }, value); }
});

const room = createAuthoritativeRoomClient({
  protocolVersion: PROTOCOL_VERSION,
  sessionStore: sessions,
  onStatus(status) { renderConnectionStatus(E.connectionStatus, status, room.snapshot().roomCode); },
  handlers: {
    onView(nextView) {
      const keepDraft = draft && draft.context === draftContext(nextView, room.snapshot().roomCode);
      view = nextView;
      if (!keepDraft) initializeDraft();
      editSync.observe();
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
    joinIntentField: E.joinIntentField,
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

function submit(action) {
  return Promise.resolve(room.submitAction(action)).catch((error) => {
    E.connectionStatus.textContent = `操作失败：${error.message}`;
    alert(error.message);
    return null;
  });
}

async function submitTurn(action) {
  if (turnSubmitPending || !view?.permissions.canAct) return;
  const context = draftContext(view, room.snapshot().roomCode);
  turnSubmitPending = true;
  render();
  try { return await submit(action); }
  finally {
    if (context === draftContext(view, room.snapshot().roomCode)) { turnSubmitPending = false; render(); }
  }
}

function enterRoom() {
  setHidden(E.setupPanel, true);
  setHidden(E.roomPanel, false);
  setHidden(E.roomHeaderTools, false);
  E.hero.classList.add("in-room");
  E.roomCodeDisplay.textContent = room.snapshot().roomCode;
}

const roomEntry=createRoomEntryController({room,spectatorUi,elements:{root:E.setupPanel,hostModeButton:E.hostModeButton,guestModeButton:E.guestModeButton,hostSetup:E.hostSetup,guestSetup:E.guestSetup,hostTools:E.hostTools,hostNameInput:E.hostNameInput,guestNameInput:E.guestNameInput,roomCodeInput:E.roomCodeInput,createRoomButton:E.createRoomButton,joinRoomButton:E.joinRoomButton,connectionStatus:E.connectionStatus},buildCreatePayload:()=>({capacity:Number(E.playerCountSelect.value)}),formatError:(kind,error)=>kind==="create"?`创建失败：${error.message}\n请确认已通过 node game15/signal-server.js 启动服务。`:`加入失败：${error.message}`});

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
  try {
    const result = await room.joinRoom({
      code: E.roomCodeInput.value,
      name: cleanPlayerName(E.guestNameInput.value, "玩家"),
      intent: spectatorUi.getJoinIntent()
    });
    E.connectionStatus.textContent = spectatorUi.handleJoinResult(result).statusText;
  }
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
  turnSubmitPending = false;
  restoredDraft = false;
  if (!view || view.phase !== "playing" || !view.permissions.canAct) {
    draft = null;
    selectedTileId = null;
    draftStore.clear();
    return;
  }
  const table = serverTableLayout();
  draft = {
    context: draftContext(view, room.snapshot().roomCode),
    turnId: view.turnId,
    base: JSON.stringify(table),
    table,
    handIds: view.hand.map((tile) => tile.id),
    originalHandIds: new Set(view.hand.map((tile) => tile.id)),
    undo: []
  };
  const saved = draftStore.load(draftContext(view, room.snapshot().roomCode));
  const restored = restoreDraft(saved, draft);
  if (restored) { draft = restored; restoredDraft = draftChanged(); }
  selectedTileId = restored && [...draft.handIds, ...draft.table.flatMap(meld => meld.tileIds)].includes(saved.selectedTileId) ? saved.selectedTileId : null;
  if (restored && ["color", "number"].includes(saved.handSort)) handSort = saved.handSort;
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
  editSync.sync({ retry: true });
}

function mutateDraft(callback) {
  if (!draft || !view.permissions.canAct || turnSubmitPending) return;
  restoredDraft = false;
  draft.undo.push(snapshotDraft());
  draft.undo = draft.undo.slice(-60);
  callback();
  draft.table = draft.table.filter((meld) => meld.tileIds.length);
  selectedTileId = null;
  requestEditMark();
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
  if (turnSubmitPending) return;
  const previous = draft?.undo.pop();
  if (!previous) return;
  draft.table = previous.table;
  draft.handIds = previous.handIds;
  selectedTileId = null;
  requestEditMark();
  render();
}

function resetDraft() {
  if (!draft || turnSubmitPending) return;
  draft.table = JSON.parse(draft.base);
  draft.handIds = view.hand.map((tile) => tile.id);
  draft.undo = [];
  selectedTileId = null;
  requestEditMark();
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
  return `<button type="button" aria-pressed="${selectedTileId === tile.id}" aria-label="${tile.joker ? "百搭牌" : `${COLOR_LABELS[tile.color]}${tile.number}`}" class="tile tile-${color} ${selectedTileId === tile.id ? "selected" : ""} ${changed ? "recently-changed" : ""} ${locked ? "locked" : ""}" draggable="${!locked}" data-tile-id="${escapeHtml(tile.id)}" data-source="${source}">
    <span>${label}</span>${assignmentText ? `<small>${escapeHtml(assignmentText)}</small>` : ""}
  </button>`;
}

function sortedHandIds() {
  const map = tileMap();
  const colorRank = new Map(COLORS.map((color, index) => [color, index]));
  const handIds = draft?.handIds || view.hand.map((tile) => tile.id);
  return [...handIds].sort((leftId, rightId) => {
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
  const ids = sortedHandIds();
  const existing = new Map([...E.hand.querySelectorAll(":scope > [data-tile-id]")].map((node) => [node.dataset.tileId, node]));
  E.hand.querySelector(":scope > .waiting")?.remove();
  ids.forEach((id) => {
    const tile = map.get(id);
    const renderKey = JSON.stringify([tile, selectedTileId === id]);
    let node = existing.get(id);
    if (!node || node.dataset.renderKey !== renderKey) {
      const template = document.createElement("template");
      template.innerHTML = tileHtml(tile, { source: "hand" }).trim();
      const replacement = template.content.firstElementChild;
      replacement.dataset.renderKey = renderKey;
      if (node) node.replaceWith(replacement);
      node = replacement;
    }
    E.hand.append(node);
    existing.delete(id);
  });
  existing.forEach((node) => node.remove());
  if (!ids.length) E.hand.innerHTML = '<p class="waiting">牌架已经清空。</p>';
  E.handHint.textContent = view.phase === "playing"
    ? `${ids.length}张 · ${view.players.find((player) => player.id === view.selfId)?.opened ? "已完成开牌" : "尚未完成30分开牌"}`
    : "开局获得14张牌";
}

function renderTable() {
  const map = tileMap();
  const layout = activeLayout();
  const changedIds = new Set(view.lastChange?.until > serverNow() ? view.lastChange.tileIds : []);
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
  button.disabled = disabled || turnSubmitPending;
  button.addEventListener("click", handler);
  E.actionButtons.append(button);
}

function renderActions(memberRole) {
  E.actionButtons.innerHTML = "";
  E.actionHint.textContent = "";
  const current = view.players.find((player) => player.id === view.currentPlayerId);
  if (memberRole === "spectator") {
    E.actionTitle.textContent = view.phase === "lobby" ? "旁观准备阶段" : "正在旁观牌局";
    E.actionHint.textContent = view.phase === "playing"
      ? `${current?.name || "当前玩家"}${view.turnEdited ? "正在整理私密草稿" : "正在考虑行动"}；确认后公共牌桌才会更新。`
      : "旁观者不计入比赛人数，可在准备阶段有空位时进入玩家席。";
    E.actionButtons.innerHTML = '<p class="spectator-action-note">旁观模式不会显示牌架、摸牌结果或草稿操作。</p>';
    return;
  }
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
  if (selectedTileId) {
    const tile = tileMap().get(selectedTileId);
    E.actionHint.textContent = `已选${tile.joker ? "百搭牌" : `${COLOR_LABELS[tile.color]}${tile.number}`}：点桌面牌可插入其前方，或点“放到末尾”及新建牌组。`;
    addAction("取消选牌", () => { selectedTileId = null; render(); });
    if (draft.originalHandIds.has(selectedTileId) && locateDraftTile(selectedTileId)?.place === "table") {
      addAction("放回牌架", () => moveTileToHand(selectedTileId));
    }
  }
  addAction("撤销一步", undoDraft, "", !draft.undo.length);
  addAction("重置本回合", resetDraft, "", !status.changed);
  addAction(handSort === "color" ? "手牌改按数字整理" : "手牌改按颜色整理", () => { handSort = handSort === "color" ? "number" : "color"; render(); });
  const sync = editSync.status();
  if (restoredDraft) E.actionHint.textContent += " · 已恢复本回合草稿";
  if (sync.error) {
    E.actionHint.textContent += " · 编辑状态同步失败，草稿已保留，请重试。";
    addAction("重试同步", requestEditMark);
  } else if (sync.pending) E.actionHint.textContent += " · 正在同步编辑状态…";
  const ready = status.changed && status.valid && status.used > 0 && (self.opened || status.score >= 30) && view.turnEdited && !sync.pending && !sync.error;
  addAction("确认并公布牌桌", () => submitTurn({ type: "commitLayout", layout: draft.table }), "primary", !ready);
  if (view.permissions.canDraw) addAction("摸1张并结束回合", () => {
    if (!status.changed || confirm("当前草稿会被撤销，然后摸1张并结束回合。确定吗？")) submitTurn({ type: "draw" });
  }, "draw-action");
  if (view.permissions.canPassEmpty) addAction("牌池已空：声明无法出牌", () => {
    if (!status.changed || confirm("当前草稿会被撤销，并声明无法出牌。确定吗？")) submitTurn({ type: "passEmpty" });
  }, "draw-action");
}

function renderScoreboard() {
  const existing = new Map([...E.scoreboard.querySelectorAll(":scope > [data-player-id]")].map((node) => [node.dataset.playerId, node]));
  view.players.forEach((player) => {
    const className = `score-row ${player.id === view.currentPlayerId && view.phase === "playing" ? "current" : ""}`;
    const renderKey = JSON.stringify([player, className, view.permissions.canKick]);
    let node = existing.get(player.id);
    if (!node) { node = document.createElement("div"); node.dataset.playerId = player.id; }
    if (node.dataset.renderKey !== renderKey) {
      node.dataset.renderKey = renderKey;
      node.className = className;
      node.innerHTML = `<span><b>${escapeHtml(player.name)}</b><small>${player.connected ? "在线" : "离线"}${player.opened ? " · 已开牌" : ""}</small></span>
        <span><b>${player.score}</b><small>${player.wins}胜 · 手牌${player.handCount}</small></span>
        ${view.permissions.canKick && !player.isHost ? `<button type="button" data-kick="${escapeHtml(player.id)}">移出</button>` : ""}`;
      node.querySelector("[data-kick]")?.addEventListener("click", () => kickPlayer(player.id));
    }
    E.scoreboard.append(node);
    existing.delete(player.id);
  });
  existing.forEach((node) => node.remove());
}

function renderChangeNotice() {
  if (changeTimer) clearTimeout(changeTimer);
  const change = view.lastChange;
  const active = change && change.until > serverNow();
  setHidden(E.changeNotice, !active);
  if (!active) return;
  const actor = view.players.find((player) => player.id === change.actorId);
  E.changeNotice.textContent = `${actor?.name || "一名玩家"}刚刚更新了牌桌，高亮牌块为本次发生变化的位置。`;
  changeTimer = setTimeout(() => {
    setHidden(E.changeNotice, true);
    E.table.querySelectorAll(".recently-changed").forEach((node) => node.classList.remove("recently-changed"));
  }, Math.max(0, change.until - serverNow()));
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

function renderRoom(model) {
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
  E.roomCodeDisplay.textContent = model.roomCode;
}

function renderStatus(model) {
  const current = model.current;
  E.gameNumber.textContent = String(view.gameNumber);
  E.totalGames.textContent = String(view.totalGames);
  E.poolCount.textContent = String(view.poolCount);
  E.notice.textContent = model.memberRole === "spectator" && view.phase === "lobby"
    ? "你正在旁观准备阶段，可在有空位时主动进入玩家席"
    : view.phase === "lobby" ? `等待玩家加入：${view.players.length}/${view.capacity}`
    : view.phase === "playing" ? `当前行动：${current?.name || "玩家"}${view.turnEdited ? " · 正在整理草稿" : ""}`
      : view.phase === "gameEnd" ? `第${view.gameNumber}局结束，等待下一局` : "固定局数比赛已经结束";
  E.controlDock.dataset.expanded = String(Boolean(view.permissions.canAct));
  E.controlDock.dataset.role = model.memberRole;
  setHidden(E.handZone, model.memberRole === "spectator");
}

function renderCountdownPartition() {
  if (view.deadline) countdown.start(view.deadline, ACTION_SECONDS * 1000);
  else { countdown.stop(); E.timerText.textContent = "--"; E.timerBar.style.width = "0"; }
}

const partitionRenderer = createGame15PartitionRenderer({
  room: renderRoom,
  status: renderStatus,
  scoreboard: renderScoreboard,
  hand: renderHand,
  table: renderTable,
  decision: (model) => renderActions(model.memberRole),
  changeNotice: renderChangeNotice,
  result: renderResult,
  log: renderLog,
  countdown: renderCountdownPartition
});

function render() {
  if (!view) return;
  if (draft) draftStore.save(draftContext(view, room.snapshot().roomCode), {
    ...snapshotDraft(), base: draft.base, originalHandIds: [...draft.originalHandIds], undo: draft.undo, selectedTileId, handSort
  });
  const spectatorModel = spectatorUi.render(view);
  const draftModel = draft ? {
    turnId: draft.turnId,
    base: draft.base,
    table: draft.table,
    handIds: draft.handIds,
    undoLength: draft.undo.length
  } : null;
  partitionRenderer.render(createGame15RenderModel(view, {
    memberRole: spectatorModel.memberRole,
    roomCode: room.snapshot().roomCode,
    draft: draftModel,
    selectedTileId,
    handSort,
    editStatus: { ...editSync.status(), turnSubmitPending, restoredDraft }
  }));
}

function handleTileClick(id) {
  if (!view.permissions.canAct || turnSubmitPending || tileLocked(id)) return;
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
    if (event.target.closest("[data-drop-hand]") && selectedTileId) return moveTileToHand(selectedTileId);
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

async function init() {
  roomEntry.bind();
  bindBoardEvents();
  spectatorUi.bind();
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
  try { spectatorUi.applyConfig(await room.checkServer()); } catch { /* join/create shows details */ }
}

init();
