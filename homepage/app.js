"use strict";

const SITE_TIME_ZONE = "Asia/Shanghai";

const modules = [
  {
    id: "tools",
    icon: "⌁",
    title: "实用工具",
    description: "简单、顺手，也许能替日常省下一点时间。",
    theme: "sage"
  },
  {
    id: "notes",
    icon: "✎",
    title: "随笔与记录",
    description: "记下生活、想法，以及偶然遇见的小故事。",
    theme: "blue"
  },
  {
    id: "collection",
    icon: "☆",
    title: "收藏与分享",
    description: "书、电影、音乐，还有值得反复回味的东西。",
    theme: "lavender"
  },
  {
    id: "plans",
    icon: "⌁",
    title: "未来计划",
    description: "慢慢搭建中，新的房间会陆续亮起灯来。",
    theme: "apricot"
  }
];

const quotes = [
  { text: "且将新火试新茶，诗酒趁年华。", source: "苏轼《望江南·超然台作》" },
  { text: "山中何事？松花酿酒，春水煎茶。", source: "张可久《人月圆·山中书事》" },
  { text: "行到水穷处，坐看云起时。", source: "王维《终南别业》" },
  { text: "掬水月在手，弄花香满衣。", source: "于良史《春山夜月》" },
  { text: "晚来天欲雪，能饮一杯无？", source: "白居易《问刘十九》" },
  { text: "人生天地间，忽如远行客。", source: "《古诗十九首》" },
  { text: "海内存知己，天涯若比邻。", source: "王勃《送杜少府之任蜀州》" },
  { text: "明天，又是新的一天。", source: "电影《乱世佳人》" },
  { text: "希望是美好的，也许是人间至善。", source: "电影《肖申克的救赎》" },
  { text: "每个人都会死去，但不是每个人都真正活过。", source: "电影《勇敢的心》" },
  { text: "莫听穿林打叶声，何妨吟啸且徐行。", source: "苏轼《定风波》" },
  { text: "长风破浪会有时，直挂云帆济沧海。", source: "李白《行路难》" }
];

function getShanghaiDateParts() {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: SITE_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "long"
  }).formatToParts(new Date());

  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function renderModules() {
  const grid = document.querySelector("#moduleGrid");

  for (const module of modules) {
    const card = document.createElement("a");
    card.className = `module-card theme-${module.theme}`;
    card.href = `#roadmap`;
    card.dataset.module = module.id;
    card.innerHTML = `
      <span class="module-status">筹备中</span>
      <span class="module-icon" aria-hidden="true">${module.icon}</span>
      <strong>${module.title}</strong>
      <span class="module-description">${module.description}</span>
      <span class="module-action">看看计划 <span aria-hidden="true">→</span></span>
      <span class="module-doodle" aria-hidden="true"></span>
    `;
    grid.append(card);
  }
}

function renderDailyQuote(parts) {
  const dateKey = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  let hash = 0;

  for (const character of dateKey) {
    hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  }

  const quote = quotes[Math.abs(hash) % quotes.length];
  document.querySelector("#dailyQuote").textContent = `“${quote.text}”`;
  document.querySelector("#quoteSource").textContent = `— ${quote.source}`;
  document.querySelector("#dailyQuoteDate").textContent = `${String(parts.month).padStart(2, "0")} · ${String(parts.day).padStart(2, "0")}`;
}

function renderCalendar(parts) {
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const firstDay = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mondayOffset = (firstDay + 6) % 7;
  const calendarDays = document.querySelector("#calendarDays");

  document.querySelector("#calendarYear").textContent = year;
  document.querySelector("#calendarMonth").textContent = `${String(month).padStart(2, "0")} 月`;
  document.querySelector("#todayNumber").textContent = String(day).padStart(2, "0");
  document.querySelector("#todayWeekday").textContent = parts.weekday;
  document.querySelector("#footerYear").textContent = year;

  for (let index = 0; index < mondayOffset; index += 1) {
    const blank = document.createElement("span");
    blank.className = "calendar-blank";
    calendarDays.append(blank);
  }

  for (let date = 1; date <= daysInMonth; date += 1) {
    const cell = document.createElement("span");
    cell.textContent = date;
    if (date === day) {
      cell.className = "today";
      cell.setAttribute("aria-current", "date");
      cell.setAttribute("aria-label", `今天，${month}月${day}日`);
    }
    calendarDays.append(cell);
  }
}

function setupNavigation() {
  const button = document.querySelector("#menuButton");
  const nav = document.querySelector("#siteNav");

  button.addEventListener("click", () => {
    const open = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!open));
    nav.classList.toggle("open", !open);
  });

  nav.addEventListener("click", () => {
    button.setAttribute("aria-expanded", "false");
    nav.classList.remove("open");
  });
}

const today = getShanghaiDateParts();
renderModules();
renderDailyQuote(today);
renderCalendar(today);
setupNavigation();
