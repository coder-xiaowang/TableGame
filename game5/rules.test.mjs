import assert from "node:assert/strict";
import test from "node:test";
import {createDeck,isPlayable} from "./rules.mjs";

test("UNO deck contains 108 unique physical cards with standard composition",()=>{
  const deck=createDeck(()=>0.37);
  assert.equal(deck.length,108);
  assert.equal(new Set(deck.map((card)=>card.id)).size,108);
  assert.equal(deck.filter((card)=>card.type==="wild").length,4);
  assert.equal(deck.filter((card)=>card.type==="wild4").length,4);
  for(const color of ["red","yellow","green","blue"]){
    assert.equal(deck.filter((card)=>card.color===color).length,25);
    assert.equal(deck.filter((card)=>card.color===color&&card.type==="number"&&card.value===0).length,1);
    assert.equal(deck.filter((card)=>card.color===color&&card.type==="draw2").length,2);
  }
});

test("normal play matches color, number or action while wild is universal",()=>{
  const top={id:"top",color:"red",type:"number",value:5};
  const context={top,currentColor:"red"};
  assert.equal(isPlayable({id:"a",color:"red",type:"skip"},context),true);
  assert.equal(isPlayable({id:"b",color:"blue",type:"number",value:5},context),true);
  assert.equal(isPlayable({id:"c",color:"blue",type:"number",value:7},context),false);
  assert.equal(isPlayable({id:"d",color:null,type:"wild"},context),true);
});

test("penalty stacking accepts only +2/+4 and drawn-card lock excludes the old hand",()=>{
  const top={id:"top",color:"red",type:"draw2",value:null};
  assert.equal(isPlayable({id:"d2",color:"blue",type:"draw2"},{top,currentColor:"red",pendingDraw:2}),true);
  assert.equal(isPlayable({id:"w4",color:null,type:"wild4"},{top,currentColor:"red",pendingDraw:2}),true);
  assert.equal(isPlayable({id:"skip",color:"red",type:"skip"},{top,currentColor:"red",pendingDraw:2}),false);
  assert.equal(isPlayable({id:"old",color:"red",type:"number",value:3},{top,currentColor:"red",drawnCardId:"drawn"}),false);
  assert.equal(isPlayable({id:"drawn",color:"red",type:"number",value:9},{top,currentColor:"red",drawnCardId:"drawn"}),true);
});
