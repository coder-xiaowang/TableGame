"use strict";

export function createId(prefix = "player") {
  const random = globalThis.crypto?.randomUUID?.()
    ?? Math.random().toString(36).slice(2, 10);
  return `${prefix}_${random}`;
}

export function normalizeRoomCode(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);
}

export function isValidRoomCode(value) {
  return /^[A-Z0-9]{4}$/.test(String(value ?? ""));
}

export function cleanPlayerName(value, fallback = "玩家", maxLength = 12) {
  return String(value ?? "").trim().slice(0, maxLength) || fallback;
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

export function shuffle(items, random = Math.random) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [items[index], items[target]] = [items[target], items[index]];
  }
  return items;
}

export function createLogEntry(text, extra = {}) {
  return { id: createId("log"), text: String(text), at: Date.now(), ...extra };
}

export function prependLimited(list, item, limit = 100) {
  list.unshift(item);
  if (list.length > limit) list.length = limit;
  return list;
}
