// Guards the live cover boxes (green "Covering by X" / yellow "Needs X to cover").
// These must keep working for every sport through the cached-slate overlay.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mergeLiveScores,hasActiveGames} from './live-overlay.mjs';
import {liveScoreUrls} from './live-scores.mjs';
import {livePickStatus,liveTotalStatus,coverToOutcome,provisionalFinalLabel} from './live-pick-status.mjs';

const now=Date.parse('2026-10-24T02:00:00Z');
const stale='2026-10-24T00:30:00Z',fresh='2026-10-24T01:59:30Z';
const base=(sport,extra={})=>({id:`${sport}1`,sport,status:'live',startTime:'2026-10-24T00:30:00Z',retrievedAt:stale,scoreObservedAt:stale,
 home:{name:'Home',abbreviation:'H'},away:{name:'Away',abbreviation:'A'},liveHomeScore:0,liveAwayScore:0,...extra});
const SPORTS={
 cfb:{side:'home',marketHomeSpread:-6.5,predictedMargin:10,edge:3.5},
 fcs:{sport:'cfb',side:'away',marketHomeSpread:-3.5,predictedMargin:-1,edge:2.5},
 nfl:{side:'home',marketHomeSpread:-3,predictedMargin:5,edge:2},
 nhl:{side:'away',marketHomeSpread:-1.5,predictedMargin:-0.2,edge:1.3},
 mlb:{side:'home',marketHomeSpread:0,predictedMargin:0.8,edge:0.8},
};
const overlay=(sport,cfg,home,away,status='live')=>{
 const g=base(cfg.sport??sport,{...cfg,id:`${sport}1`});
 assert.ok(hasActiveGames([g],now));
 const [m]=mergeLiveScores([g],[{id:g.id,status,scoreObservedAt:fresh,liveHomeScore:home,liveAwayScore:away,homeScore:home,awayScore:away,period:2}]);
 return m;
};

for(const [sport,cfg] of Object.entries(SPORTS)){
 const line=cfg.side==='home'?cfg.marketHomeSpread:-cfg.marketHomeSpread;
 // Pick side margin needed to just cover vs fall 2 short.
 const cover=Math.ceil(-line+0.01), short=cover-2;
 const scores=d=>cfg.side==='home'?[20+d,20]:[20,20+d];
 test(`${sport}: live covering shows a green box with "Covering by"/"Winning by"`,()=>{
  const g=overlay(sport,cfg,...scores(cover));
  assert.equal(g.scoreObservedAt,fresh,'overlay must refresh the stale cached score');
  const s=livePickStatus(g,{now});
  assert.equal(s.provisional,true,s.reason);assert.equal(s.state,'covering');
  assert.match(s.label,cfg.marketHomeSpread===0&&sport==='mlb'?/^Winning by /:/^Covering by /);
 });
 test(`${sport}: live not covering shows a yellow box with "Needs X"`,()=>{
  const s=livePickStatus(overlay(sport,cfg,...scores(short)),{now});
  assert.equal(s.provisional,true,s.reason);assert.equal(s.state,'not-covering');
  assert.match(s.label,sport==='mlb'?/^Needs \d+ to win$/:/^Needs [\d.]+ to Cover$/);
 });
 test(`${sport}: just-finished game keeps a provisional cover until graded`,()=>{
  const g=overlay(sport,cfg,...scores(cover),'completed');
  assert.equal(g.finalPendingGrade,true);assert.equal(g.statusDescription,'Final');
  const s=livePickStatus(g,{now});assert.equal(s.provisional,true,s.reason);assert.equal(s.state,'covering');
 });
}

test('FINAL clock switches cover state to Big Vin Wins / Learn / Win-Loss-Push',()=>{
 assert.equal(coverToOutcome('covering'),'win');
 assert.equal(coverToOutcome('not-covering'),'loss');
 assert.equal(coverToOutcome('push'),'push');
 assert.equal(provisionalFinalLabel('covering'),'Big Vin Wins.');
 assert.equal(provisionalFinalLabel('not-covering'),'Learn');
 assert.equal(provisionalFinalLabel('push'),'Push');
 assert.equal(provisionalFinalLabel('covering',{short:true}),'Win');
 assert.equal(provisionalFinalLabel('not-covering',{short:true}),'Loss');
 const tsx=readFileSync(new URL('../components/big-vin-experience.tsx',import.meta.url),'utf8');
 assert.ok(tsx.includes('provisionalOutcome')&&tsx.includes('provisionalFinalLabel'),'card must switch to the graded final block on FINAL');
 assert.ok(!tsx.includes("game.finalPendingGrade?'FINAL':'LIVE'"),'live boxes must not keep Covering by on FINAL');
 const today=readFileSync(new URL('./today-plays.mjs',import.meta.url),'utf8');
 assert.ok(today.includes("provisionalFinalLabel(s.state,{short:true})"),"Today's plays must show Win/Loss/Push on FINAL");
});


test('total box: over/under covering and not covering',()=>{
 const g=overlay('cfb',{...SPORTS.cfb,overUnder:{side:'under',marketTotal:45.5}},20,17);
 const t=liveTotalStatus(g,{now});assert.equal(t.provisional,true);assert.equal(t.state,'covering');assert.match(t.label,/^Under by /);
 const o=liveTotalStatus(overlay('nfl',{...SPORTS.nfl,overUnder:{side:'over',marketTotal:45.5}},20,17),{now});
 assert.equal(o.provisional,true);assert.equal(o.state,'not-covering');
});

test('stale cached score without overlay does not fake a status',()=>{
 assert.equal(livePickStatus(base('cfb',{...SPORTS.cfb,liveHomeScore:30,liveAwayScore:3}),{now}).provisional,false);
});

test('live score URLs never ask ESPN for a same-day range (it returns 400)',()=>{
 for(const sport of ['cfb','nfl','nba','wnba','cbb','nhl','mlb']){
  for(const u of liveScoreUrls(sport,'2026-10-23','2026-10-23')){
   assert.equal(new URL(u).searchParams.get('dates'),'20261023',u);
  }
 }
 assert.equal(liveScoreUrls('cfb','2026-10-23','2026-10-25').length,6);
});

test('card markup and styles keep the green/yellow cover boxes',()=>{
 const tsx=readFileSync(new URL('../components/big-vin-experience.tsx',import.meta.url),'utf8');
 const css=readFileSync(new URL('../app/big-vin.css',import.meta.url),'utf8');
 for(const needle of ['vin-live-split','vin-live-box-${livePick.state}','vin-live-box-${liveTotal.state}','vin-game-covering','vin-game-not-covering','vin-scoreboard-covering','livePickStatus','liveTotalStatus'])
  assert.ok(tsx.includes(needle),`card lost ${needle}`);
 for(const rule of ['.vin-live-box-covering{','.vin-live-box-not-covering{','.vin-game-card.vin-game-covering','.vin-game-card.vin-game-not-covering','.vin-scoreboard-covering{'])
  assert.ok(css.includes(rule),`styles lost ${rule}`);
 assert.match(css,/\.vin-live-split\{display:grid;grid-template-columns:1fr 1fr/);
 const client=readFileSync(new URL('./board-client.ts',import.meta.url),'utf8');
 assert.ok(client.includes('mergeLiveScores')&&client.includes('/api/live-scores'),'board overlay removed');
});
