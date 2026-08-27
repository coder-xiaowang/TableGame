import assert from "node:assert/strict";
import test from "node:test";
import {createDeck,isKamikaze,powerForValue,scoreRound} from "./rules.mjs";

const slots=(values)=>values.map((value,index)=>({slotId:`s${index}`,card:{id:`c${index}_${value}`,value}}));

test("CABO deck contains 52 unique cards with the second-edition value distribution",()=>{
  const deck=createDeck(()=>.42);
  assert.equal(deck.length,52);
  assert.equal(new Set(deck.map((card)=>card.id)).size,52);
  const counts=Map.groupBy?Map.groupBy(deck,(card)=>card.value):deck.reduce((map,card)=>map.set(card.value,(map.get(card.value)||[]).concat(card)),new Map());
  assert.equal(counts.get(0).length,2);assert.equal(counts.get(13).length,2);
  for(let value=1;value<=12;value+=1)assert.equal(counts.get(value).length,4);
});

test("powers belong only to values 7 through 12",()=>{
  assert.equal(powerForValue(6),null);assert.equal(powerForValue(7),"peek");assert.equal(powerForValue(9),"spy");assert.equal(powerForValue(12),"swap");assert.equal(powerForValue(13),null);
});

test("CABO caller scores zero when tied lowest and receives ten when beaten",()=>{
  const players=[{id:"a",slots:slots([1,2])},{id:"b",slots:slots([0,3])},{id:"c",slots:slots([0,4])}];
  let result=scoreRound(players,"a");assert.equal(result[0].score,0);assert.equal(result[1].score,3);
  players[1].slots=slots([0,1]);result=scoreRound(players,"a");assert.equal(result[0].score,13);assert.equal(result[0].reason,"caboPenalty");
});

test("Kamikaze overrides ordinary and caller scoring",()=>{
  const players=[{id:"a",slots:slots([12,13,12,13])},{id:"b",slots:slots([0,1])}];
  assert.equal(isKamikaze(players[0].slots),true);
  const result=scoreRound(players,"b");assert.equal(result[0].score,0);assert.equal(result[1].score,50);
});
