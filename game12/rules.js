export const PHASES = Object.freeze(["lobby", "choose", "clue", "review", "guess", "vote", "reveal", "ended"]);

export function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
}

export function validateClue(value, secretWord = "") {
  const clue = normalizeText(value);
  if (!clue) return "提示不能为空。";
  if ([...clue].length > 8) return "提示最多为 8 个字符。";
  if (/\s/u.test(clue)) return "提示必须是一个词，不能包含空格。";
  if (/[，。！？、；：,.!?;:]/u.test(clue)) return "提示不能包含句子标点。";
  if (secretWord && clue === normalizeText(secretWord)) return "提示不能直接写出秘密词。";
  return "";
}

export function duplicateGroups(clues) {
  const groups = new Map();
  for (const clue of clues) {
    const normalized = normalizeText(clue.text);
    if (!normalized) continue;
    const list = groups.get(normalized) || [];
    list.push(clue.id);
    groups.set(normalized, list);
  }
  return [...groups.values()].filter((ids) => ids.length > 1);
}

export function requiredClueSlots(playerCount) {
  return playerCount === 3 ? 2 : 1;
}

export function strictMajority(votes, eligibleVoterIds) {
  const eligible = new Set(eligibleVoterIds);
  let yes = 0;
  let no = 0;
  for (const [playerId, vote] of Object.entries(votes || {})) {
    if (!eligible.has(playerId)) continue;
    if (vote === true) yes += 1;
    if (vote === false) no += 1;
  }
  return { yes, no, passed: yes > eligible.size / 2, complete: yes + no >= eligible.size };
}

export function classicResult({ remainingCards, correctCards, outcome }) {
  let remaining = Math.max(0, remainingCards - 1);
  let correct = correctCards;
  if (outcome === "correct") correct += 1;
  if (outcome === "wrong") {
    if (remaining > 0) remaining -= 1;
    else if (correct > 0) correct -= 1;
  }
  return { remainingCards: remaining, correctCards: correct };
}

export function scoreLabel(score) {
  if (score === 13) return "完美表现！还能再做到一次吗？";
  if (score === 12) return "不可思议！距离完美只差一个。";
  if (score === 11) return "太出色了！这是值得骄傲的成绩。";
  if (score >= 9) return "强力团队！配合非常默契。";
  if (score >= 7) return "表现不错，还能继续突破。";
  if (score >= 4) return "良好的开始，再来一局吧。";
  return "默契正在形成，继续练习。";
}
