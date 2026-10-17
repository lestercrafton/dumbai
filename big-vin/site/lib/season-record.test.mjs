import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeSavedSeason,validSeason} from './season-record.mjs';

const game=(id,season,startTime,edge=10,actualMargin=7,extra={})=>({id,sport:'nfl',cohort:'live',modelVersion:'ridge-v1',season,startTime,weekKey:'same-ranking-window',predictedMargin:3+edge,marketHomeSpread:-3,side:'home',
 result:{status:'completed',actualMargin,outcome:actualMargin>3?'win':actualMargin<3?'loss':'push',pnl:actualMargin>3?100/110:actualMargin<3?-1:0},...extra});

test('validSeason requires an explicit positive integer identity',()=>{
 for(const value of [2026,'2026',' 2026 '])assert.equal(validSeason(value),2026);
 for(const value of [null,undefined,'',' ',0,-2026,2026.5,Infinity,NaN,true,{},[], '2026-W01','2.026e3','2026.5'])assert.equal(validSeason(value),null);
});

test('provider seasons span calendar years without importing the prior season',()=>{
 const records=[game('october',2027,'2026-10-20T23:00:00Z'),game('january',2027,'2027-01-03T01:00:00Z',8,0),game('old-season',2026,'2026-06-01T23:00:00Z')];
 const result=summarizeSavedSeason(records,2027);
 assert.equal(result.season,2027);assert.equal(result.overall.recorded,2);assert.equal(result.overall.wins,1);assert.equal(result.overall.losses,1);assert.equal(result.overall.winRate,0.5);
 assert.deepEqual(result.coverage,{saved:2,seasonUnknownCount:0,firstDate:'2026-10-20',lastDate:'2027-01-02',complete:false});
});

test('season filters preserve Top N membership from the entire original ranking period',()=>{
 const records=[game('other-season-top',2026,'2026-10-17T18:00:00Z',20),...Array.from({length:10},(_,i)=>game('current-'+i,2027,'2026-10-17T18:00:00Z',10-i))];
 const result=summarizeSavedSeason(records,2027,{rankPeriod:'week',rankAnchor:'2026-10-17'});
 assert.equal(result.overall.recorded,10);
 assert.equal(result.rankedCards['3'].overall.recorded,2);
 assert.equal(result.rankedCards['8'].overall.recorded,7);
 assert.equal(result.rankedCards['10'].overall.recorded,9);
 assert.equal(result.rankedCards['3'].coverage.saved,2);
});

test('missing season tags are excluded and disclosed within each original card scope',()=>{
 const records=[game('unknown-top',undefined,'2026-10-17T18:00:00Z',30),...Array.from({length:10},(_,i)=>game('known-'+i,2026,'2026-10-17T18:00:00Z',20-i)),game('unknown-low',null,'2026-10-17T18:00:00Z',1),game('invalid-no-line','unknown','2026-10-17T18:00:00Z',1,7,{marketHomeSpread:null})];
 const result=summarizeSavedSeason(records,2026);
 assert.equal(result.coverage.seasonUnknownCount,3);assert.equal(result.coverage.saved,10);
 assert.equal(result.rankedCards['3'].coverage.seasonUnknownCount,1);assert.equal(result.rankedCards['3'].coverage.saved,2);
 assert.equal(result.rankedCards['10'].coverage.seasonUnknownCount,1);assert.equal(result.rankedCards['10'].coverage.saved,9);
});

test('season summaries retain CFB ATS synthetic exclusions and push denominators',()=>{
 const when='2026-09-26T18:00:00Z';
 const reconstructed={sport:'cfb',origin:'cfb-reconstructed-2026-09-26',marketHomeSpread:null,side:null};
 const records=[game('saved-win',2026,when,10,7,{sport:'cfb'}),game('saved-loss',2026,when,9,0,{sport:'cfb'}),
  game('archived-push',2026,when,8,3,{...reconstructed,paperWager:{kind:'archived-opening-spread',side:'home',homeSpread:-3,odds:-110},result:{status:'completed',actualMargin:3,outcome:'no-line',pnl:null}}),
  game('synthetic',2026,when,7,28,{...reconstructed,paperWager:{kind:'synthetic-winner-even',side:'home',homeSpread:0,odds:100},result:{status:'completed',actualMargin:28,outcome:'no-line',pnl:null}}),
  game('pending',2026,when,6,7,{sport:'cfb',result:null}),game('void',2026,when,5,7,{sport:'cfb',result:{status:'void',outcome:'void'}})];
 const before=JSON.stringify(records),spread=summarizeSavedSeason(records,2026).spreadOverall;
 assert.equal(spread.wins,1);assert.equal(spread.losses,1);assert.equal(spread.pushes,1);assert.equal(spread.winRate,0.5);
 assert.equal(spread.syntheticGames,1);assert.equal(spread.unlined,1);assert.equal(spread.pending,1);assert.equal(spread.voids,1);assert.equal(spread.graded,3);
 assert.equal(JSON.stringify(records),before);
});

test('season profits sum only original full-card play contributions without replay or input mutation',()=>{
 const records=[game('current',2027,'2026-10-17T18:00:00Z'),game('current-loss',2027,'2026-10-18T18:00:00Z',9,0),game('prior',2026,'2026-10-17T18:00:00Z',8)];
 const bankroll={plays:{current:{profit:12.5,profitUnits:1.25,stake:15},'current-loss':{profit:-12.5,profitUnits:-1.25,stake:12.5},prior:{profit:200,profitUnits:20,stake:200}}};
 const before=JSON.stringify({records,bankroll});
 const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const nested of Object.values(value))freeze(nested);}return value;};
 freeze(records);freeze(bankroll);
 const result=summarizeSavedSeason(records,2027,{bankroll});
 assert.equal(result.overall.profit,0);assert.equal(result.overall.profitUnits,0);
 assert.equal(result.rankedCards['3'].overall.profit,0);assert.equal(JSON.stringify({records,bankroll}),before);
});

test('empty explicit seasons stay empty and invalid requests never guess a season',()=>{
 const records=[game('prior',2026,'2026-10-17T18:00:00Z'),game('unknown',null,'2026-10-17T18:00:00Z',9)];
 const result=summarizeSavedSeason(records,2027);
 assert.equal(result.overall.recorded,0);assert.equal(result.overall.winRate,null);assert.equal(result.overall.profit,null);assert.equal(result.spreadOverall.winRate,null);
 assert.deepEqual(result.coverage,{saved:0,seasonUnknownCount:1,firstDate:null,lastDate:null,complete:false});
 assert.equal(summarizeSavedSeason(records,null),null);assert.equal(summarizeSavedSeason(records,''),null);
});
