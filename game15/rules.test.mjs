import assert from "node:assert/strict";
import test from "node:test";
import { createTileSet, rackScore, validateMeld } from "./rules.mjs";

const tile = (id, color, number) => ({ id, color, number, joker: false });
const joker = (id) => ({ id, color: null, number: null, joker: true });

test("classic set contains 104 numbered tiles and two jokers", () => {
  const tiles = createTileSet();
  assert.equal(tiles.length, 106);
  assert.equal(new Set(tiles.map((item) => item.id)).size, 106);
  assert.equal(tiles.filter((item) => item.joker).length, 2);
});

test("groups require one number and unique colors", () => {
  assert.equal(validateMeld({ kind: "group", tiles: [
    tile("r7", "red", 7), tile("b7", "blue", 7), tile("o7", "orange", 7)
  ] }).valid, true);
  assert.equal(validateMeld({ kind: "group", tiles: [
    tile("r7a", "red", 7), tile("r7b", "red", 7), tile("o7", "orange", 7)
  ] }).valid, false);
});

test("runs are ordered, same-color, consecutive and never wrap around", () => {
  assert.equal(validateMeld({ kind: "run", tiles: [
    tile("b11", "blue", 11), tile("b12", "blue", 12), tile("b13", "blue", 13)
  ] }).valid, true);
  assert.equal(validateMeld({ kind: "run", tiles: [
    tile("b12", "blue", 12), tile("b13", "blue", 13), tile("b1", "blue", 1)
  ] }).valid, false);
});

test("two jokers receive unique legal assignments in one meld", () => {
  const run = validateMeld({ kind: "run", tiles: [joker("j1"), tile("r6", "red", 6), joker("j2")] });
  assert.equal(run.valid, true);
  assert.deepEqual(run.assignments.map((item) => item.number), [5, 6, 7]);
  const group = validateMeld({ kind: "group", tiles: [tile("b9", "blue", 9), joker("j1"), joker("j2")] });
  assert.equal(group.valid, true);
  assert.equal(new Set(group.assignments.map((item) => item.color)).size, 3);
});

test("rack scoring values a joker at thirty", () => {
  assert.equal(rackScore([tile("r13", "red", 13), joker("j1")]), 43);
});

