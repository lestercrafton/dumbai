import test from 'node:test';import assert from 'node:assert/strict';
import {kellyStake,replayKellyBankroll} from './kelly-bankroll.mjs';
test('kelly stake is zero without an edge and full Kelly otherwise',()=>{
 assert.equal(kellyStake(0.5,-110),0);
 assert.ok(Math.abs(kellyStake(0.6,100)-0.2)<1e-12);
 assert.equal(replayKellyBankroll([]).kelly.bankroll,1_000_000);
});
