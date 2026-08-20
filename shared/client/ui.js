"use strict";

import { normalizeRoomCode } from "./utils.js";

export function setHidden(element, hidden) {
  element?.classList.toggle("hidden", Boolean(hidden));
}

export function setText(element, value) {
  if (element) element.textContent = String(value ?? "");
}

export function bindRoomCodeInput(input) {
  if (!input) return () => {};
  const normalize = () => { input.value = normalizeRoomCode(input.value); };
  input.addEventListener("input", normalize);
  return () => input.removeEventListener("input", normalize);
}

export function renderConnectionStatus(element, status, roomCode = "") {
  const labels = {
    idle: "尚未连接",
    checking: "正在检查联机服务",
    connecting: "正在连接联机服务",
    open: roomCode ? `已连接房间 ${roomCode}` : "联机服务已连接",
    reconnecting: "联机服务正在重连",
    closed: "连接已关闭",
    error: "联机服务不可用"
  };
  setText(element, labels[status] ?? status);
  if (element) element.dataset.status = status;
}

export function renderCountdown({ textElement, barElement }, { seconds, progress }) {
  setText(textElement, `${seconds}s`);
  if (barElement) barElement.style.width = `${Math.round(progress * 100)}%`;
}

export function setModeVisibility(mode, { hostSetup, guestSetup, hostTools, hostButton, guestButton }) {
  const isHost = mode === "host";
  setHidden(hostSetup, !isHost);
  setHidden(guestSetup, isHost);
  setHidden(hostTools, !isHost);
  hostButton?.classList.toggle("active", isHost);
  guestButton?.classList.toggle("active", !isHost);
}
