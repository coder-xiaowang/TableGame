export const ACTION_SECONDS = 25;
export const COLORS = ["red","yellow","green","blue"];
export const COLOR_NAMES = {red:"红色",yellow:"黄色",green:"绿色",blue:"蓝色"};
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const INITIAL_HAND_SIZE = 7;

const HAND_COLORS = [...COLORS, null];
const ACTION_CARD_RANK = {skip: 10, reverse: 11, draw2: 12, wild: 13, wild4: 14};

export function compareHandCards(left, right) {
  const colorOrder = HAND_COLORS.indexOf(left.color) - HAND_COLORS.indexOf(right.color);
  if (colorOrder) return colorOrder;
  const rank = card => card.type === "number" ? card.value : ACTION_CARD_RANK[card.type];
  return rank(left) - rank(right);
}

export function isDrawCard(card) {
  return card?.type === "draw2" || card?.type === "wild4";
}

export function isPlayable(card, {top,currentColor,pendingDraw=0,drawnCardId=null}={}) {
  if (!card) return false;
  if (drawnCardId && card.id !== drawnCardId) return false;
  if (pendingDraw > 0) return isDrawCard(card);
  if (card.type === "wild" || card.type === "wild4") return true;
  if (card.color === currentColor) return true;
  if (!top) return false;
  if (card.type === "number" && top.type === "number") return card.value === top.value;
  return card.type === top.type;
}

export function describeCard(card) {
  if (!card) return "未知牌";
  if (card.type === "number") return `${COLOR_NAMES[card.color]} ${card.value}`;
  return `${card.color ? COLOR_NAMES[card.color] : "万能"}${{
    skip:"禁止",reverse:"反转",draw2:" +2",wild:"变色",wild4:" +4"
  }[card.type] || card.type}`;
}

export function createDeck(random=Math.random) {
  let sequence = 0;
  const card = (color,type,value=null) => ({id:`card_${sequence += 1}`,color,type,value});
  const cards = [];
  for (const color of COLORS) {
    cards.push(card(color,"number",0));
    for (let value=1;value<=9;value+=1) cards.push(card(color,"number",value),card(color,"number",value));
    for (let copy=0;copy<2;copy+=1) cards.push(card(color,"skip"),card(color,"reverse"),card(color,"draw2"));
  }
  for (let copy=0;copy<4;copy+=1) cards.push(card(null,"wild"),card(null,"wild4"));
  return shuffle(cards,random);
}

export function shuffle(items, random=Math.random) {
  const copy = [...items];
  for (let index=copy.length-1;index>0;index-=1) {
    const sample = Math.max(0,Math.min(.999999999999,Number(random()) || 0));
    const swapIndex = Math.floor(sample*(index+1));
    [copy[index],copy[swapIndex]] = [copy[swapIndex],copy[index]];
  }
  return copy;
}
