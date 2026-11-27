import test from 'node:test';
import assert from 'node:assert/strict';
import { draftContext, draftTileOrigins, restoreDraft } from './draft-state.mjs';
const base=JSON.stringify([{id:'m',kind:'run',tileIds:['a','b','c']}]);
const fresh=()=>({base,originalHandIds:new Set(['d','e']),handIds:['d','e'],table:JSON.parse(base),undo:[]});
const saved=()=>({base,originalHandIds:['d','e'],handIds:['e'],table:[{id:'m',kind:'run',tileIds:['a','b','c','d']}],undo:[{table:JSON.parse(base),handIds:['d','e']}]});
test('restore keeps private layout and undo history while retaining current turn identity',()=>{
  const draft=restoreDraft(saved(),{...fresh(),turnId:'new-view'});assert.equal(draft.turnId,'new-view');assert.equal(draft.undo.length,1);assert.equal(draft.table[0].tileIds.length,4);assert.ok(draft.originalHandIds instanceof Set);
});

test('a rack insertion and a cross-meld move mark only those tiles, even when meld indices shift', () => {
  const run = (id, ...tileIds) => ({id, kind:'run', tileIds});
  const original = [run('red','r6','joker','r8'), run('blue','b6','b7','b8')];
  const hand = new Set(['rack6']);
  const rearranged = [run('blue','b6','joker','b7','b8'), run('red','r6','rack6','r8')];
  assert.deepEqual(draftTileOrigins(original,rearranged,hand),new Map([['joker','meld'],['rack6','rack']]));
  assert.equal(draftTileOrigins(original,[original[1],original[0]],hand).size,0);
  const rebuilt = [run('new','r6','joker','r8','rack6'),original[1]];
  assert.deepEqual(draftTileOrigins(original,rebuilt,hand),new Map([['rack6','rack']]));
});

test('refresh and undo derive source marks from the same start-of-turn tiles', () => {
  const restored = restoreDraft(saved(),fresh());
  const original = JSON.parse(restored.base);
  assert.deepEqual(draftTileOrigins(original,restored.table,restored.originalHandIds),new Map([['d','rack']]));
  assert.equal(draftTileOrigins(original,restored.undo[0].table,restored.originalHandIds).size,0);
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
