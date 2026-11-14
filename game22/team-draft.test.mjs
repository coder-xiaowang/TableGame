import test from 'node:test';
import assert from 'node:assert/strict';
import {teamDraftContext,validTeamDraft} from './team-draft.mjs';
const view={phase:'teamProposal',selfId:'a',matchNumber:1,questIndex:0,proposalNumber:1,leaderId:'a',permissions:{canPropose:true},requiredTeamSize:2,players:[{id:'a'},{id:'b'},{id:'c'}]};
test('team selection is bounded, distinct and contains only current players',()=>{
  assert.deepEqual(validTeamDraft(['a','a','missing','b','c'],view),['a','b']);
  assert.deepEqual(validTeamDraft(['a'],{...view,permissions:{canPropose:false}}),[]);
});
test('team draft is invalidated by new proposal, quest, match, room, player or permission',()=>{
  const context=teamDraftContext(view,'ABCD');
  for(const prop of ['selfId','matchNumber','questIndex','proposalNumber','leaderId'])assert.notEqual(teamDraftContext({...view,[prop]:'changed'},'ABCD'),context);
  assert.notEqual(teamDraftContext(view,'EFGH'),context);
  assert.equal(teamDraftContext({...view,phase:'teamVote'},'ABCD'),null);
  assert.equal(teamDraftContext({...view,permissions:{canPropose:false}},'ABCD'),null);
});
