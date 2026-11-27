"use strict";

document.querySelector("#footerYear").textContent = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", year: "numeric"
}).formatToParts(new Date()).find(part => part.type === "year").value;

async function renderDailyPoem() {
  try {
    const response = await fetch("/daily-poem.json", { cache: "no-cache", redirect: "error" });
    if (!response.ok) return;
    const poem = await response.json();
    if (![poem?.content, poem?.author, poem?.origin].every(value => typeof value === "string" && value.trim())) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(poem.date)) return;
    const date = new Date(poem.date + "T00:00:00Z");
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== poem.date) return;
    const label = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "UTC", month: "numeric", day: "numeric"
    }).format(date);
    const weekday = new Intl.DateTimeFormat("zh-CN", { timeZone: "UTC", weekday: "long" }).format(date);
    const stamp = document.querySelector("#dailyQuoteDate");
    stamp.dateTime = poem.date;
    stamp.textContent = `${label} · ${weekday}`;
    document.querySelector("#dailyQuote").textContent = `“${poem.content}”`;
    document.querySelector("#quoteSource").textContent = `— ${poem.author}《${poem.origin}》`;
  } catch {
    // The HTML already contains a complete poem for the first visit without a cache.
  }
}

renderDailyPoem();
