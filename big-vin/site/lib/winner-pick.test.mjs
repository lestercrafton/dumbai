import test from 'node:test';import assert from 'node:assert/strict';
import {noLineWinnerPick} from './winner-pick.mjs';
test('model margin picks the winner and grades final',()=>{
 const p=noLineWinnerPick({status:'completed',completed:true,homeScore:80,awayScore:60},{predictedHomeMargin:12});
 assert.equal(p.side,'home');assert.equal(p.outcome,'win');assert.equal(p.staked,false);
});
test('no rating falls back to the D1 team',()=>{
 const p=noLineWinnerPick({status:'live',homeConference:null,awayConference:'Big Sky',liveHomeScore:10,liveAwayScore:20},null);
 assert.equal(p.side,'away');assert.equal(p.outcome,'pending');assert.equal(p.leading,true);
});
test('nothing to go on returns null',()=>assert.equal(noLineWinnerPick({},null),null));
