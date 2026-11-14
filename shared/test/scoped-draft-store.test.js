import test from 'node:test';
import assert from 'node:assert/strict';
import {createScopedDraftStore} from '../client/scoped-draft-store.js';
test('reload recovers matching draft and expired context is discarded',()=>{
  const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const store=createScopedDraftStore('test',()=>storage);store.save('round-1',{cards:['a']});
  assert.deepEqual(createScopedDraftStore('test',()=>storage).load('round-1'),{cards:['a']});
  assert.equal(store.load('round-2'),null);assert.equal(values.size,0);
});
test('unavailable or corrupt storage never interrupts play',()=>{
  const denied=createScopedDraftStore('test',()=>{throw Error('storage denied');});
  assert.doesNotThrow(()=>denied.save('turn',{cards:[]}));assert.equal(denied.load('turn'),null);assert.doesNotThrow(()=>denied.clear());
  let removed=false;const corrupt=createScopedDraftStore('test',()=>({getItem:()=>'{bad',removeItem:()=>{removed=true;}}));
  assert.equal(corrupt.load('turn'),null);assert.equal(removed,true);
});
