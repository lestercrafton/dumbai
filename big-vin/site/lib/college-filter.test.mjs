import test from 'node:test';import assert from 'node:assert/strict';
import {filterCollege} from './college-filter.mjs';
const games=[{id:'a',homeApRank:5,homeConference:'SEC',awayConference:'Sun Belt',home:{name:'Texas A&M'},away:{name:'X'}},
 {id:'b',homeConference:'Sun Belt',awayConference:'Sun Belt',home:{name:'App State'},away:{name:'James Madison'}},
 {id:'c',homeConference:'Independent',awayConference:'ACC',home:{name:'Notre Dame Fighting Irish'},away:{name:'Y'}},
 {id:'d',homeConference:'Independent',awayConference:'Conference USA',home:{name:'UConn'},away:{name:'Liberty'}}];
test('college filters hide cards only',()=>{
 assert.deepEqual(filterCollege(games,'all').map(g=>g.id),['a','b','c','d']);
 assert.deepEqual(filterCollege(games,'top25').map(g=>g.id),['a']);
 assert.deepEqual(filterCollege(games,'major').map(g=>g.id),['a','c']);
});
