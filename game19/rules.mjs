export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 7;

export const SUITS = Object.freeze({ SPADES: "spades", HEARTS: "hearts", CLUBS: "clubs", DIAMONDS: "diamonds" });
export const SUIT_LABELS = Object.freeze({ spades: "♠", hearts: "♥", clubs: "♣", diamonds: "♦" });

export const ROLES = Object.freeze({ SHERIFF: "sheriff", DEPUTY: "deputy", OUTLAW: "outlaw", RENEGADE: "renegade" });
export const ROLE_META = Object.freeze({
  sheriff: { label: "警长", goal: "消灭所有歹徒和叛徒。" },
  deputy: { label: "副警长", goal: "保护警长并消灭歹徒和叛徒。" },
  outlaw: { label: "歹徒", goal: "杀死警长。" },
  renegade: { label: "叛徒", goal: "成为最后存活者，最后亲手击败警长。" }
});

export const ROLE_DISTRIBUTION = Object.freeze({
  4: Object.freeze([ROLES.SHERIFF, ROLES.RENEGADE, ROLES.OUTLAW, ROLES.OUTLAW]),
  5: Object.freeze([ROLES.SHERIFF, ROLES.RENEGADE, ROLES.DEPUTY, ROLES.OUTLAW, ROLES.OUTLAW]),
  6: Object.freeze([ROLES.SHERIFF, ROLES.RENEGADE, ROLES.DEPUTY, ROLES.OUTLAW, ROLES.OUTLAW, ROLES.OUTLAW]),
  7: Object.freeze([ROLES.SHERIFF, ROLES.RENEGADE, ROLES.DEPUTY, ROLES.DEPUTY, ROLES.OUTLAW, ROLES.OUTLAW, ROLES.OUTLAW])
});

export const CHARACTERS = Object.freeze([
  { id: "bart_cassidy", name: "巴特·卡西迪", life: 4, text: "每失去1点生命，摸1张牌。" },
  { id: "black_jack", name: "黑杰克", life: 4, text: "摸牌阶段公开第二张牌；若为红色，再摸1张。" },
  { id: "calamity_janet", name: "灾星珍妮", life: 4, text: "【砰！】和【闪！】可以互相替代。" },
  { id: "el_gringo", name: "埃尔·格林戈", life: 3, text: "受到玩家伤害时，从其手牌随机获得1张。" },
  { id: "jesse_jones", name: "杰西·琼斯", life: 4, text: "摸第一张牌时可改为从另一玩家手牌随机抽1张。" },
  { id: "jourdonnais", name: "乔尔多内", life: 4, text: "每次受到【砰！】时，可先作一次虚拟【木桶】判定。" },
  { id: "kit_carlson", name: "基特·卡尔森", life: 4, text: "摸牌时查看牌堆顶3张，取2张并将1张放回牌堆顶。" },
  { id: "lucky_duke", name: "幸运公爵", life: 4, text: "判定时翻2张并选择其中1张。" },
  { id: "paul_regret", name: "保罗·雷格雷特", life: 3, text: "其他玩家计算到你的距离+1。" },
  { id: "pedro_ramirez", name: "佩德罗·拉米雷兹", life: 4, text: "摸第一张牌时可改为取得弃牌堆顶牌。" },
  { id: "rose_doolan", name: "罗斯·杜兰", life: 4, text: "你计算到其他玩家的距离-1。" },
  { id: "sid_ketchum", name: "西德·凯查姆", life: 4, text: "弃2张手牌，回复1点生命。" },
  { id: "slab_the_killer", name: "杀手斯拉布", life: 4, text: "其他玩家需打出2张【闪！】才能躲避你的【砰！】。" },
  { id: "suzy_lafayette", name: "苏西·拉法叶", life: 4, text: "手牌为0时立即摸1张牌。" },
  { id: "vulture_sam", name: "秃鹫山姆", life: 4, text: "其他玩家出局时，获得其全部牌。" },
  { id: "willy_the_kid", name: "比利小子", life: 4, text: "出牌阶段可打出任意数量的【砰！】。" }
]);

export const CARD_META = Object.freeze({
  bang: { name: "砰！", color: "brown", text: "对射程内一名玩家使用；其须以【闪！】响应，否则失去1点生命。" },
  missed: { name: "闪！", color: "brown", text: "响应【砰！】以躲避攻击。" },
  beer: { name: "啤酒", color: "brown", text: "回复1点生命；仅剩2人时无效。" },
  cat_balou: { name: "拆除", color: "brown", text: "弃掉任意距离一名玩家的一张牌。" },
  stagecoach: { name: "驿马车", color: "brown", text: "摸2张牌。" },
  duel: { name: "决斗", color: "brown", text: "双方轮流打出【砰！】，先无法响应者失去1点生命。" },
  general_store: { name: "杂货店", color: "brown", text: "公开等同存活人数的牌，依次各选1张。" },
  gatling: { name: "加特林", color: "brown", text: "其他所有玩家须打出【闪！】，否则失去1点生命。" },
  indians: { name: "印第安人！", color: "brown", text: "其他所有玩家须打出【砰！】，否则失去1点生命。" },
  panic: { name: "抢劫", color: "brown", text: "取得距离1以内一名玩家的一张牌。" },
  saloon: { name: "酒馆", color: "brown", text: "所有存活玩家回复1点生命。" },
  wells_fargo: { name: "富国银行", color: "brown", text: "摸3张牌。" },
  barrel: { name: "木桶", color: "blue", equipment: "barrel", text: "受到【砰！】时可判定；红桃视为打出【闪！】。" },
  dynamite: { name: "炸药", color: "blue", equipment: "dynamite", text: "回合开始判定：黑桃2至9爆炸，否则传给下家。" },
  scope: { name: "瞄准镜", color: "blue", equipment: "scope", text: "你计算到其他玩家的距离-1。" },
  mustang: { name: "野马", color: "blue", equipment: "mustang", text: "其他玩家计算到你的距离+1。" },
  jail: { name: "监狱", color: "blue", equipment: "jail", text: "置于非警长玩家面前；回合开始判定非红桃则跳过回合。" },
  volcanic: { name: "火山手枪", color: "blue", equipment: "weapon", range: 1, text: "射程1；本回合可打出任意数量的【砰！】。" },
  schofield: { name: "斯科菲尔德", color: "blue", equipment: "weapon", range: 2, text: "射程2。" },
  remington: { name: "雷明顿", color: "blue", equipment: "weapon", range: 3, text: "射程3。" },
  rev_carabine: { name: "卡宾枪", color: "blue", equipment: "weapon", range: 4, text: "射程4。" },
  winchester: { name: "温彻斯特", color: "blue", equipment: "weapon", range: 5, text: "射程5。" }
});

const S = SUITS.SPADES, H = SUITS.HEARTS, C = SUITS.CLUBS, D = SUITS.DIAMONDS;
const spec = (type, suit, ranks) => ranks.map((rank) => ({ type, suit, rank: String(rank) }));
const sequence = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => String(from + index));

export function createDeck() {
  const specs = [
    ...spec("barrel", S, ["Q", "K"]), ...spec("dynamite", H, ["2"]), ...spec("scope", S, ["A"]),
    ...spec("mustang", H, ["8", "9"]), ...spec("jail", S, ["J", "10"]), ...spec("jail", H, ["4"]),
    ...spec("remington", C, ["K"]), ...spec("rev_carabine", C, ["A"]), ...spec("schofield", C, ["J", "Q"]), ...spec("schofield", S, ["K"]),
    ...spec("volcanic", S, ["10"]), ...spec("volcanic", C, ["10"]), ...spec("winchester", S, ["8"]),
    ...spec("bang", S, ["A"]), ...spec("bang", D, [...sequence(2, 10), "J", "Q", "K", "A"]), ...spec("bang", C, sequence(2, 9)), ...spec("bang", H, ["Q", "K", "A"]),
    ...spec("beer", H, sequence(6, 11).map((value) => value === "11" ? "J" : value)),
    ...spec("cat_balou", H, ["K"]), ...spec("cat_balou", D, ["9", "10", "J"]),
    ...spec("stagecoach", S, ["9", "9"]), ...spec("duel", D, ["Q"]), ...spec("duel", S, ["J"]), ...spec("duel", C, ["8"]),
    ...spec("general_store", C, ["9"]), ...spec("general_store", S, ["Q"]), ...spec("gatling", H, ["10"]),
    ...spec("indians", D, ["K", "A"]), ...spec("missed", C, ["10", "J", "Q", "K", "A"]), ...spec("missed", S, sequence(2, 8)),
    ...spec("panic", H, ["J", "Q", "A"]), ...spec("panic", D, ["8"]), ...spec("saloon", H, ["5"]), ...spec("wells_fargo", H, ["3"])
  ];
  if (specs.length !== 80) throw new Error(`BANG! deck must contain 80 cards, got ${specs.length}`);
  return specs.map((card, index) => ({ id: `bang19_${String(index + 1).padStart(2, "0")}`, ...card }));
}

export function shuffle(values, random = Math.random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function cardName(type) { return CARD_META[type]?.name || "未知牌"; }
export function suitLabel(suit) { return SUIT_LABELS[suit] || "?"; }
export function isRed(card) { return card?.suit === H || card?.suit === D; }
export function isDynamiteHit(card) { return card?.suit === S && Number(card.rank) >= 2 && Number(card.rank) <= 9; }
export function isBarrelSuccess(card) { return card?.suit === H; }
export function isJailSuccess(card) { return card?.suit === H; }
