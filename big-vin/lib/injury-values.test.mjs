import test from 'node:test';
import assert from 'node:assert/strict';
import {qbEpa,qbPoints,teamLoss,homeDelta,statusWeight,QB} from './injury-values.mjs';
import {evaluateTeam,parseDepth} from '../scripts/injury-lines.mjs';
import {gameInjury,marketCheck,liveMargin} from '../site/lib/injury-lines.mjs';
import {predict} from './playbook.mjs';

const weeks=(n,epa,season=2026)=>Array.from({length:n},(_,i)=>({season,week:i+1,team:'T',plays:36,epa:epa*36}));
test('status weights: out-type full, questionable partial, active none',()=>{
 for(const s of ['Out','Injured Reserve','Doubtful','Suspension'])assert.equal(statusWeight(s),1);
 assert.equal(statusWeight('Questionable'),0.25);assert.equal(statusWeight('Active'),0);assert.equal(statusWeight(null),0);
});
test('elite starter vs thin backup is worth several points; shrinkage pulls small samples toward the prior',()=>{
 const elite=qbEpa(weeks(17,0.2,2025).concat(weeks(6,0.2)),{season:2026,prior:QB.starterPriorEpa});
 const backup=qbEpa(weeks(1,0.3),{season:2026,prior:QB.replacementEpa});
 assert.ok(backup.shrunk<0.05,'one hot game does not make a backup good');
 const v=qbPoints({starter:elite,backup,teamGames:6,starterGames:6});
 assert.ok(v.points>=5&&v.points<=QB.maxPoints,JSON.stringify(v));
 // A starter who already missed games is partly in the ratings.
 assert.ok(qbPoints({starter:elite,backup,teamGames:6,starterGames:3}).points<v.points);
 // Even a backup as good as the starter costs the floor, never a gain.
 assert.equal(qbPoints({starter:backup,backup:elite,teamGames:6,starterGames:6}).fullPoints,QB.minPoints);
});
test('non-QB losses are capped together; QB is not',()=>{
 const items=[{group:'qb',points:6},...Array.from({length:10},()=>({group:'cb',points:0.5}))];
 assert.equal(teamLoss(items),9);assert.equal(homeDelta(2,5),3);
});
test('team evaluation: injured season starter replaced by the next healthy depth-chart QB',()=>{
 const depth=parseDepth({items:[{positions:{qb:{athletes:[{rank:1,athlete:{$ref:'x/athletes/20?'}},{rank:2,athlete:{$ref:'x/athletes/10?'}}]},lt:{athletes:[{rank:1,athlete:{$ref:'x/athletes/30?'}}]}}}]});
 assert.deepEqual(depth.qb,['20','10']);
 const p=(id,name,pos,games,extra={})=>({id,name,position:pos,games:new Set(games),weeks:[],targets:0,carries:0,qbPlays:0,...extra});
 const teamUse={games:new Set(['2026:1','2026:2','2026:3']),players:{S:p('S','Star','QB',['2026:1','2026:2','2026:3'],{qbPlays:108}),B:p('B','Backup','QB',[])}};
 const injuries=new Map([['10',{status:'Out',reported:'2026-10-20'}],['30',{status:'Out',name:'Tackle',reported:'2026-10-20'}]]);
 const r=evaluateTeam({abbr:'T',depth,injuries,teamUse,season:2026,allQbRows:new Map([['S',weeks(20,0.15)]]),espnToGsis:new Map([['10','S'],['20','B']]),gsisToEspn:new Map([['S','10'],['B','20']]),names:new Map([['B','Backup']])});
 const qb=r.items.find(i=>i.group==='qb');assert.equal(qb.player,'Star');assert.equal(qb.replacement,'Backup');assert.ok(qb.points>3);
 assert.ok(r.items.some(i=>i.group==='lt'&&i.points===0.6));
 // Healthy starter: nothing.
 assert.equal(evaluateTeam({abbr:'T',depth,injuries:new Map(),teamUse,season:2026,allQbRows:new Map(),espnToGsis:new Map(),gsisToEspn:new Map([['S','10']])}).loss,0);
});
test('Hurts-style case: home starter out moves the line toward the away team',()=>{
 const table={generatedAt:'2026-10-20T20:00:00Z',teams:{PHI:{loss:3.9,items:[{player:'Jalen Hurts',position:'QB',status:'Injured Reserve',points:3.7,replacement:'Tanner McKee'}]},DAL:{loss:0.3,items:[]}}};
 const inj=gameInjury(table,'nfl','PHI','DAL',Date.parse('2026-10-21T00:00:00Z'));
 assert.equal(inj.homeDelta,-3.6);
 assert.equal(gameInjury(table,'nfl','PHI','DAL',Date.parse('2026-10-25T00:00:00Z')),null,'stale tables are ignored');
 assert.equal(gameInjury(table,'nba','PHI','DAL',Date.parse('2026-10-21T00:00:00Z')),null);
 const live=liveMargin({sport:'nfl',baseMargin:6,homeSpread:-2.5,injury:inj});
 assert.equal(live.margin,2.4);assert.equal(live.marketCheck,null);
});
test('market gap: unexplained 4+ point NFL gaps are halved and marked; injury-explained gaps stand',()=>{
 const un=marketCheck({sport:'nfl',margin:8,homeSpread:-2});
 assert.equal(un.check.review,true);assert.equal(un.margin,5);
 const ex=marketCheck({sport:'nfl',margin:-4,homeSpread:-2,injuryDelta:-4});
 assert.equal(ex.check.review,false);assert.equal(ex.margin,-4);
 assert.equal(marketCheck({sport:'nfl',margin:3.5,homeSpread:0}).check,null);
 assert.equal(marketCheck({sport:'cfb',margin:10,homeSpread:-4}).check,null,'CFB threshold is 7');
 assert.equal(marketCheck({sport:'nba',margin:20,homeSpread:0}).check,null);
 // No injury, no gap: the margin is passed through exactly.
 assert.equal(liveMargin({sport:'nfl',baseMargin:1.23456,homeSpread:-1,injury:null}).margin,1.23456);
});
test('new challengers: injury values, gap guard and market blend',()=>{
 const base={version:'x',predictedMargin:6},market={homeSpread:-2},injury={homeDelta:-3.6,home:{items:[{player:'Jalen Hurts',points:3.7}]},away:{items:[]},tableAt:'t'};
 const v=(feature,parameters={})=>({role:'challenger',feature,parameters});
 assert.equal(predict(v('injury-values'),{base,market,injury}).predictedMargin,2.4);
 assert.equal(predict(v('market-blend',{marketWeight:0.5}),{base,market}).predictedMargin,4);
 assert.equal(predict(v('injury-gap-guard',{sport:'nfl'}),{base:{...base,predictedMargin:9},market,injury:null}).predictedMargin,5.5);
});
