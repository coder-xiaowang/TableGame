"use strict";

function asElement(value) {
  return typeof value === "function" ? value() : value;
}

function centerOf(element, container) {
  const rect = element.getBoundingClientRect();
  const base = container.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2 - base.left,
    y: rect.top + rect.height / 2 - base.top
  };
}

function sequenceOf(event) {
  const sequence = Number(event?.sequence);
  return Number.isFinite(sequence) ? sequence : null;
}

/**
 * Plays server-authored, public presentation events without making animation part
 * of the authoritative rules. The first snapshot is treated as history so joining
 * or reconnecting clients do not replay the room's old event backlog.
 */
export function createPresentationTimeline({
  container,
  trailPath,
  announcement,
  labelElement,
  textElement,
  effectsElement,
  resolveSource,
  resolveTarget,
  labelFor = (event) => event?.kind || "事件",
  textFor = (event) => event?.text || "",
  beforePlay = () => null,
  afterPlay = () => {},
  activeClass = "active",
  durationMs = 2200,
  reducedDurationMs = 900,
  maxQueue = 16,
  prefersReducedMotion = () => Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches),
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
} = {}) {
  let cursor = null;
  let queue = [];
  let playing = false;
  let generation = 0;
  let destroyed = false;

  function clearVisuals() {
    asElement(announcement)?.classList?.remove(activeClass);
    asElement(trailPath)?.classList?.remove(activeClass);
  }

  function drawTrail(event) {
    const stage = asElement(container);
    const path = asElement(trailPath);
    const source = resolveSource?.(event);
    const target = resolveTarget?.(event);
    if (!stage || !path || !source || !target) return false;
    const width = stage.clientWidth || stage.getBoundingClientRect().width;
    const height = stage.clientHeight || stage.getBoundingClientRect().height;
    const from = centerOf(source, stage);
    const to = centerOf(target, stage);
    const bend = Math.max(35, Math.min(120, Math.abs(to.x - from.x) * .22 + Math.abs(to.y - from.y) * .12));
    path.ownerSVGElement?.setAttribute?.("viewBox", `0 0 ${width} ${height}`);
    path.setAttribute("d", `M ${from.x} ${from.y} Q ${(from.x + to.x) / 2} ${(from.y + to.y) / 2 - bend} ${to.x} ${to.y}`);
    path.classList.remove(activeClass);
    path.getBoundingClientRect?.();
    path.classList.add(activeClass);
    return true;
  }

  async function play(event, runGeneration) {
    const banner = asElement(announcement);
    const label = asElement(labelElement);
    const text = asElement(textElement);
    const effects = asElement(effectsElement);
    if (effects?.dataset) effects.dataset.kind = String(event?.kind || "event");
    if (label) label.textContent = String(labelFor(event));
    if (text) text.textContent = String(textFor(event));
    banner?.classList?.remove(activeClass);
    banner?.getBoundingClientRect?.();
    banner?.classList?.add(activeClass);
    const hasTrail = drawTrail(event);
    const cleanup = await beforePlay(event);
    await wait(prefersReducedMotion() ? reducedDurationMs : durationMs);
    if (destroyed || runGeneration !== generation) {
      if (typeof cleanup === "function") cleanup();
      return;
    }
    banner?.classList?.remove(activeClass);
    if (hasTrail) asElement(trailPath)?.classList?.remove(activeClass);
    if (typeof cleanup === "function") cleanup();
    await afterPlay(event);
  }

  async function drain() {
    if (playing || destroyed) return;
    playing = true;
    const runGeneration = generation;
    while (queue.length && !destroyed && runGeneration === generation) await play(queue.shift(), runGeneration);
    if (runGeneration === generation) playing = false;
  }

  function sync(events, { replayInitial = false } = {}) {
    if (destroyed) return [];
    const ordered = (Array.isArray(events) ? events : [])
      .filter((event) => sequenceOf(event) !== null)
      .sort((left, right) => sequenceOf(left) - sequenceOf(right));
    const latest = ordered.reduce((maximum, event) => Math.max(maximum, sequenceOf(event)), 0);
    if (cursor === null) {
      cursor = replayInitial ? 0 : latest;
      if (!replayInitial) return [];
    }
    const fresh = ordered.filter((event) => sequenceOf(event) > cursor);
    cursor = Math.max(cursor, latest);
    if (!fresh.length) return [];
    queue.push(...fresh);
    if (queue.length > maxQueue) queue = queue.slice(-maxQueue);
    void drain();
    return fresh;
  }

  function reset({ nextCursor = null } = {}) {
    generation += 1;
    cursor = nextCursor;
    queue = [];
    playing = false;
    clearVisuals();
  }

  function destroy() {
    destroyed = true;
    reset();
  }

  return {
    sync,
    reset,
    destroy,
    snapshot: () => ({ cursor, queued: queue.length, playing, destroyed })
  };
}
