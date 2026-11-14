import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditSynchronizer } from './edit-sync.mjs';
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const state = { key:'turn-1', edited:false, dirty:true }, calls=[];
  const sync=createEditSynchronizer({getState:()=>state,send:action=>new Promise((resolve,reject)=>calls.push({action,resolve,reject}))});
  return {state,calls,sync};
}
test('failed beginEdit can retry without losing dirty state or looping', async()=>{
  const {state,calls,sync}=harness();sync.sync();await flush();calls[0].reject(Error('offline'));await flush();
  sync.observe();await flush();assert.equal(calls.length,1);assert.equal(sync.status().pending,false);assert.equal(sync.status().error,'offline');
  sync.sync({retry:true});sync.sync({retry:true});await flush();assert.equal(calls.length,2);
  state.edited=true;sync.observe();calls[1].resolve();await flush();assert.deepEqual(sync.status(),{pending:false,error:''});
});
test('undo while beginEdit is pending serializes resetEdit after acknowledgement',async()=>{
  const {state,calls,sync}=harness();sync.sync();await flush();state.dirty=false;sync.sync();assert.equal(calls.length,1);
  state.edited=true;sync.observe();calls[0].resolve();await flush();assert.equal(calls[1].action.type,'resetEdit');
  state.edited=false;sync.observe();calls[1].resolve();await flush();assert.equal(calls.length,2);assert.equal(sync.status().pending,false);
});
test('late failure from old turn cannot poison a new turn',async()=>{
  const {state,calls,sync}=harness();sync.sync();await flush();state.key='turn-2';sync.observe();await flush();
  calls[0].reject(Error('old response'));await flush();assert.equal(sync.status().error,'');assert.equal(sync.status().pending,true);
  state.edited=true;sync.observe();calls[1].resolve();await flush();assert.equal(sync.status().pending,false);
});
test('lost HTTP response is successful when SSE has already confirmed edit',async()=>{
  const {state,calls,sync}=harness();sync.sync();await flush();state.edited=true;sync.observe();calls[0].reject(Error('response lost'));await flush();
  assert.deepEqual(sync.status(),{pending:false,error:''});assert.equal(calls.length,1);
});
test('HTTP acknowledgement waits for authoritative view without duplicate sends',async()=>{
  const {state,calls,sync}=harness();sync.sync();await flush();calls[0].resolve();await flush();sync.observe();sync.sync({retry:true});await flush();
  assert.equal(calls.length,1);assert.equal(sync.status().pending,true);
  state.edited=true;sync.observe();assert.equal(sync.status().pending,false);
});
test('turn expiration before queued request prevents submission',async()=>{
  const {state,calls,sync}=harness();sync.sync();state.key=null;sync.observe();await flush();assert.equal(calls.length,0);assert.equal(sync.status().pending,false);
});
test('a failed edit request after undo does not leave a stale retry error',async()=>{
  const {state,calls,sync}=harness();sync.sync();await flush();state.dirty=false;sync.sync();
  calls[0].reject(Error('offline'));await flush();assert.deepEqual(sync.status(),{pending:false,error:''});assert.equal(calls.length,1);
});
