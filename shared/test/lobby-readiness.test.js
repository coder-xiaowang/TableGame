"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { createLobbyReadinessLayer, normalizeLobbyReadiness } from "../client/lobby-readiness.js";

test("lobby readiness recomputes public totals instead of trusting supplied counters",()=>{
  const model=normalizeLobbyReadiness({active:true,readyCount:99,total:99,allReady:true,members:[{id:"host",isHost:true,connected:true,ready:true},{id:"p2",connected:true,ready:false}]});
  assert.equal(model.readyCount,1);assert.equal(model.total,2);assert.equal(model.allReady,false);
});

class FakeClassList{constructor(node){this.node=node;this.values=new Set();}add(value){this.values.add(value);}remove(value){this.values.delete(value);}toggle(value,force){if(force)this.add(value);else this.remove(value);}contains(value){return this.values.has(value)||String(this.node.className||"").split(/\s+/).includes(value);}}
class FakeNode{
  constructor(){this.children=[];this.dataset={};this.style={};this.className="";this.classList=new FakeClassList(this);this.hidden=false;this.attributes=new Map();this.listeners=new Map();this.title="";}
  append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}
  insertAdjacentElement(_where,node){this.inserted=node;}
  setAttribute(name,value){this.attributes.set(name,String(value));}
  addEventListener(name,handler){this.listeners.set(name,handler);}
  click(){return this.listeners.get("click")?.({target:this});}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter((child)=>child!==this);}
}
class FakeDocument{
  constructor(){this.body=new FakeNode();this.head=new FakeNode();this.connection=new FakeNode();this.start=new FakeNode();this.anchors=new Map();}
  createElement(){return new FakeNode();}
  getElementById(id){if(id==="connectionStatus")return this.connection;if(id==="startGameButton")return this.start;return null;}
  addAnchor(id){const node=new FakeNode();node.dataset.playerId=id;this.anchors.set(id,node);this.body.append(node);return node;}
  querySelector(selector){for(const [id,node] of this.anchors)if(selector.includes(`"${id}"`))return node;return null;}
  querySelectorAll(selector){const found=[];const visit=(node)=>{if(selector.includes("shared-lobby-player-ready")&&(node.classList.contains("shared-lobby-player-ready")||node.classList.contains("shared-lobby-player-waiting")))found.push(node);for(const child of node.children)visit(child);};visit(this.body);return found;}
}

test("the lobby layer marks stable player anchors and lets a guest confirm readiness",async()=>{
  const documentRef=new FakeDocument(),hostAnchor=documentRef.addAnchor("host"),guestAnchor=documentRef.addAnchor("guest"),calls=[];
  const room={setLobbyReady:async(value)=>calls.push(value),subscribeLobbyReadiness(listener){this.listener=listener;return()=>{};}};
  const layer=createLobbyReadinessLayer({room,documentRef});
  const waiting={active:true,members:[{id:"host",isHost:true,connected:true,ready:true},{id:"guest",isHost:false,connected:true,ready:false}]};
  layer.sync({selfId:"guest",roomRole:"player",lobbyReadiness:waiting},{playerId:"guest"});await Promise.resolve();
  assert.equal(hostAnchor.children.length,0);assert.equal(guestAnchor.children.length,0);assert.equal(documentRef.start.classList.contains("shared-lobby-all-ready"),false);
  assert.equal(hostAnchor.classList.contains("shared-lobby-player-ready"),true);assert.equal(guestAnchor.classList.contains("shared-lobby-player-waiting"),true);assert.equal(documentRef.start.attributes.get("aria-disabled"),"true");
  await Promise.resolve();assert.deepEqual(calls,[false],"a real lobby client registers readiness enforcement even before clicking ready");
  await documentRef.connection.inserted.children[0].click();assert.deepEqual(calls,[false,true]);
  layer.receive({active:true,members:[{id:"host",isHost:true,connected:true,ready:true},{id:"guest",isHost:false,connected:true,ready:true}]});
  assert.equal(layer.snapshot().allReady,true);assert.equal(documentRef.start.classList.contains("shared-lobby-all-ready"),true);assert.equal(guestAnchor.classList.contains("shared-lobby-player-ready"),true);assert.equal(documentRef.start.attributes.get("aria-disabled"),"false");assert.equal(documentRef.start.title,"所有正式玩家都已准备");layer.destroy();
});

test("spectators can see readiness but never receive a ready control",async()=>{
  const documentRef=new FakeDocument();documentRef.addAnchor("host");const room={setLobbyReady:async()=>{throw new Error("must not send");},subscribeLobbyReadiness(){return()=>{};}};const layer=createLobbyReadinessLayer({room,documentRef});layer.sync({roomRole:"spectator",lobbyReadiness:{active:true,members:[{id:"host",isHost:true,connected:true,ready:true}]}},{memberRole:"spectator"});await Promise.resolve();assert.equal(documentRef.connection.inserted.children[0].hidden,true);layer.destroy();
});
