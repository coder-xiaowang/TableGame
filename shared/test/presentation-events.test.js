"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { createPresentationTimeline } from "../client/presentation-events.js";

function fakeClassList() {
  const values = new Set();
  return { add: (value) => values.add(value), remove: (value) => values.delete(value), contains: (value) => values.has(value) };
}

function element(rect = { left: 0, top: 0, width: 100, height: 100 }) {
  return {
    classList: fakeClassList(), dataset: {}, textContent: "", clientWidth: rect.width, clientHeight: rect.height,
    attributes: {}, getBoundingClientRect: () => rect,
    setAttribute(name, value) { this.attributes[name] = value; }
  };
}

test("首次同步只建立游标，后续服务器事件按sequence播放且绘制方向", async () => {
  const stage = element({ left: 10, top: 20, width: 400, height: 300 });
  const source = element({ left: 30, top: 50, width: 40, height: 40 });
  const target = element({ left: 300, top: 180, width: 50, height: 50 });
  const trail = element();
  trail.ownerSVGElement = element();
  const announcement = element(), label = element(), text = element(), effects = element();
  const played = [], cleaned = [];
  const timeline = createPresentationTimeline({
    container: stage, trailPath: trail, announcement, labelElement: label, textElement: text, effectsElement: effects,
    resolveSource: () => source, resolveTarget: () => target,
    labelFor: (event) => `类型：${event.kind}`,
    beforePlay: (event) => { played.push(event.sequence); return () => cleaned.push(event.sequence); },
    wait: () => Promise.resolve()
  });

  assert.deepEqual(timeline.sync([{ sequence: 1, kind: "old", text: "历史" }]), []);
  timeline.sync([{ sequence: 1, kind: "old", text: "历史" }, { sequence: 3, kind: "attack", text: "第三" }, { sequence: 2, kind: "claim", text: "第二" }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(played, [2, 3]);
  assert.deepEqual(cleaned, [2, 3]);
  assert.equal(label.textContent, "类型：attack");
  assert.equal(text.textContent, "第三");
  assert.equal(effects.dataset.kind, "attack");
  assert.match(trail.attributes.d, /^M /);
  assert.match(trail.ownerSVGElement.attributes.viewBox, /^0 0 400 300$/);
  assert.equal(timeline.snapshot().cursor, 3);
  assert.equal(timeline.snapshot().queued, 0);
});

test("可选择播放初始事件并可重置游标", async () => {
  const played = [];
  const timeline = createPresentationTimeline({
    beforePlay: (event) => { played.push(event.sequence); },
    wait: () => Promise.resolve()
  });
  timeline.sync([{ sequence: 1 }, { sequence: 2 }], { replayInitial: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(played, [1, 2]);
  timeline.reset({ nextCursor: 5 });
  timeline.sync([{ sequence: 5 }, { sequence: 6 }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(played, [1, 2, 6]);
});

test("重置正在播放的旧队列不会覆盖新队列的播放状态", async () => {
  const releases = [];
  const timeline = createPresentationTimeline({
    wait: () => new Promise((resolve) => releases.push(resolve))
  });
  timeline.sync([]);
  timeline.sync([{ sequence: 1, kind: "old" }]);
  await new Promise((resolve) => setImmediate(resolve));
  timeline.reset({ nextCursor: 1 });
  timeline.sync([{ sequence: 2, kind: "new" }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(releases.length, 2);
  releases[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(timeline.snapshot().playing, true);
  releases[1]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(timeline.snapshot().playing, false);
});
