/**
 * Appends a presentation-only event to authoritative state. Callers must only
 * include fields that are safe for every viewer receiving the resulting list.
 */
export function appendPresentationEvent(state, event, {
  now = Date.now(),
  eventsKey = "presentationEvents",
  sequenceKey = "presentationSequence",
  idPrefix = "presentation",
  limit = 30
} = {}) {
  if (!state || typeof state !== "object") throw new TypeError("Presentation state is required.");
  if (!event || typeof event !== "object") throw new TypeError("Presentation event is required.");
  if (!String(event.kind || "").trim()) throw new TypeError("Presentation event kind is required.");
  if (!Array.isArray(state[eventsKey])) state[eventsKey] = [];
  const current = Number.isInteger(state[sequenceKey]) && state[sequenceKey] >= 0 ? state[sequenceKey] : 0;
  const sequence = current + 1;
  state[sequenceKey] = sequence;
  const stored = {
    ...structuredClone(event),
    id: `${idPrefix}_${sequence}`,
    sequence,
    at: Number(now)
  };
  state[eventsKey].push(stored);
  if (state[eventsKey].length > limit) state[eventsKey].splice(0, state[eventsKey].length - limit);
  return stored;
}

export function normalizePresentationState(state, {
  eventsKey = "presentationEvents",
  sequenceKey = "presentationSequence"
} = {}) {
  if (!state || typeof state !== "object") throw new TypeError("Presentation state is required.");
  state[eventsKey] = Array.isArray(state[eventsKey]) ? state[eventsKey] : [];
  const latest = state[eventsKey].reduce((maximum, event) => Math.max(maximum, Number(event?.sequence) || 0), 0);
  state[sequenceKey] = Number.isInteger(state[sequenceKey]) && state[sequenceKey] >= latest ? state[sequenceKey] : latest;
  return state;
}

export function validatePresentationState(state, {
  eventsKey = "presentationEvents",
  sequenceKey = "presentationSequence"
} = {}) {
  if (!state || !Array.isArray(state[eventsKey])) throw new Error("Invalid presentation event list.");
  if (!Number.isInteger(state[sequenceKey]) || state[sequenceKey] < 0) throw new Error("Invalid presentation sequence.");
  let previous = 0;
  for (const event of state[eventsKey]) {
    if (!event || !Number.isInteger(event.sequence) || event.sequence <= previous || event.sequence > state[sequenceKey]) {
      throw new Error("Presentation events must have increasing sequences.");
    }
    if (!event.id || !event.kind || !Number.isFinite(Number(event.at))) throw new Error("Invalid presentation event.");
    previous = event.sequence;
  }
  return true;
}
