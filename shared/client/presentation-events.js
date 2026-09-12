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
  sceneKey = null,
  priorityFor = (event) => Number(event?.priority) || 1,
  catchUpThreshold = Number.POSITIVE_INFINITY,
  severeBacklogThreshold = Number.POSITIVE_INFINITY,
  catchUpDurationMs = durationMs,
  severeDurationMs = catchUpDurationMs,
  urgentPriority = Number.POSITIVE_INFINITY,
  retainPriority = urgentPriority,
  prefersReducedMotion = () => Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches),
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
} = {}) {
  let cursor = null;
  let queue = [];
  let playing = false;
  let generation = 0;
  let destroyed = false;
  let playbackMode = "idle";
  let severePending = false;

  function eventPriority(event) {
    const value = Number(priorityFor?.(event));
    return Number.isFinite(value) ? value : 1;
  }

  function makeQueueItems(events) {
    if (typeof sceneKey !== "function") return events;
    const groups = [];
    for (const event of events) {
      const key = String(sceneKey(event) ?? event.id ?? event.sequence);
      const previous = groups.at(-1);
      if (previous?.key === key) previous.events.push(event);
      else groups.push({ key, events: [event] });
    }
    return groups.map((group) => {
      let focus = group.events[0];
      let priority = eventPriority(focus);
      for (const event of group.events.slice(1)) {
        const candidate = eventPriority(event);
        if (candidate > priority) { focus = event; priority = candidate; }
      }
      return {
        ...focus,
        sequence: group.events.at(-1).sequence,
        sceneKey: group.key,
        scenePriority: priority,
        sceneEvents: group.events.map((event) => ({ ...event }))
      };
    });
  }

  function itemPriority(item) {
    return Number.isFinite(Number(item?.scenePriority)) ? Number(item.scenePriority) : eventPriority(item);
  }

  function compactBacklog() {
    if (queue.length < severeBacklogThreshold) return;
    severePending = true;
    const keepLatest = Math.max(0, queue.length - 2);
    queue = queue.filter((item, index) => index >= keepLatest || itemPriority(item) >= retainPriority);
  }

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

  async function play(event, runGeneration, playbackDuration) {
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
    await wait(prefersReducedMotion() ? Math.min(reducedDurationMs, playbackDuration) : playbackDuration);
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
    while (queue.length && !destroyed && runGeneration === generation) {
      compactBacklog();
      const backlog = queue.length;
      const severe = severePending;
      severePending = false;
      playbackMode = severe || backlog >= severeBacklogThreshold ? "severe" : backlog >= catchUpThreshold ? "catch-up" : "normal";
      const playbackDuration = playbackMode === "severe" ? severeDurationMs : playbackMode === "catch-up" ? catchUpDurationMs : durationMs;
      await play(queue.shift(), runGeneration, playbackDuration);
    }
    if (runGeneration === generation) { playing = false; playbackMode = "idle"; }
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
    const incoming = makeQueueItems(fresh);
    if (incoming.some((item) => itemPriority(item) >= urgentPriority)) {
      queue = queue.filter((item) => itemPriority(item) >= retainPriority);
    }
    queue.push(...incoming);
    compactBacklog();
    if (queue.length > maxQueue) queue = queue.slice(-maxQueue);
    void drain();
    return fresh;
  }

  function reset({ nextCursor = null } = {}) {
    generation += 1;
    cursor = nextCursor;
    queue = [];
    playing = false;
    playbackMode = "idle";
    severePending = false;
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
    snapshot: () => ({ cursor, queued: queue.length, playing, destroyed, playbackMode })
  };
}
