import test from 'node:test';
import assert from 'node:assert/strict';
import { draftContext, restoreDraft } from './draft-state.mjs';
const base=JSON.stringify([{id:'m',kind:'run',tileIds:['a','b','c']}]);
const fresh=()=>({base,originalHandIds:new Set(['d','e']),handIds:['d','e'],table:JSON.parse(base),undo:[]});
const saved=()=>({base,originalHandIds:['d','e'],handIds:['e'],table:[{id:'m',kind:'run',tileIds:['a','b','c','d']}],undo:[{table:JSON.parse(base),handIds:['d','e']}]});
test('restore keeps private layout and undo history while retaining current turn identity',()=>{
  const draft=restoreDraft(saved(),{...fresh(),turnId:'new-view'});assert.equal(draft.turnId,'new-view');assert.equal(draft.undo.length,1);assert.equal(draft.table[0].tileIds.length,4);assert.ok(draft.originalHandIds instanceof Set);
});
test('stale board or changed hand invalidates saved draft',()=>{
  assert.equal(restoreDraft({...saved(),base:'[]'},fresh()),null);
  assert.equal(restoreDraft({...saved(),originalHandIds:['d','x']},fresh()),null);
});
test('reject duplicates, missing or foreign tiles, and public tiles returned to rack',()=>{
  for(const handIds of [['d','e'],[],['x'],['a','e']]) assert.equal(restoreDraft({...saved(),handIds},fresh()),null);
  assert.equal(restoreDraft({...saved(),table:[{id:'m',kind:'bogus',tileIds:['a','b','c','d']}]},fresh()),null);
});
test('draft scope changes for room, player and round and is absent for spectators',()=>{
  const view={phase:'playing',permissions:{canAct:true},selfId:'a',gameNumber:1,turnId:'turn'};
  const context=draftContext(view,'ABCD');
  for(const [next,room] of [[view,'EFGH'],[{...view,selfId:'b'},'ABCD'],[{...view,turnId:'next'},'ABCD'],[{...view,gameNumber:2},'ABCD']])assert.notEqual(draftContext(next,room),context);
  assert.equal(draftContext({...view,permissions:{canAct:false}},'ABCD'),null);
});
