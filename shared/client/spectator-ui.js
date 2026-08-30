"use strict";

import { setHidden } from "./ui.js";

export const SPECTATOR_ERROR_MESSAGES = Object.freeze({
  spectators_unavailable: "当前游戏尚未开放旁观功能。",
  spectators_disabled: "房主已关闭旁观者加入。",
  spectator_limit_reached: "旁观席人数已满。",
  spectator_cannot_act: "旁观者不能提交游戏操作。",
  seat_change_unavailable: "当前阶段不能切换玩家席和旁观席。",
  host_must_remain_player: "房主必须留在玩家席。",
  room_full: "玩家席已满。",
  room_expired: "房间长时间没有正式玩家在线，已经自动关闭。",
  kicked: "你已被房主移出房间。"
});

export function spectatorErrorMessage(error, fallback = "操作失败，请稍后重试。") {
  const code = error?.payload?.code || error?.code;
  return SPECTATOR_ERROR_MESSAGES[code] || error?.message || fallback;
}

export function describeSpectatorJoin(result = {}) {
  const spectator = result.memberRole === "spectator";
  let notice = "";
  if (result.autoSpectated) {
    const reason = result.assignmentReason === "game_in_progress" ? "游戏已经开始" : "玩家席已满";
    notice = `${reason}，你已进入旁观席。`;
  }
  const statusText = result.resumed
    ? `身份已恢复：${spectator ? "旁观者" : "玩家"}`
    : spectator ? "已进入旁观席" : "已加入玩家席";
  return { notice, statusText };
}

export function buildSpectatorUiModel({ view = {}, snapshot = {}, config = {} } = {}) {
  const memberRole = view.roomRole || snapshot.memberRole || "player";
  const spectators = Array.isArray(view.spectators) ? view.spectators : [];
  const spectatorCount = Number.isInteger(view.spectatorCount) ? view.spectatorCount : spectators.length;
  const spectatorLimit = Number(view.spectatorLimit || config.spectatorLimit) || 10;
  const playerCount = Array.isArray(view.players) ? view.players.length : 0;
  const capacity = Number(view.capacity) || 0;
  const isHost = snapshot.role === "host";
  const canChangeSeats = view.canChangeSeats === true;
  const playerSeatFull = capacity > 0 && playerCount >= capacity;
  const spectatorSeatFull = spectatorCount >= spectatorLimit;
  const showSeatAction = canChangeSeats && (memberRole === "spectator" || !isHost);
  const seatIntent = memberRole === "spectator" ? "play" : "spectate";
  const seatDisabled = memberRole === "spectator"
    ? playerSeatFull
    : view.allowSpectators !== true || spectatorSeatFull;
  const spectatorsEnabled = config.spectatorsEnabled === true;
  return Object.freeze({
    memberRole,
    spectators,
    spectatorCount,
    spectatorLimit,
    isHost,
    seatIntent,
    showSeatAction,
    seatDisabled,
    seatLabel: memberRole === "spectator" ? "进入玩家席" : "转入旁观席",
    seatTitle: seatDisabled
      ? memberRole === "spectator" ? "玩家席已满" : "旁观席未开放或人数已满"
      : "",
    roleTitle: memberRole === "spectator" ? "你正在旁观" : "你在玩家席",
    roleHint: memberRole === "spectator"
      ? "你只能看到公开信息，不参与行动、计分和胜负"
      : "你是本局正式玩家，会计入开局人数",
    showSetting: spectatorsEnabled && Boolean(view.permissions?.canManage),
    settingLabel: view.allowSpectators ? "旁观：开放" : "旁观：关闭",
    showSpectatorPanel: spectatorsEnabled || spectatorCount > 0
  });
}

export function createSpectatorUi({
  room,
  elements = {},
  getView = () => null,
  notify = (message) => globalThis.alert?.(message),
  confirmAction = (message) => globalThis.confirm?.(message) ?? true,
  onSessionEnded = () => {}
} = {}) {
  if (!room?.snapshot || !room?.changeSeat || !room?.setRoomSettings || !room?.kick) {
    throw new TypeError("spectator UI requires an authoritative room client");
  }
  let config = { spectatorsEnabled: false, spectatorLimit: 10 };
  let lastModel = null;

  function applyConfig(nextConfig = {}) {
    config = { ...config, ...nextConfig };
    setHidden(elements.joinIntentField, !config.spectatorsEnabled);
    if (!config.spectatorsEnabled) {
      const play = elements.joinIntentField?.querySelector?.('input[value="play"]');
      if (play) play.checked = true;
    }
    if (getView()) render(getView());
    return config;
  }

  function getJoinIntent() {
    if (!config.spectatorsEnabled) return "play";
    return elements.joinIntentField
      ?.querySelector?.('input[name="joinIntent"]:checked')?.value === "spectate"
      ? "spectate"
      : "play";
  }

  function handleJoinResult(result) {
    const description = describeSpectatorJoin(result);
    if (description.notice) notify(description.notice);
    return description;
  }

  async function changeSeat() {
    const model = lastModel || render(getView());
    if (!model?.showSeatAction || model.seatDisabled) return;
    if (model.seatIntent === "spectate"
      && !confirmAction("转入旁观席后将不计入开局人数，确定继续吗？")) return;
    if (elements.seatActionButton) elements.seatActionButton.disabled = true;
    try {
      await room.changeSeat(model.seatIntent);
    } catch (error) {
      notify(`切换座位失败：${spectatorErrorMessage(error)}`);
    } finally {
      if (elements.seatActionButton) elements.seatActionButton.disabled = false;
    }
  }

  async function toggleSetting() {
    const view = getView();
    if (!view?.permissions?.canManage) return;
    if (elements.spectatorSettingButton) elements.spectatorSettingButton.disabled = true;
    try {
      await room.setRoomSettings({ allowSpectators: !view.allowSpectators });
    } catch (error) {
      notify(`修改旁观设置失败：${spectatorErrorMessage(error)}`);
    } finally {
      if (elements.spectatorSettingButton) elements.spectatorSettingButton.disabled = false;
    }
  }

  async function kickSpectator(spectator) {
    if (!spectator || !confirmAction(`确定将 ${spectator.name} 移出房间吗？`)) return;
    try {
      await room.kick(spectator.id);
    } catch (error) {
      notify(`移出失败：${spectatorErrorMessage(error)}`);
    }
  }

  function renderSpectatorList(model, canManage) {
    const container = elements.spectatorList;
    const documentRef = container?.ownerDocument;
    if (!container?.replaceChildren || !documentRef) return;
    const nodes = model.spectators.map((spectator) => {
      const item = documentRef.createElement("article");
      item.className = `spectator-item${spectator.connected ? "" : " spectator-offline"}`;
      const identity = documentRef.createElement("div");
      const dot = documentRef.createElement("span");
      dot.className = "spectator-status-dot";
      const name = documentRef.createElement("b");
      name.textContent = spectator.name;
      identity.append(dot, name);
      item.append(identity);
      if (canManage) {
        const button = documentRef.createElement("button");
        button.type = "button";
        button.textContent = "移出";
        button.onclick = () => kickSpectator(spectator);
        item.append(button);
      }
      return item;
    });
    if (!nodes.length) {
      const empty = documentRef.createElement("p");
      empty.className = "muted";
      empty.textContent = "暂无旁观者";
      nodes.push(empty);
    }
    container.replaceChildren(...nodes);
  }

  function render(view = getView()) {
    if (!view) return null;
    const model = buildSpectatorUiModel({ view, snapshot: room.snapshot(), config });
    lastModel = model;
    if (elements.roomRoleBanner) elements.roomRoleBanner.dataset.role = model.memberRole;
    if (elements.roomRoleTitle) elements.roomRoleTitle.textContent = model.roleTitle;
    if (elements.roomRoleHint) elements.roomRoleHint.textContent = model.roleHint;
    setHidden(elements.seatActionButton, !model.showSeatAction);
    if (elements.seatActionButton) {
      elements.seatActionButton.textContent = model.seatLabel;
      elements.seatActionButton.disabled = model.seatDisabled;
      elements.seatActionButton.title = model.seatTitle;
    }
    setHidden(elements.spectatorSettingButton, !model.showSetting);
    if (elements.spectatorSettingButton) {
      elements.spectatorSettingButton.textContent = model.settingLabel;
      elements.spectatorSettingButton.setAttribute("aria-pressed", String(Boolean(view.allowSpectators)));
    }
    setHidden(elements.spectatorPanel, !model.showSpectatorPanel);
    if (elements.spectatorCountBadge) {
      elements.spectatorCountBadge.textContent = `${model.spectatorCount} / ${model.spectatorLimit}`;
    }
    renderSpectatorList(model, Boolean(view.permissions?.canManage));
    return model;
  }

  function handleSessionEnded(kind) {
    const message = kind === "room_expired"
      ? SPECTATOR_ERROR_MESSAGES.room_expired
      : SPECTATOR_ERROR_MESSAGES.kicked;
    notify(message);
    onSessionEnded(kind);
  }

  function bind({ matchMediaImpl = globalThis.matchMedia } = {}) {
    if (elements.seatActionButton) elements.seatActionButton.onclick = changeSeat;
    if (elements.spectatorSettingButton) elements.spectatorSettingButton.onclick = toggleSetting;
    if (matchMediaImpl?.("(max-width: 720px)")?.matches) {
      elements.spectatorPanel?.removeAttribute?.("open");
    }
  }

  return Object.freeze({
    applyConfig,
    getJoinIntent,
    handleJoinResult,
    handleSessionEnded,
    render,
    bind,
    changeSeat,
    toggleSetting,
    snapshot: () => lastModel
  });
}
