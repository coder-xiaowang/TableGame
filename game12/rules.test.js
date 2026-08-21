import test from "node:test";
import assert from "node:assert/strict";
import { classicResult, duplicateGroups, normalizeText, requiredClueSlots, scoreLabel, strictMajority, validateClue } from "./rules.js";
import { WORDS } from "./words.js";

test("clues are normalized and constrained to one word and eight characters", () => {
  assert.equal(normalizeText(" ＡBC "), "abc");
  assert.equal(validateClue("海洋"), "");
  assert.match(validateClue("蓝色 海洋"), /一个词/);
  assert.match(validateClue("一二三四五六七八九"), /8/);
  assert.match(validateClue("月亮", "月亮"), /秘密词/);
});

test("exact normalized duplicates cancel as a complete group", () => {
  assert.deepEqual(duplicateGroups([{id:"a",text:"Moon"},{id:"b",text:"ＭＯＯＮ"},{id:"c",text:"night"}]), [["a","b"]]);
});

test("three players receive two clue slots", () => {
  assert.equal(requiredClueSlots(3), 2);
  assert.equal(requiredClueSlots(4), 1);
});

test("vote requires a strict majority of all eligible voters", () => {
  assert.equal(strictMajority({a:true,b:true}, ["a","b","c"]).passed, true);
  assert.equal(strictMajority({a:true,b:false}, ["a","b"]).passed, false);
  assert.equal(strictMajority({a:true}, ["a","b","c"]).passed, false);
});

test("classic wrong answers consume an extra card or a prior success", () => {
  assert.deepEqual(classicResult({remainingCards:13,correctCards:0,outcome:"correct"}), {remainingCards:12,correctCards:1});
  assert.deepEqual(classicResult({remainingCards:2,correctCards:4,outcome:"wrong"}), {remainingCards:0,correctCards:4});
  assert.deepEqual(classicResult({remainingCards:1,correctCards:4,outcome:"wrong"}), {remainingCards:0,correctCards:3});
});

test("word deck is unique and suitable for five choices", () => {
  assert.ok(WORDS.length >= 100);
  assert.equal(new Set(WORDS).size, WORDS.length);
  assert.ok(WORDS.every((word) => [...word].length <= 8 && !/\s/.test(word)));
  assert.match(scoreLabel(13), /完美/);
});
