"use strict";

export function createHostTimer({ now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let timer = null;
  let deadline = 0;

  function clear() {
    if (timer != null) clearTimer(timer);
    timer = null;
    deadline = 0;
  }

  function schedule(seconds, callback, graceMs = 50) {
    clear();
    deadline = now() + Math.max(0, Number(seconds) || 0) * 1000;
    timer = setTimer(() => {
      timer = null;
      deadline = 0;
      callback();
    }, Math.max(0, deadline - now()) + graceMs);
    return deadline;
  }

  function scheduleAt(targetDeadline, callback, graceMs = 50) {
    clear();
    deadline = Math.max(0, Number(targetDeadline) || 0);
    if (!deadline) return 0;
    timer = setTimer(() => {
      timer = null;
      deadline = 0;
      callback();
    }, Math.max(0, deadline - now()) + graceMs);
    return deadline;
  }

  return Object.freeze({ clear, schedule, scheduleAt, get deadline() { return deadline; } });
}

export function createCountdown({
  onTick,
  intervalMs = 200,
  now = Date.now,
  setTicker = setInterval,
  clearTicker = clearInterval
} = {}) {
  let ticker = null;

  function stop() {
    if (ticker != null) clearTicker(ticker);
    ticker = null;
  }

  function start(deadline, totalMs) {
    stop();
    const tick = () => {
      const remainingMs = Math.max(0, Number(deadline) - now());
      const progress = totalMs > 0 ? Math.min(1, remainingMs / totalMs) : 0;
      onTick?.({ remainingMs, seconds: Math.ceil(remainingMs / 1000), progress });
      if (!remainingMs) stop();
    };
    tick();
    if (Number(deadline) > now()) ticker = setTicker(tick, intervalMs);
  }

  return Object.freeze({ start, stop });
}
