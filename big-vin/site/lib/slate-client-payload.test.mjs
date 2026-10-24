import test from 'node:test';
import assert from 'node:assert/strict';
import {slimSlateForClient,slimGame} from './slate-client-payload.mjs';

test('slate slim drops revision history but keeps the locked pick for Kelly',()=>{
 const fat={sport:'cfb',games:[{id:'1',side:'home',pickRevision:{side:'home',marketHomeSpread:-3},pickRevisions:[{id:'a'},{id:'b'},{id:'c'}],originalPick:{side:'away'},pickLock:{lockAt:'t'}}]};
 const slim=slimSlateForClient(fat);
 assert.equal(slim.games[0].pickRevisions.length,0);
 assert.equal(slim.games[0].pickRevisionCount,3);
 assert.deepEqual(slim.games[0].pickRevision,{side:'home',marketHomeSpread:-3});
 assert.equal(slim.games[0].originalPick.side,'away');
 assert.notEqual(slim.games,fat.games);
 assert.equal(JSON.stringify(slim).includes('"id":"a"'),false);
});

test('slim is a no-op on already-thin games',()=>{
 const g={id:'1',pickRevisions:[],pickRevisionCount:0};
 assert.equal(slimGame(g),g);
 assert.equal(slimSlateForClient({games:[g]}).games[0],g);
});
