import test from "node:test";
import assert from "node:assert/strict";
import { createCodeDeck, isValidCode, lastEligiblePlayer, outcomeForTeams, scoreTransmission, validateClues } from "./rules.js";
import { CODENAMES_CANDIDATES } from "./codenames-review.js";
import { CODENAMES_REVIEW, EXPANSION_KEYWORDS, KEYWORDS, ORIGINAL_KEYWORDS } from "./words.js";

test("Codenames review covers exactly 400 unique English source words", () => {
  assert.equal(CODENAMES_CANDIDATES.length, 400);
  assert.equal(new Set(CODENAMES_CANDIDATES.map((item) => item.en)).size, 400);
  assert.equal(CODENAMES_REVIEW.length, 400);
  assert.ok(CODENAMES_REVIEW.every((item) => ["included", "merged", "excluded"].includes(item.status)));
});
test("expanded Chinese keyword deck is unique and traceable", () => {
  assert.equal(ORIGINAL_KEYWORDS.length, 440);
  assert.equal(KEYWORDS.length, ORIGINAL_KEYWORDS.length + EXPANSION_KEYWORDS.length);
  assert.equal(new Set(KEYWORDS).size, KEYWORDS.length);
  assert.ok(KEYWORDS.every((word) => /^[\u3400-\u9fff]+$/.test(word)));
});
test("code deck contains every non-repeating three digit code", () => {
  const deck = createCodeDeck();
  assert.equal(deck.length, 24);
  assert.ok(deck.every(isValidCode));
});
test("clues cannot repeat or contain a team keyword", () => {
  assert.match(validateClues(["moon light", "doctor", "rail"], ["MOON", "HOSPITAL", "TRAIN", "APPLE"]), /关键词/);
  assert.match(validateClues(["night", "doctor", "rail"], [], ["Night"]), /重复/);
  assert.equal(validateClues(["night", "doctor", "rail"], ["MOON", "HOSPITAL", "TRAIN", "APPLE"]), "");
});
test("a transmission can be intercepted and miscommunicated together", () => {
  assert.deepEqual(scoreTransmission({ code:[4,2,1], interceptGuess:[4,2,1], decodeGuess:[4,1,2] }), { intercepted:true, miscommunicated:true });
});
test("first round suppresses interception", () => {
  assert.equal(scoreTransmission({ code:[1,2,3], interceptGuess:[1,2,3], decodeGuess:[1,2,3], allowIntercept:false }).intercepted, false);
});
test("last eligible submitter skips encryptor", () => {
  const players = [{id:"a",team:"white"},{id:"b",team:"white"},{id:"c",team:"black"}];
  assert.equal(lastEligiblePlayer(players,"white","b").id,"a");
});
test("token score resolves ordinary ending and exposes tied tiebreak", () => {
  assert.deepEqual(outcomeForTeams({white:{interceptions:2,miscommunications:0},black:{interceptions:0,miscommunications:0}},2).winners,["white"]);
  assert.equal(outcomeForTeams({white:{interceptions:1,miscommunications:0},black:{interceptions:1,miscommunications:0}},8).needsKeywordGuess,true);
});
