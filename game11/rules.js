"use strict";

export const TEAMS = Object.freeze(["white", "black"]);
export const CODE_DIGITS = Object.freeze([1, 2, 3, 4]);

export function otherTeam(team) {
  return team === "white" ? "black" : "white";
}

export function createCodeDeck() {
  const result = [];
  for (const a of CODE_DIGITS) for (const b of CODE_DIGITS) for (const c of CODE_DIGITS) {
    if (a !== b && a !== c && b !== c) result.push([a, b, c]);
  }
  return result;
}

export function isValidCode(code) {
  return Array.isArray(code) && code.length === 3
    && code.every((digit) => CODE_DIGITS.includes(Number(digit)))
    && new Set(code.map(Number)).size === 3;
}

export function lockGuessDrafts(guesses = {}, drafts = {}) {
  return Object.fromEntries(["decode", "intercept"].map((role) => {
    const locked = isValidCode(guesses[role]) ? guesses[role] : drafts[role];
    return [role, isValidCode(locked) ? locked.map(Number) : null];
  }));
}

export function normalizeClue(value) {
  return String(value ?? "").trim().toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function validateClues(clues, keywords, usedClues = []) {
  if (!Array.isArray(clues) || clues.length !== 3) return "必须填写三条提示。";
  const clean = clues.map((clue) => String(clue ?? "").trim());
  if (clean.some((clue) => !clue)) return "三条提示都不能为空。";
  if (clean.some((clue) => clue.length > 60)) return "每条提示不能超过 60 个字符。";
  const normalized = clean.map(normalizeClue);
  if (new Set(normalized).size !== 3) return "本轮三条提示不能相同。";
  const old = new Set(usedClues.map(normalizeClue));
  if (normalized.some((clue) => old.has(clue))) return "你不能重复使用自己曾经给过的提示。";
  const secretWords = keywords.map(normalizeClue).filter(Boolean);
  if (normalized.some((clue) => secretWords.some((word) => clue.includes(word)))) {
    return "提示不能直接包含本队的任何关键词。";
  }
  return "";
}

export function scoreTransmission({ code, interceptGuess, decodeGuess, allowIntercept = true }) {
  const equals = (guess) => isValidCode(guess) && guess.map(Number).every((digit, index) => digit === code[index]);
  return {
    intercepted: allowIntercept && equals(interceptGuess),
    miscommunicated: !equals(decodeGuess)
  };
}

export function outcomeForTeams(teams, round) {
  const winners = TEAMS.filter((team) => teams[team].interceptions >= 2);
  const losers = TEAMS.filter((team) => teams[team].miscommunications >= 2);
  if (!winners.length && !losers.length && round < 8) return null;
  const candidates = TEAMS.map((team) => ({
    team,
    score: teams[team].interceptions - teams[team].miscommunications
  }));
  const best = Math.max(...candidates.map((item) => item.score));
  const leaders = candidates.filter((item) => item.score === best).map((item) => item.team);
  if (leaders.length === 1) return { type: "winner", winners: leaders, needsKeywordGuess: false };
  return { type: "tiebreak", winners: [], needsKeywordGuess: true };
}

export function lastEligiblePlayer(players, team, excludedId = "") {
  return [...players].reverse().find((player) => player.team === team && player.id !== excludedId) || null;
}
