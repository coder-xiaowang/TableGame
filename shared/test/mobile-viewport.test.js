import test from 'node:test';
import assert from 'node:assert/strict';
import { keyboardViewport } from '../client/mobile-viewport.js';

test('keyboard-only resize reserves visible height and browser pan offset', () => {
  assert.deepEqual(keyboardViewport({ height: 430, layoutHeight: 844, offsetTop: 32, editing: true }), { active: true, height: 430, top: 32 });
});
test('pinch zoom, browser chrome and unfocused resize do not trigger keyboard layout', () => {
  for (const values of [
    { height: 430, layoutHeight: 844, editing: true, scale: 2 },
    { height: 780, layoutHeight: 844, editing: true },
    { height: 430, layoutHeight: 844, editing: false },
    { height: 430, layoutHeight: 430, editing: true }
  ]) assert.equal(keyboardViewport(values).active, false);
});
