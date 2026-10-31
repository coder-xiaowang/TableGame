"use strict";

import { compassSeatSlots } from "../shared/client/stable-seat-layout.js";

export function playerNameLabel(value, limit = 5) {
  const characters = [...String(value || "玩家")];
  return characters.length > limit ? `${characters.slice(0, limit).join("")}…` : characters.join("");
}

export function buildSalonSeatPlan(players = [], selfId = "") {
  const source = Array.isArray(players) ? players : [];
  const selfIndex = source.findIndex((item) => String(item?.id) === String(selfId) && selfId);
  const ordered = selfIndex < 0 ? [...source] : [...source.slice(selfIndex), ...source.slice(0, selfIndex)];
  const slots = compassSeatSlots(ordered.length, { hasSelf: selfIndex >= 0 });
  return Object.freeze(ordered.map((player, index) => Object.freeze({ player, slot: slots[index] })));
}
