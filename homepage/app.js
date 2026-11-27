"use strict";

const SITE_TIME_ZONE = "Asia/Shanghai";

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
  { text: "长风破浪会有时，直挂云帆济沧海。", source: "李白《行路难》" },
  { text: "众里寻他千百度，蓦然回首，那人却在，灯火阑珊处。", source: "辛弃疾《青玉案·元夕》"}
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

function renderDailyQuote(parts) {
  const dateKey = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  let hash = 0;

  for (const character of dateKey) {
    hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  }

  const quote = quotes[Math.abs(hash) % quotes.length];
  document.querySelector("#dailyQuote").textContent = `“${quote.text}”`;
  document.querySelector("#quoteSource").textContent = `— ${quote.source}`;
  const date = document.querySelector("#dailyQuoteDate");
  date.dateTime = dateKey;
  date.textContent = `${parts.month}月${parts.day}日 · ${parts.weekday}`;
}

const today = getShanghaiDateParts();
renderDailyQuote(today);
document.querySelector("#footerYear").textContent = today.year;
