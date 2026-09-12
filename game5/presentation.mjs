function comparisonKey(text) {
  return String(text || "")
    .replace(/\s+/g, "")
    .replace(/[，。；：、！？,.!?:;]/g, "")
    .toLocaleLowerCase("zh-CN");
}

export function composePresentationText(event) {
  const events = Array.isArray(event?.sceneEvents) ? event.sceneEvents : [event];
  const played = events.find((item) => item?.kind === "card-play");
  const candidates = [played?.text, event?.text].filter((text) => String(text || "").trim());
  const seen = new Set();
  const unique = [];
  for (const text of candidates) {
    const value = String(text).trim();
    const key = comparisonKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  return unique.join("；") || "牌桌状态已经更新";
}
