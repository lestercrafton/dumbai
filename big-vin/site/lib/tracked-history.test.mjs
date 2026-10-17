import test from 'node:test';
import assert from 'node:assert/strict';
import sep14 from './tuning-2026-09-14.json' with {type:'json'};
import oct16 from './tuning-2026-10-16.json' with {type:'json'};
import {historyModelForGame,selectTrackedHistory,summarizeTrackedHistory} from './tracked-history.mjs';
import {rankCardHistory} from './ranked-card-summary.mjs';

const registry=sport=>[sep14[sport],oct16[sport]].filter(Boolean);
const game=(id,{sport='cfb',version=sep14.cfb.id,date='2026-10-10',edge=10,margin=7,...extra}={})=>({
 id,gameId:id,sport,cohort:'live',origin:'collector',modelVersion:version,season:2026,week:6,
 startTime:date+'T18:00:00Z',capturedAt:date+'T12:00:00Z',marketObservedAt:date+'T11:59:00Z',weekKey:sport==='nfl'?'2026-W06':'2026-10-05',
 predictedMargin:3+edge,marketHomeSpread:-3,side:'home',odds:-110,
 result:{status:'completed',actualMargin:margin,outcome:margin>3?'win':margin<3?'loss':'push',pnl:margin>3?100/110:margin<3?-1:0},...extra});
const options={sport:'cfb',models:registry('cfb'),season:2026};
const selected=rows=>selectTrackedHistory(rows,options).records;
const ids=rows=>rows.map(row=>row.id).sort();

test('history spans real saved versions and a new model’s first final does not reset it',()=>{
 const rows=[game('old-win'),game('old-loss',{margin:0}),game('new-win',{version:oct16.cfb.id,date:'2026-10-17',weekKey:'2026-10-12'}),game('new-pending',{version:oct16.cfb.id,date:'2026-10-18',result:null,weekKey:'2026-10-12'}),
  game('benchmark-copy',{gameId:'old-win',version:'ridge-v1',margin:0}),game('retired-copy',{gameId:'new-win',version:sep14.cfb.id,date:'2026-10-17',margin:0})];
 const before=JSON.stringify(rows),result=summarizeTrackedHistory(rows,options);
 assert.equal(result.spreadOverall.wins,2);assert.equal(result.spreadOverall.losses,1);assert.equal(result.spreadOverall.pending,1);
 assert.equal(result.seasonRecord.spreadOverall.recorded,4);assert.equal(result.coverage.complete,false);
 assert.equal(result.policy.excluded['inactive-version'],2);assert.equal(JSON.stringify(rows),before);
 for(const record of selected(rows)){
  const original=rows.find(row=>row.id===record.id);
  assert.strictEqual(record.result,original.result);assert.equal(record.marketHomeSpread,original.marketHomeSpread);assert.equal(record.predictedMargin,original.predictedMargin);assert.equal(record.side,original.side);
 }
 assert.equal('bankroll' in result,false);assert.equal('profit' in result.overall,false);
});

test('activation respects NFL reporting week even after October 16 activation',()=>{
 const models=registry('nfl');
 assert.equal(historyModelForGame(game('week1',{sport:'nfl',date:'2026-09-14',week:1}),models).id,'ridge-v1');
 assert.equal(historyModelForGame(game('week2',{sport:'nfl',date:'2026-09-20',week:2}),models).id,sep14.nfl.id);
 assert.equal(historyModelForGame(game('week6',{sport:'nfl',date:'2026-10-18',week:6}),models).id,sep14.nfl.id);
 assert.equal(historyModelForGame(game('week7',{sport:'nfl',date:'2026-10-22',week:7}),models).id,oct16.nfl.id);
 const exactly=game('exact',{startTime:oct16.cfb.activatedAt});
 assert.equal(historyModelForGame(exactly,registry('cfb')).id,sep14.cfb.id);
 const week1=game('baseline',{sport:'nfl',version:'ridge-v1',date:'2026-09-13',week:1});
 assert.deepEqual(ids(selectTrackedHistory([week1],{sport:'nfl',models}).records),['baseline']);
});

test('missing or invalid active version never falls back to a winning benchmark or later formula',()=>{
 const rows=[game('benchmark',{version:'ridge-v1'}),game('future',{gameId:'benchmark',version:oct16.cfb.id}),
  game('late-active',{gameId:'benchmark',capturedAt:'2026-10-10T18:01:00Z'}),
  game('pre-activation',{gameId:'second',version:oct16.cfb.id,date:'2026-10-17',capturedAt:'2026-10-16T19:00:00Z'}),
  game('second-benchmark',{gameId:'second',date:'2026-10-17',version:'ridge-v1',capturedAt:'2026-10-16T18:00:00Z'})];
 const result=selectTrackedHistory(rows,options);
 assert.equal(result.records.length,0);assert.equal(result.policy.unavailableGames,2);
 assert.equal(result.policy.excluded['late-forecast'],1);assert.equal(result.policy.excluded['before-model-activation'],1);
});

test('non-live, reconstruction, recovered provenance and late or unverified captures are excluded',()=>{
 const invalid=[game('recovered',{cohort:'recovered'}),game('retro',{cohort:'retrospective'}),game('recon',{origin:'cfb-reconstructed-2026-09-26',capturedAt:'2026-10-10T11:00:00Z'}),
  game('disguised',{recoveredAt:'2026-10-11T12:00:00Z'}),game('unknown-origin',{origin:'unverified-import'}),
  game('late',{capturedAt:'2026-10-10T18:00:00Z'}),game('late-forecasted',{forecastedAt:'2026-10-10T19:00:00Z'}),
  game('no-capture',{capturedAt:null}),game('no-date',{startTime:'invalid'}),game('no-forecast',{predictedMargin:null}),
  game('late-market',{marketObservedAt:'2026-10-10T18:00:00Z'}),game('missing-market-time',{marketObservedAt:null}),
  game('late-first-market',{firstMarket:{recordedAt:'2026-10-10T18:01:00Z'}}),game('early-reschedule',{firstMarket:{startTime:'2026-10-10T11:00:00Z',recordedAt:'2026-10-10T10:00:00Z'}}),
  game('no-game-id',{gameId:null})];
 const genuine=[game('archived',{origin:'local-pregame-archive'}),game('unlined',{marketHomeSpread:null,side:null,marketObservedAt:null})];
 const result=selectTrackedHistory([...invalid,...genuine],options);
 assert.deepEqual(ids(result.records),['archived','unlined']);assert.equal(result.policy.excludedCount,invalid.length);
});

test('duplicate ownership is earliest capture then forecast ID, never outcome or array order',()=>{
 const rows=[game('early-loss',{gameId:'same',capturedAt:'2026-10-10T09:00:00Z',margin:0}),game('later-win',{gameId:'same',capturedAt:'2026-10-10T10:00:00Z'}),
  game('z-winner',{gameId:'tied'}),game('a-pending',{gameId:'tied',result:null})];
 const first=selectTrackedHistory(rows,options),reversed=selectTrackedHistory([...rows].reverse(),options);
 assert.deepEqual(ids(first.records),['a-pending','early-loss']);assert.deepEqual(ids(reversed.records),ids(first.records));
 assert.equal(first.policy.excluded['duplicate-game'],2);
 const changed=rows.map(row=>({...row,result:{status:'completed',actualMargin:100,outcome:'win',pnl:1000}}));
 assert.deepEqual(ids(selected(changed)),ids(first.records));
 assert.deepEqual(selected(changed).map(row=>[row.id,row.cardRank]),first.records.map(row=>[row.id,row.cardRank]));
});

test('ranks are assigned before missing version, provenance and duplicate exclusions with no promotion',()=>{
 const rows=[game('excluded-reconstruction',{edge:100,origin:'cfb-reconstructed-2026-09-26'}),game('duplicate-later',{edge:90,gameId:'same',capturedAt:'2026-10-10T13:00:00Z'}),
  game('kept',{edge:80,gameId:'same'}),game('fourth',{edge:70}),game('fifth',{edge:60})];
 const expected=new Map(rankCardHistory(rows).map(row=>[row.id,row.cardRank]));
 const result=summarizeTrackedHistory(rows,options);
 assert.equal(result.rankedCards['3'].overall.recorded,1);
 assert.deepEqual(result.records.map(row=>[row.id,row.cardRank]),[['fifth',5],['fourth',4],['kept',3]]);
 for(const row of result.records)assert.equal(row.cardRank,expected.get(row.id));
 assert.equal(result.seasonRecord.rankedCards['3'].coverage.saved,1);
});

test('rank formula scopes separately so parallel benchmark records cannot displace active Top N',()=>{
 const rows=[...Array.from({length:5},(_,i)=>game('active'+i,{edge:5-i})),...Array.from({length:5},(_,i)=>game('base'+i,{gameId:'active'+i,version:'ridge-v1',edge:100-i}))];
 const result=summarizeTrackedHistory(rows,options);
 assert.equal(result.rankedCards['3'].overall.recorded,3);assert.equal(result.overall.recorded,5);
 assert.deepEqual(result.records.filter(row=>row.cardRank<=3).map(row=>row.id),['active0','active1','active2']);
});

test('season filters use provider identity, preserve unknown disclosures and rank gaps',()=>{
 const rows=[game('old-top',{season:2025,edge:40}),game('unknown-top',{season:null,edge:30}),game('current-third',{edge:20}),game('current-fourth',{edge:10})];
 const result=summarizeTrackedHistory(rows,options);
 assert.equal(result.overall.recorded,4);assert.equal(result.seasonRecord.overall.recorded,2);
 assert.equal(result.seasonRecord.rankedCards['3'].overall.recorded,1);assert.equal(result.seasonRecord.coverage.seasonUnknownCount,1);
 assert.equal(result.seasonRecord.rankedCards['3'].coverage.seasonUnknownCount,1);
 assert.equal(result.seasonRecord.days[0].recorded,2);assert.equal(result.seasonRecord.spreadWeeks[0].recorded,2);
 const other=summarizeTrackedHistory(rows,{...options,season:2027});assert.equal(other.seasonRecord.overall.recorded,0);assert.equal(other.seasonRecord.coverage.firstDate,null);
 const nba=[game('oct',{sport:'nba',version:'ridge-v1',season:2027,date:'2026-10-20'}),game('jan',{sport:'nba',version:'ridge-v1',season:2027,date:'2027-01-20'})];
 assert.equal(summarizeTrackedHistory(nba,{sport:'nba',season:2027}).seasonRecord.overall.recorded,2);
});

test('daily and weekly summaries reconcile and push, void, pending and unlined have correct denominators',()=>{
 const rows=[game('win'),game('loss',{margin:0}),game('push',{margin:3}),game('pending',{result:null}),game('void',{result:{status:'void',outcome:'void'}}),game('unlined',{marketHomeSpread:null,side:null,result:{status:'completed',actualMargin:7,outcome:'no-line',pnl:null}})];
 const result=summarizeTrackedHistory(rows,options),spread=result.spreadOverall;
 assert.equal(spread.wins,1);assert.equal(spread.losses,1);assert.equal(spread.pushes,1);assert.equal(spread.pending,1);assert.equal(spread.voids,1);assert.equal(spread.unlined,1);assert.equal(spread.winRate,0.5);
 for(const key of ['recorded','wins','losses','pushes','pending','voids','unlined']){
  assert.equal(result.spreadDays.reduce((n,row)=>n+row[key],0),spread[key]);assert.equal(result.spreadWeeks.reduce((n,row)=>n+row[key],0),spread[key]);
 }
});

test('rescheduled settlement uses played day without changing rank or model ownership',()=>{
 const rows=[game('moved',{sport:'mlb',version:sep14.mlb.id,date:'2026-10-15',edge:20,result:{status:'completed',actualMargin:7,outcome:'win',playedAt:'2026-10-17T18:00:00Z'}}),...Array.from({length:4},(_,i)=>game('today'+i,{sport:'mlb',version:sep14.mlb.id,date:'2026-10-17',edge:10-i}))];
 const result=summarizeTrackedHistory(rows,{sport:'mlb',models:registry('mlb'),rankPeriod:'day'});
 assert.equal(result.rankedCards['3'].spreadDays[0].date,'2026-10-17');assert.equal(result.rankedCards['3'].spreadDays[0].recorded,4);
 assert.equal(result.records.find(row=>row.id==='moved').cardRank,1);
});

test('exact requested week stays empty rather than silently returning another card',()=>{
 const result=summarizeTrackedHistory([game('saved')],{...options,week:'2026-09-21'});
 assert.equal(result.selectedWeek,'2026-09-21');assert.equal(result.records.length,0);assert.equal(result.summary.recorded,0);assert.equal(result.seasonRecord.summary.recorded,0);
 assert.equal(result.overall.recorded,1);
});

test('historyDate selects the same Monday–Sunday settlement period across NFL reporting weeks',()=>{
 const rows=[game('monday',{sport:'nfl',version:sep14.nfl.id,date:'2026-10-12',week:5,weekKey:'2026-W05'}),
  game('sunday',{sport:'nfl',version:sep14.nfl.id,date:'2026-10-18',week:6,weekKey:'2026-W06',margin:0}),
  game('next-monday',{sport:'nfl',version:sep14.nfl.id,date:'2026-10-19',week:6,weekKey:'2026-W06'}),
  game('played-wednesday',{sport:'nfl',version:sep14.nfl.id,date:'2026-10-08',week:5,weekKey:'2026-W05',result:{status:'completed',actualMargin:3,outcome:'push',playedAt:'2026-10-15T01:00:00Z'}})];
 const result=summarizeTrackedHistory(rows,{sport:'nfl',models:registry('nfl'),season:2026,historyDate:'2026-10-17'});
 assert.deepEqual(result.selectedPeriod,{start:'2026-10-12',end:'2026-10-18'});
 assert.deepEqual(ids(result.records),['monday','played-wednesday','sunday']);
 assert.equal(result.summary.recorded,3);assert.equal(result.spreadRecord.wins,1);assert.equal(result.spreadRecord.losses,1);assert.equal(result.spreadRecord.pushes,1);
 assert.equal(result.seasonRecord.summary.recorded,3);assert.equal(result.seasonRecord.rankedCards['3'].summary.recorded,3);
 assert.equal(result.overall.recorded,4);assert.equal(result.weeks.length,2);
 const leagueWeek=summarizeTrackedHistory(rows,{sport:'nfl',models:registry('nfl'),week:'2026-W06'});
 assert.equal(leagueWeek.selectedPeriod,null);assert.deepEqual(ids(leagueWeek.records),['next-monday','sunday']);
});

test('conflicting saved schedules are disclosed and earliest capture metadata remains decisive',()=>{
 const rows=[game('before-update',{gameId:'same',date:'2026-10-16',capturedAt:'2026-10-15T12:00:00Z',marketObservedAt:'2026-10-15T11:00:00Z'}),
  game('after-update',{gameId:'same',date:'2026-10-17',version:oct16.cfb.id})];
 const result=selectTrackedHistory(rows,options);
 assert.deepEqual(ids(result.records),['before-update']);assert.equal(result.policy.metadataConflictGames,1);
 assert.deepEqual(ids(selected([...rows].reverse())),['before-update']);
});

test('empty history is explicit and never fabricates a full season',()=>{
 const result=summarizeTrackedHistory([],{sport:'cbb',season:2027});
 assert.equal(result.overall.recorded,0);assert.equal(result.spreadOverall.winRate,null);assert.equal(result.seasonRecord.coverage.complete,false);
 assert.equal(result.coverage.firstDate,null);assert.equal(result.selectedWeek,null);assert.deepEqual(result.records,[]);
});
