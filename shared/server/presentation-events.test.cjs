"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

test("服务端演出事件统一分配递增序号、限制历史长度并保护系统字段", async () => {
  const { appendPresentationEvent, validatePresentationState } = await import("./presentation-events.mjs");
  const state = { presentationEvents: [], presentationSequence: 0 };
  appendPresentationEvent(state, { id: "forged", sequence: 99, at: 0, kind: "claim", actorId: "p1", text: "声明" }, { now: 100, limit: 2 });
  appendPresentationEvent(state, { kind: "attack", actorId: "p1", targetId: "p2", text: "攻击" }, { now: 200, limit: 2 });
  appendPresentationEvent(state, { kind: "resolve", actorId: "p2", text: "响应" }, { now: 300, limit: 2 });
  assert.equal(state.presentationSequence, 3);
  assert.deepEqual(state.presentationEvents.map((event) => event.sequence), [2, 3]);
  assert.deepEqual(state.presentationEvents.map((event) => event.id), ["presentation_2", "presentation_3"]);
  assert.equal(state.presentationEvents[1].at, 300);
  assert.equal(validatePresentationState(state), true);
});

test("旧快照可从现有事件恢复演出序号", async () => {
  const { normalizePresentationState, validatePresentationState } = await import("./presentation-events.mjs");
  const state = { moments: [{ id: "moment_4", sequence: 4, kind: "action", at: 10 }] };
  normalizePresentationState(state, { eventsKey: "moments", sequenceKey: "momentSequence" });
  assert.equal(state.momentSequence, 4);
  assert.equal(validatePresentationState(state, { eventsKey: "moments", sequenceKey: "momentSequence" }), true);
});
