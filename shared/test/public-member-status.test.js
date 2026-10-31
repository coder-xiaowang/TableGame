"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { createPublicMemberStatusLayer, normalizePublicMemberStatus, PUBLIC_MEMBER_STATUSES } from "../client/public-member-status.js";

test("public statuses are a fixed non-secret allowlist",()=>{
  assert.deepEqual(PUBLIC_MEMBER_STATUSES.map(({id})=>id),["present","thinking","away","help"]);
  assert.equal(normalizePublicMemberStatus({status:"private-role"}),null);
  assert.deepEqual(normalizePublicMemberStatus({id:"p1",status:"away",updatedAt:8}),{id:"away",icon:"☕",label:"暂时离开",memberId:"p1",updatedAt:8});
});

class FakeClassList{
  constructor(node){this.node=node;this.values=new Set();}
  add(value){this.values.add(value);}
  remove(value){this.values.delete(value);}
  contains(value){return this.values.has(value)||String(this.node.className||"").split(/\s+/).includes(value);}
}
class FakeNode{
  constructor(){this.children=[];this.dataset={};this.style={};this.className="";this.classList=new FakeClassList(this);this.hidden=false;this.attributes=new Map();this.offsetWidth=230;this.offsetHeight=190;}
  append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}
  insertAdjacentElement(_where,node){this.inserted=node;}
  setAttribute(name,value){this.attributes.set(name,String(value));}
  addEventListener(){}
  contains(node){return node===this||this.children.some((child)=>child.contains?.(node));}
  getBoundingClientRect(){return{left:10,right:40,top:10,bottom:40,width:30,height:30};}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter((child)=>child!==this);this.removed=true;}
}
class FakeDocument{
  constructor(){this.body=new FakeNode();this.head=new FakeNode();this.status=new FakeNode();this.anchors=new Map();}
  createElement(){return new FakeNode();}
  getElementById(id){return id==="connectionStatus"?this.status:null;}
  addAnchor(id){const anchor=new FakeNode();anchor.dataset.playerId=id;this.anchors.set(id,anchor);this.body.append(anchor);return anchor;}
  querySelector(selector){for(const [id,anchor] of this.anchors)if(selector.includes(`"${id}"`))return anchor;return null;}
  querySelectorAll(selector){
    const found=[];const visit=(node)=>{if(selector===".shared-member-status-badge"&&(node.classList.contains("shared-member-status-badge")||node.className==="shared-member-status-badge"))found.push(node);for(const child of node.children)visit(child);};visit(this.body);return found;
  }
  addEventListener(){}
  removeEventListener(){}
}

test("status badges reconcile independently and stale events cannot overwrite newer state",async()=>{
  const documentRef=new FakeDocument(),anchor=documentRef.addAnchor("p1");
  const room={setMemberStatus:async()=>{},subscribeMemberStatuses(listener){this.listener=listener;return()=>{};}};
  const layer=createPublicMemberStatusLayer({room,documentRef,enabled:true,windowRef:{innerWidth:800,innerHeight:600,addEventListener(){},removeEventListener(){}}});
  const menuStyle=documentRef.head.children.find((node)=>Object.hasOwn(node.dataset,"publicMemberStatusStyle"));
  assert.match(menuStyle.textContent,/--member-status-menu-text,#182128/);
  assert.match(menuStyle.textContent,/--member-status-menu-bg,#fffaf2/);
  layer.sync({selfId:"p1",players:[{id:"p1",connected:true}],memberStatuses:[{id:"p1",status:"thinking",updatedAt:10}]},{playerId:"p1"});
  await Promise.resolve();
  assert.equal(layer.currentStatus(),"thinking");
  assert.equal(documentRef.querySelectorAll(".shared-member-status-badge").at(-1).dataset.status,"thinking");
  const firstBadge=documentRef.querySelectorAll(".shared-member-status-badge").at(-1);
  layer.receive({id:"p1",status:"away",updatedAt:9});
  assert.equal(layer.currentStatus(),"thinking");
  assert.equal(documentRef.querySelectorAll(".shared-member-status-badge").at(-1),firstBadge);
  layer.receive({id:"p1",status:"present",updatedAt:11});
  assert.equal(layer.currentStatus(),"present");
  assert.equal(documentRef.querySelectorAll(".shared-member-status-badge").length,1);
  assert.equal(documentRef.querySelectorAll(".shared-member-status-badge")[0].dataset.status,"present");
  assert.equal(anchor.children.length,1,"status uses one reserved player presence rail");
  assert.equal(anchor.children[0].dataset.sharedPlayerPresenceRail,"true");
  layer.destroy();
});

test("an offline player does not retain a misleading manual status badge",async()=>{
  const documentRef=new FakeDocument(),anchor=documentRef.addAnchor("p2");
  const room={setMemberStatus:async()=>{},subscribeMemberStatuses(){return()=>{};}};
  const layer=createPublicMemberStatusLayer({room,documentRef,enabled:true,windowRef:{addEventListener(){},removeEventListener(){}}});
  layer.sync({players:[{id:"p2",connected:false}],memberStatuses:[{id:"p2",status:"away",updatedAt:4}]},{});
  await Promise.resolve();
  assert.equal(anchor.children.length,0);
  layer.destroy();
});

test("the public status entry is disabled by default",()=>{
  const documentRef=new FakeDocument();
  const room={setMemberStatus:async()=>{},subscribeMemberStatuses(){throw new Error("disabled layers must not subscribe");}};
  createPublicMemberStatusLayer({room,documentRef});
  assert.equal(documentRef.status.inserted,undefined);
  assert.equal(documentRef.querySelectorAll(".shared-member-status-badge").length,0);
});
