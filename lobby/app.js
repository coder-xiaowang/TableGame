"use strict";

function range(first, last) {
  return Array.from({length: last - first + 1}, (_, index) => first + index);
}

// Player counts follow the web editions. A game can require a discrete set of party sizes.
const games = [
  {id:"uno", host:"uno", name:"UNO", players:range(2,6), type:"轻松出牌", description:"接上颜色或数字，剩最后一张时别忘了喊 UNO！"},
  {id:"bull", host:"ntw", name:"牛头王", players:range(2,10), type:"轻松出牌", description:"大家同时亮牌。谁把第六张挤进一行，谁就收走牛头。"},
  {id:"dream", host:"zypy", name:"只言片语", players:range(3,8), type:"词语联想", description:"为一幅画留一句线索，让人猜得到，又别让人人都猜中。"},
  {id:"cabo", host:"cabo", name:"CABO", players:range(2,4), type:"轻松出牌", description:"记住自己的暗牌，偷看、交换，猜准时机喊 CABO。"},
  {id:"avalon", host:"awl", name:"阿瓦隆", players:range(5,10), type:"身份推理", description:"提名一支远征队，用每次投票判断谁值得信任。"},
  {id:"yacht", host:"kttz", name:"快艇骰子", players:range(2,6), type:"骰子挑战", description:"留下想要的骰子，再掷一次，把组合填进同桌计分表。"},
  {id:"gems", host:"ccbs", name:"璀璨宝石 · 宝可梦版", players:range(2,4), type:"策略经营", description:"拿取精灵球、捕捉伙伴，用阵容的折扣筹划下一次进化。"},
  {id:"decrypto", host:"jmz", name:"截码战", players:range(4,8), type:"词语联想", description:"分两队传递暗号，既要让队友听懂，也得防着对手截码。"},
  {id:"rummy", host:"lm", name:"拉密", players:range(2,4), type:"数字组合", description:"把数字排成组或顺子，借用桌上的牌，拼空自己的牌架。"},
  {id:"spy", host:"jdwj", name:"间谍危机", players:range(3,8), type:"身份推理", description:"同处一个秘密地点，只有间谍毫不知情。轮流提问找出破绽。"},
  {id:"pigs", host:"zxz", name:"脏小猪", players:range(2,6), type:"轻松出牌", description:"让小猪跳进泥坑，再盖好猪舍，提防邻居把它们洗干净。"},
  {id:"manila", host:"mnl", name:"马尼拉 · 港口大亨", players:range(4,5), type:"策略经营", preview:true, description:"竞拍港务长、安排助手，看货船能否赶在关港前靠岸。"},
  {id:"words", host:"whnc", name:"我话你猜", players:[2,4,6,8], type:"词语联想", description:"两人一队，一个描述，一个猜成语。试试你们的默契。"},
  {id:"coup", host:"zb", name:"政变", players:range(3,6), type:"身份推理", description:"声称自己是公爵，未必真有公爵。对手敢不敢质疑？"},
  {id:"thanks", host:"nt", name:"No Thanks!", players:range(3,7), type:"轻松出牌", description:"交一枚筹码推走这张牌，还是连牌带筹码一起收下？"},
  {id:"stocks", host:"ghzh", name:"股海纵横", players:range(2,5), type:"策略经营", description:"根据手里的内幕为股票堆报价，把有限的现金押在判断上。"},
  {id:"insider", host:"jnr", name:"局内人", players:range(4,8), type:"身份推理", description:"一起用是非题猜词，再找出那个悄悄引导答案的人。"},
  {id:"climb", host:"cs", name:"Can't Stop", players:range(2,4), type:"骰子挑战", description:"用骰子配出登山路线。多走一步，还是趁现在扎营？"},
  {id:"cipher", host:"sspy", name:"速速破译", players:range(2,32), type:"词语联想", description:"从线索中猜出密文。人多时可切换为玩家各自出词。"},
  {id:"criminal", host:"criminal", name:"犯人在跳舞", players:range(3,8), type:"身份推理", description:"随着手牌秘密交换，追查此刻是谁握着犯人。"},
  {id:"bang", host:"bang", name:"BANG!", players:range(4,7), type:"身份推理", description:"看射程、打手牌，在警长与歹徒的交锋里判断敌友。"}
];

// These games use their playing pieces as their lobby cover.
const pieces = {
  bull: ["24", "30", "35", "48", "55"],
  rummy: ["7", "8", "9", "10"],
  thanks: ["19", "●", "●"],
  climb: ["⚂", "⚄", "⚃", "⚁"],
  bang: ["砰！", "闪！", "木桶"]
};

function playerLabel(players) {
  const first = players[0], last = players.at(-1);
  return (last - first + 1 === players.length ? first + "–" + last : players.join("、")) + " 人";
}

function makeCard(game) {
  const link = document.createElement("a");
  link.className = "game";
  link.href = "https://" + game.host + ".zillionx.xyz";
  const art = document.createElement("div");
  art.className = "cover " + game.id;
  art.setAttribute("aria-hidden", "true");
  if (pieces[game.id]) {
    const row = document.createElement("div");
    row.className = "pieces";
    for (const value of pieces[game.id]) {
      const piece = document.createElement("i");
      piece.textContent = value;
      row.append(piece);
    }
    art.append(row);
  } else {
    const image = document.createElement("img");
    image.src = "lobby/covers/" + game.id + ".jpg";
    image.alt = "";
    image.loading = "lazy";
    art.append(image);
    if (game.id === "cabo" || game.id === "dream") {
      const spread = document.createElement("div");
      spread.className = "spread";
      for (let i = 0; i < 3; i++) spread.append(document.createElement("i"));
      art.append(spread);
    }
  }
  const info = document.createElement("div");
  info.className = "info";
  const meta = document.createElement("div");
  meta.className = "meta";
  const category = document.createElement("span");
  category.textContent = game.type;
  const seats = document.createElement("b");
  seats.textContent = playerLabel(game.players);
  meta.append(category, seats);
  const title = document.createElement("h3");
  title.textContent = game.name;
  if (game.preview) {
    const badge = document.createElement("small");
    badge.textContent = "试玩";
    title.append(badge);
  }
  const description = document.createElement("p");
  description.textContent = game.description;
  info.append(meta, title, description);
  link.append(art, info);
  return link;
}

const size = document.querySelector("#party-size");
const typeList = document.querySelector("#types");
const reset = document.querySelector("#reset");
const grid = document.querySelector("#games");
const cards = games.map(makeCard);
grid.append(...cards);
let selectedType = "";

const exactSizeLimit = 10;
const largeParty = exactSizeLimit + "+";
for (const count of range(2, exactSizeLimit)) size.add(new Option(count + " 人", count));
size.add(new Option(largeParty + " 人", largeParty));

for (const type of ["", ...new Set(games.map(game => game.type))]) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = type || "全部";
  button.dataset.type = type;
  button.addEventListener("click", () => {
    selectedType = type;
    filter();
  });
  typeList.append(button);
}

function filter() {
  const partySize = size.value;
  let matches = 0;
  games.forEach((game, i) => {
    const fitsParty = partySize === largeParty
      ? game.players.some(count => count > exactSizeLimit)
      : !partySize || game.players.includes(Number(partySize));
    const visible = fitsParty && (!selectedType || game.type === selectedType);
    cards[i].hidden = !visible;
    if (visible) matches++;
  });
  for (const button of typeList.children) {
    button.setAttribute("aria-pressed", String(button.dataset.type === selectedType));
  }
  document.querySelector("#result-count").textContent = matches + " 款";
  document.querySelector("#empty").hidden = matches > 0;
  reset.hidden = !partySize && !selectedType;
}

size.addEventListener("change", filter);
reset.addEventListener("click", () => {
  size.value = "";
  selectedType = "";
  filter();
  size.focus();
});
document.querySelector("#year").textContent = new Date().getFullYear();
filter();
