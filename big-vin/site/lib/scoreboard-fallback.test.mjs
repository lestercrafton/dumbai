import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchScoreboard,normalizeScoreboard,scoreboardUrl,scoreboardPayloadLimited} from './feeds/adapter.mjs';

const event=id=>({id:String(id),date:'2026-09-26T17:00:00Z',season:{year:2026,type:2},competitions:[{status:{type:{state:'pre',completed:false}},competitors:[{homeAway:'home',team:{id:String(id)+'h',abbreviation:'HOME',displayName:'Home'}},{homeAway:'away',team:{id:String(id)+'a',abbreviation:'AWAY',displayName:'Away'}}]}]});

test('college live board recovers a failed range with supported limits and no false partial flag',async()=>{
 const urls=[];
 const fetchImpl=async url=>{
  urls.push(url);
  const query=new URL(url).searchParams;
  if(query.get('dates').includes('-'))return {ok:false,status:400};
  return {ok:true,json:async()=>({events:[event(query.get('groups')==='80'?1:2)]})};
 };
 const board=await fetchScoreboard('cfb',{startDate:'2026-09-26',endDate:'2026-09-26'},fetchImpl);
 assert.equal(urls.length,4);
 assert.equal(board.games.length,2);
 assert.equal(board.partialLiveCoverage,false);
 assert.ok(urls.every(url=>new URL(url).searchParams.get('limit')==='200'));
 assert.ok(!board.warnings.some(w=>w.includes('capped at 25')));
 assert.ok(board.sourceUrls.every(url=>new URL(url).searchParams.get('dates')==='20260926'));
});

test('NFL week recovers a failed range with seven daily checks including Monday',async()=>{
 const urls=[];
 const fetchImpl=async url=>{urls.push(url);const date=new URL(url).searchParams.get('dates');if(date.includes('-'))return {ok:false,status:400};return {ok:true,json:async()=>({events:date==='20261005'?[{...event(5),date:'2026-10-06T00:15:00Z'}]:date==='20261004'?[{...event(4),date:'2026-10-04T17:00:00Z'}]:[]})};};
 const board=await fetchScoreboard('nfl',{startDate:'2026-09-29',endDate:'2026-10-05'},fetchImpl);
 assert.equal(urls.length,8);assert.equal(board.games.length,2);assert.equal(board.partialLiveCoverage,false);assert.equal(board.sourceUrls.length,7);assert.ok(board.sourceUrls.some(url=>new URL(url).searchParams.get('dates')==='20261005'));assert.ok(!board.warnings.some(w=>w.includes('capped at 25')));
});

test('NFL daily fallback discloses failed dates and refuses windows beyond a week',async()=>{
 const fetchImpl=async url=>{const date=new URL(url).searchParams.get('dates');if(date.includes('-')||date==='20261005')return {ok:false,status:400};return {ok:true,json:async()=>({events:[]})};};
 const board=await fetchScoreboard('nfl',{startDate:'2026-09-29',endDate:'2026-10-05'},fetchImpl);assert.equal(board.partialLiveCoverage,true);assert.equal(board.sourceUrls.length,6);assert.ok(board.warnings.some(w=>w.includes('NFL single-date checks failed')));
 await assert.rejects(()=>fetchScoreboard('nfl',{startDate:'2026-09-29',endDate:'2026-10-06'},fetchImpl));
});

const progressGame=(sport,status,situation,competitionStatus)=>{
 const source=event('progress');
 source.status=status;
 source.competitions[0].status=competitionStatus??status;
 source.competitions[0].situation=situation;
 source.competitions[0].competitors[0].score='7';
 source.competitions[0].competitors[1].score='0';
 return normalizeScoreboard({events:[source]},sport).games[0];
};
const liveType={name:'STATUS_IN_PROGRESS',state:'in',completed:false,description:'In Progress'};

test('timed sports preserve observed display clock and period with event status precedence',()=>{
 for(const sport of ['nfl','cfb','nba','wnba','cbb','nhl']){
  const game=progressGame(sport,{displayClock:'1:42',period:4,type:{...liveType,detail:'1:42 - 4th Quarter',shortDetail:'1:42 - 4th'}},null,{displayClock:'9:00',period:1,type:liveType});
  assert.equal(game.clock,'1:42');assert.equal(game.period,4);assert.equal(game.statusName,'STATUS_IN_PROGRESS');
  assert.equal(game.statusDetail,'1:42 - 4th Quarter');assert.equal(game.statusShortDetail,'1:42 - 4th');assert.equal(game.statusDescription,'In Progress');
  assert.equal(game.status,'live');assert.equal(game.liveHomeScore,7);assert.equal(game.liveAwayScore,0);
  assert.equal(game.homeScore,null);assert.equal(game.homeMargin,null);assert.equal(game.outs,null);assert.equal(game.isTopInning,null);
 }
});

test('competition-only clocks and halftime or intermission phases remain provider observations',()=>{
 const intermission={displayClock:'0:00',period:2,type:{name:'STATUS_END_PERIOD',state:'in',completed:false,description:'End of Period',detail:'End of 2nd Period',shortDetail:'End of 2nd'}};
 const hockey=progressGame('nhl',undefined,null,intermission);
 assert.equal(hockey.period,2);assert.equal(hockey.clock,'0:00');assert.equal(hockey.statusName,'STATUS_END_PERIOD');assert.equal(hockey.statusDetail,'End of 2nd Period');assert.equal(hockey.status,'live');
 const halftime=progressGame('cfb',{displayClock:'0:00',period:2,type:{name:'STATUS_HALFTIME',state:'in',completed:false,description:'Halftime',detail:'Halftime',shortDetail:'Half'}});
 assert.equal(halftime.statusName,'STATUS_HALFTIME');assert.equal(halftime.statusDescription,'Halftime');assert.equal(halftime.clock,'0:00');assert.equal(halftime.statusDetail,'Halftime');
});

test('OT and final progress metadata never turns a completed game into a live result',()=>{
 const game=progressGame('nba',{displayClock:'5:00',period:5,type:{name:'STATUS_FINAL',state:'post',completed:true,description:'Final',detail:'Final/OT',shortDetail:'Final/OT'}});
 assert.equal(game.status,'completed');assert.equal(game.completed,true);assert.equal(game.statusDescription,'Final');assert.equal(game.statusDetail,'Final/OT');assert.equal(game.period,5);assert.equal(game.clock,'5:00');
 assert.equal(game.liveHomeScore,null);assert.equal(game.liveAwayScore,null);assert.equal(game.homeScore,7);assert.equal(game.awayScore,0);assert.equal(game.homeMargin,7);
});

test('baseball preserves inning detail, zero outs and explicit top or bottom without interpreting a clock',()=>{
 const status={displayClock:'0:00',period:6,type:{...liveType,detail:'Top 6th',shortDetail:'Top 6th'}};
 const top=progressGame('mlb',status,{outs:0,isTopInning:true});
 assert.equal(top.period,6);assert.equal(top.statusDetail,'Top 6th');assert.equal(top.outs,0);assert.equal(top.isTopInning,true);
 const bottom=progressGame('mlb',{...status,type:{...liveType,detail:'Bottom 6th'}},{outs:2,isTopInning:false});
 assert.equal(bottom.outs,2);assert.equal(bottom.isTopInning,false);assert.equal(bottom.statusDetail,'Bottom 6th');
 const suppliedDetail=progressGame('mlb',{...status,type:{name:'STATUS_DELAYED',state:'in',completed:false,description:'Delayed',detail:'Delayed, Top 1st',shortDetail:'Delayed, Top 1st'}},{outs:0});
 assert.equal(suppliedDetail.status,'delayed');assert.equal(suppliedDetail.statusDescription,'Delayed');assert.equal(suppliedDetail.statusDetail,'Delayed, Top 1st');assert.equal(suppliedDetail.isTopInning,null);
});

test('missing or invalid progress fields stay unavailable and valid zero values survive',()=>{
 const missing=progressGame('mlb',{type:liveType});
 for(const key of ['clock','period','outs','isTopInning','statusDetail','statusShortDetail'])assert.equal(missing[key],null);
 const invalid=progressGame('mlb',{displayClock:' ',period:-1,type:liveType},{outs:4,isTopInning:'false'});
 assert.equal(invalid.clock,null);assert.equal(invalid.period,null);assert.equal(invalid.outs,null);assert.equal(invalid.isTopInning,null);
 const zero=progressGame('cfb',{displayClock:'0:00',period:0,type:{...liveType,shortDetail:'Provider phase'}});
 assert.equal(zero.clock,'0:00');assert.equal(zero.period,0);assert.equal(zero.statusDetail,'Provider phase');
});

test('cached browser score time is retained without changing market retrieval semantics',()=>{
 const source=event('cached');source.status={type:liveType};source.scoreObservedAt='2026-10-17T02:00:00Z';
 const retrievedAt='2026-10-17T02:00:59Z';
 const normalized=normalizeScoreboard({events:[source]},'nfl',{retrievedAt}).games[0];
 assert.equal(normalized.scoreObservedAt,'2026-10-17T02:00:00.000Z');assert.equal(normalized.retrievedAt,retrievedAt);
 for(const value of [null,'invalid','2026-10-17T02:01:00Z']){
  source.scoreObservedAt=value;assert.equal(normalizeScoreboard({events:[source]},'nfl',{retrievedAt}).games[0].scoreObservedAt,null);
 }
 delete source.scoreObservedAt;
 assert.equal(normalizeScoreboard({events:[source]},'nfl',{retrievedAt}).games[0].scoreObservedAt,retrievedAt);
});


test('CFB supported request limit avoids silent 25-game fallback and flags actual saturation',async()=>{
 assert.equal(new URL(scoreboardUrl('cfb',{limit:1000})).searchParams.get('limit'),'200');
 assert.equal(new URL(scoreboardUrl('nfl')).searchParams.get('limit'),'1000');
 assert.equal(scoreboardPayloadLimited('cfb',{events:Array(52).fill({})}),false);
 assert.equal(scoreboardPayloadLimited('cfb',{events:Array(200).fill({})}),true);
 assert.equal(scoreboardPayloadLimited('cfb',{}),true);
 const board=await fetchScoreboard('cfb',{startDate:'2026-10-17'},async()=>({ok:true,json:async()=>({events:Array.from({length:200},(_,id)=>event(id))})}));
 assert.equal(board.partialLiveCoverage,true);
 assert.equal(board.games.length,200);
 assert.ok(board.warnings.some(w=>/response limit/.test(w)));
});
