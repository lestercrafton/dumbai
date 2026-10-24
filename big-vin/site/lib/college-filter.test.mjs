import test from 'node:test';
import assert from 'node:assert/strict';
import {filterCollege,rankWithinCollegeFilter,espnCollegeGroup,collegeFiltersFor,COLLEGE_FILTERS} from './college-filter.mjs';

const games=[
 {id:'a',sport:'cfb',rank:1,homeApRank:5,homeConference:'SEC',awayConference:'Sun Belt',home:{name:'Texas A&M'},away:{name:'X'},sourceUrl:'https://site.api.espn.com/scoreboard?groups=80'},
 {id:'b',sport:'cfb',rank:4,homeConference:'Sun Belt',awayConference:'Sun Belt',home:{name:'App State'},away:{name:'James Madison'},sourceUrl:'https://site.api.espn.com/scoreboard?groups=80'},
 {id:'c',sport:'cfb',rank:2,homeConference:'Independent',awayConference:'ACC',home:{name:'Notre Dame Fighting Irish'},away:{name:'Y'},sourceUrl:'https://site.api.espn.com/scoreboard?groups=80'},
 {id:'d',sport:'cfb',rank:3,homeConference:'Independent',awayConference:'Conference USA',home:{name:'UConn'},away:{name:'Liberty'},sourceUrl:'https://site.api.espn.com/scoreboard?groups=80'},
 {id:'e',sport:'cfb',rank:5,homeConference:null,awayConference:null,home:{name:'Montana State'},away:{name:'Weber State'},sourceUrl:'https://site.api.espn.com/scoreboard?groups=81'},
 {id:'f',sport:'cfb',rank:null,home:{name:'FCS unranked'},away:{name:'Z'},sourceUrl:'https://site.api.espn.com/scoreboard?groups=81'},
];

test('espnCollegeGroup reads groups=80/81 from sourceUrl',()=>{
 assert.equal(espnCollegeGroup(games[0]),'80');
 assert.equal(espnCollegeGroup(games[4]),'81');
 assert.equal(espnCollegeGroup({sourceGroup:80}),'80');
 assert.equal(espnCollegeGroup({}),null);
});

test('filterCollege all / top25 / major (power)',()=>{
 assert.deepEqual(filterCollege(games,'all').map(g=>g.id),['a','b','c','d','e','f']);
 assert.deepEqual(filterCollege(games,'top25').map(g=>g.id),['a']);
 assert.deepEqual(filterCollege(games,'major').map(g=>g.id),['a','c']);
});

test('filterCollege separates ESPN FBS and FCS',()=>{
 assert.deepEqual(filterCollege(games,'fbs').map(g=>g.id),['a','b','c','d']);
 assert.deepEqual(filterCollege(games,'fcs').map(g=>g.id),['e','f']);
});

test('pro games always pass college filters',()=>{
 const rows=[{id:'nfl',sport:'nfl',rank:1},{id:'cfb',sport:'cfb',rank:2,sourceUrl:'?groups=81'}];
 assert.deepEqual(filterCollege(rows,'fbs').map(g=>g.id),['nfl']);
 assert.deepEqual(filterCollege(rows,'top25').map(g=>g.id),['nfl']);
});

test('rankWithinCollegeFilter renumbers inside FBS and leaves All alone',()=>{
 const all=rankWithinCollegeFilter(games,'all');
 assert.deepEqual(all.map(g=>g.rank),[1,4,2,3,5,null]);
 const fbs=rankWithinCollegeFilter(games,'fbs');
 assert.deepEqual(fbs.map(g=>({id:g.id,rank:g.rank,board:g.boardRank})),[
  {id:'a',rank:1,board:1},{id:'b',rank:4,board:4},{id:'c',rank:2,board:2},{id:'d',rank:3,board:3},
 ]);
 const fcs=rankWithinCollegeFilter(games,'fcs');
 assert.equal(fcs.find(g=>g.id==='e').rank,1);
 assert.equal(fcs.find(g=>g.id==='e').boardRank,5);
 assert.equal(fcs.find(g=>g.id==='f').rank,null);
});

test('collegeFiltersFor hides FBS/FCS on CBB',()=>{
 assert.deepEqual(Object.keys(collegeFiltersFor('cbb')),['all','top25','major']);
 assert.deepEqual(Object.keys(collegeFiltersFor('cfb')),Object.keys(COLLEGE_FILTERS));
 assert.ok(COLLEGE_FILTERS.major==='Power conferences');
 assert.ok(COLLEGE_FILTERS.all==='All college');
});
