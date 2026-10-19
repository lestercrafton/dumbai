/** Playbook versions, shadow challengers, Tuesday scoreboards and promotions.
 * Data contract: docs/learning-loop-contract.md. Pure functions only; storage is lib/playbook-store.ts.
 */
import {gradeSpreadPick,spreadOffer} from './spread-record.mjs';
import {replayBankroll,BANKROLL_POLICY} from './bankroll.mjs';

export const PLAYBOOK_V1=Object.freeze({id:'v1',label:'Playbook v1',frozenOn:'2026-10-19',
 // Midnight America/Chicago on October 19, 2026. Anything saved before this is v1.
 frozenAt:'2026-10-19T05:00:00.000Z'});
// Same rule as the runner and the live board: $500 per version and sport, 2% of the Eastern day's opening balance.
export const PAPER_BANKROLL=Object.freeze({start:BANKROLL_POLICY.startingBankroll,fraction:BANKROLL_POLICY.fraction,policy:BANKROLL_POLICY.id});
export const NOTE_LIMIT=2000;
export const SPORTS=Object.freeze(['nfl','cfb','nba','wnba','cbb','nhl','mlb']);
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const WEEK=/^(\d{4}-W\d{2}|\d{4}-\d{2}-\d{2})$/;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const isoTime=v=>typeof v==='string'&&v.length<=40&&Number.isFinite(Date.parse(v));
const text=(v,max=4000)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const optionalText=(v,max=4000)=>v===undefined||v===null||text(v,max);
const ids=(v,max=50)=>Array.isArray(v)&&v.length<=max&&v.every(x=>typeof x==='string'&&ID.test(x));
function fail(message){throw new Error(message);}
function bounded(value,max){if(JSON.stringify(value).length>max)fail('Document is too large.');return value;}

export function validateManifest(m){
 if(!m||typeof m!=='object')fail('A versions manifest is required.');
 if(m.schema!=='big-vin-versions/1')fail('Manifest schema must be big-vin-versions/1.');
 if(!ID.test(m.id||''))fail('Manifest id is required.');
 if(!isoTime(m.generatedAt))fail('Manifest generatedAt must be an ISO time.');
 if(!Array.isArray(m.versions)||!m.versions.length||m.versions.length>200)fail('Manifest needs 1–200 versions.');
 const seen=new Set();
 for(const v of m.versions){
  if(!ID.test(v?.id||'')||seen.has(v.id))fail('Each version needs a unique id.');seen.add(v.id);
  if(!text(v.label,120))fail(`Version ${v.id} needs a label.`);
  if(!['live','challenger','retired','frozen'].includes(v.role))fail(`Version ${v.id} has an unknown role.`);
  if(v.sports!==undefined&&!(Array.isArray(v.sports)&&v.sports.every(s=>SPORTS.includes(s))))fail(`Version ${v.id} lists an unknown sport.`);
  if(v.modelVersions!==undefined&&!ids(v.modelVersions))fail(`Version ${v.id} has invalid modelVersions.`);
  if(v.parent!==undefined&&v.parent!==null&&!ID.test(v.parent))fail(`Version ${v.id} has an invalid parent.`);
  if(!isoTime(v.createdAt))fail(`Version ${v.id} needs createdAt.`);
  if(v.frozenAt!==undefined&&v.frozenAt!==null&&!isoTime(v.frozenAt))fail(`Version ${v.id} has an invalid frozenAt.`);
  if(v.weekKey!==undefined&&v.weekKey!==null&&!WEEK.test(v.weekKey))fail(`Version ${v.id} has an invalid weekKey.`);
  if(!optionalText(v.summary,2000)||!optionalText(v.idea,200)||!optionalText(v.tag,200))fail(`Version ${v.id} has invalid text.`);
 }
 return bounded(m,200000);
}
/** @param {any} p @param {number} [now] @param {{backfill?:boolean}} [options] */
export function validateChallengerPick(p,now=Date.now(),{backfill=false}={}){
 if(!p||typeof p!=='object')fail('A pick is required.');
 if(!ID.test(p.id||'')||!ID.test(p.versionId||''))fail('Pick id and versionId are required.');
 if(!SPORTS.includes(p.sport))fail('Pick sport is not supported.');
 if(!ID.test(String(p.gameId||'')))fail('Pick gameId is required.');
 if(!WEEK.test(p.weekKey||''))fail('Pick weekKey is required.');
 if(!isoTime(p.startTime)||!isoTime(p.capturedAt))fail('Pick startTime and capturedAt must be ISO times.');
 if(Date.parse(p.capturedAt)>now+5000)fail('Pick capturedAt cannot be in the future.');
 if(Date.parse(p.capturedAt)>=Date.parse(p.startTime))fail('Challenger picks must be captured before kickoff.');
 // Live posts must arrive before kickoff. Backfills from the runner's committed log may arrive later and are labeled.
 if(!backfill&&Date.parse(p.startTime)<=now+60000)fail('Challenger picks must be saved before kickoff; send older picks as a backfill.');
 if(p.revision!==undefined&&p.revision!==null&&!(Number.isInteger(p.revision)&&p.revision>=1&&p.revision<=1000))fail('Pick revision must be a whole number from 1.');
 if(p.supersedes!==undefined&&p.supersedes!==null&&!ID.test(p.supersedes))fail('Pick supersedes must be a pick id.');
 if(!text(p.home,120)||!text(p.away,120))fail('Pick teams are required.');
 if(p.side!==null&&!['home','away'].includes(p.side))fail('Pick side must be home, away or null (no play).');
 for(const k of ['homeSpread','odds','predictedMargin','stakeUnits'])if(p[k]!==undefined&&p[k]!==null&&!finite(p[k]))fail(`Pick ${k} must be a number.`);
 if(p.side&&!finite(p.homeSpread))fail('A pick with a side needs homeSpread.');
 if(finite(p.odds)&&Math.abs(p.odds)<100)fail('Pick odds must be American odds.');
 if(p.stakeUnits!==undefined&&p.stakeUnits!==null&&(p.stakeUnits<0||p.stakeUnits>10))fail('stakeUnits must be between 0 and 10.');
 if(!optionalText(p.provider,120)||!optionalText(p.note,2000))fail('Pick text fields are invalid.');
 return bounded(p,20000);
}
export function validateChallengerResult(r){
 if(!r||typeof r!=='object')fail('A result is required.');
 if(!ID.test(r.pickId||''))fail('Result pickId is required.');
 if(!['completed','void'].includes(r.status))fail('Result status must be completed or void.');
 if(r.status==='completed'&&!(finite(r.homeScore)&&finite(r.awayScore)))fail('Completed results need scores.');
 if(!isoTime(r.gradedAt))fail('Result gradedAt is required.');
 for(const k of ['closingHomeSpread','closingOdds','clv'])if(r[k]!==undefined&&r[k]!==null&&!finite(r[k]))fail(`Result ${k} must be a number.`);
 if(!optionalText(r.sourceUrl,500))fail('Result sourceUrl is invalid.');
 return bounded(r,8000);
}
export function validateScoreboard(s){
 if(!s||typeof s!=='object')fail('A scoreboard is required.');
 if(s.schema!=='big-vin-scoreboard/1')fail('Scoreboard schema must be big-vin-scoreboard/1.');
 if(!ID.test(s.id||'')||!WEEK.test(s.weekKey||'')||!DAY.test(s.publishedFor||''))fail('Scoreboard id, weekKey and publishedFor (YYYY-MM-DD) are required.');
 if(new Date(s.publishedFor+'T12:00:00Z').getUTCDay()!==2)fail('Scoreboards are published for a Tuesday.');
 if(!ID.test(s.liveVersionId||''))fail('Scoreboard liveVersionId is required.');
 if(s.supersedes!==undefined&&s.supersedes!==null&&!ID.test(s.supersedes))fail('Invalid supersedes id.');
 if(!Array.isArray(s.entries)||s.entries.length>100)fail('Scoreboard entries must be a list.');
 for(const e of s.entries){
  if(!ID.test(e?.versionId||''))fail('Each entry needs versionId.');
  if(!['live','challenger','frozen'].includes(e.role))fail('Entry role must be live, challenger or frozen.');
  if(e.sport!==undefined&&e.sport!==null&&!SPORTS.includes(e.sport))fail('Entry sport is not supported.');
  if(!['kept','dropped','promoted','continuing'].includes(e.decision))fail('Entry decision must be kept, dropped, promoted or continuing.');
  if(!optionalText(e.note,2000))fail('Entry note is invalid.');
 }
 for(const k of ['won','lost'])if(!Array.isArray(s[k])||s[k].length>50||!s[k].every(x=>text(x,600)))fail(`Scoreboard ${k} must be a list of short statements.`);
 for(const k of ['kept','dropped'])if(!ids(s[k]))fail(`Scoreboard ${k} must be a list of version ids.`);
 if(s.lessonEntryId!==undefined&&s.lessonEntryId!==null&&!/^[a-z0-9_-]{5,120}$/.test(s.lessonEntryId))fail('lessonEntryId must be a learning-log entry id.');
 if(!optionalText(s.summary,4000))fail('Scoreboard summary is invalid.');
 return bounded(s,120000);
}
const ODDS_TYPES=['odds','refresh','close'];
/** One line of the runner's append-only odds log (playbook/odds/<sport>/<month>.jsonl). */
export function validateOddsSnapshot(l){
 if(!l||typeof l!=='object')fail('An odds snapshot is required.');
 if(!ODDS_TYPES.includes(l.type))fail('Odds snapshot type must be odds, refresh or close.');
 if(typeof l.id!=='string'||!l.id||l.id.length>200||/\s/.test(l.id))fail('Odds snapshot id is required.');
 if(!SPORTS.includes(l.sport))fail('Odds snapshot sport is not supported.');
 if(!isoTime(l.at))fail('Odds snapshot at must be an ISO time.');
 if(l.type==='refresh'){if(!Array.isArray(l.gameIds)||!l.gameIds.length||l.gameIds.length>2000||!l.gameIds.every(x=>ID.test(String(x))))fail('A refresh line lists the re-checked game ids.');}
 else{
  if(!ID.test(String(l.gameId||'')))fail('Odds snapshot gameId is required.');
  if(!isoTime(l.startTime))fail('Odds snapshot startTime is required.');
  if(!l.market||typeof l.market!=='object')fail('Odds snapshot market is required.');
  if(l.type==='odds'&&Date.parse(l.at)>=Date.parse(l.startTime))fail('Odds snapshots are taken before the start.');
 }
 return bounded(l,40000);
}
export function validatePromotion(p){
 if(!p||typeof p!=='object')fail('A promotion is required.');
 if(!ID.test(p.id||'')||!ID.test(p.fromVersionId||'')||!ID.test(p.toVersionId||''))fail('Promotion id, fromVersionId and toVersionId are required.');
 if(p.fromVersionId===p.toVersionId)fail('A promotion must change the version.');
 if(!SPORTS.includes(p.sport))fail('Promotion sport is not supported.');
 if(!isoTime(p.effectiveAt)||!isoTime(p.decidedAt))fail('Promotion effectiveAt and decidedAt are required.');
 if(Date.parse(p.effectiveAt)<Date.parse(p.decidedAt))fail('A promotion cannot take effect before it was decided.');
 if(!text(p.reason,4000))fail('Promotion reason is required.');
 if(p.scoreboardId!==undefined&&p.scoreboardId!==null&&!ID.test(p.scoreboardId))fail('Invalid scoreboardId.');
 const e=p.evidence;
 if(!e||typeof e!=='object'||!Number.isInteger(e.unseenGames)||e.unseenGames<1)fail('Promotion evidence must count the unseen games it was tested on.');
 return bounded(p,40000);
}

/** The playbook version that owned a saved pick. Before the freeze it is always v1.
 * @param {any} record @param {{promotions?:any[]}} [options] @returns {string} */
export function playbookVersionFor(record,{promotions=[]}={}){
 if(record?.playbookVersion&&ID.test(record.playbookVersion))return record.playbookVersion;
 const at=Date.parse(record?.capturedAt||record?.recordedAt||record?.startTime||'');
 if(!Number.isFinite(at)||at<Date.parse(PLAYBOOK_V1.frozenAt))return PLAYBOOK_V1.id;
 return liveVersionAt(record?.sport,at,promotions);
}
/** @param {string} sport @param {number|string} at @param {any[]} [promotions] @returns {string} */
export function liveVersionAt(sport,at,promotions=[]){
 const t=typeof at==='number'?at:Date.parse(at);
 const applied=promotions.filter(p=>p.sport===sport&&Date.parse(p.effectiveAt)<=t).sort((a,b)=>Date.parse(a.effectiveAt)-Date.parse(b.effectiveAt));
 return applied.at(-1)?.toVersionId??PLAYBOOK_V1.id;
}
const revisionOf=p=>Number.isInteger(p.revision)?p.revision:Number(/:r(\d+)$/.exec(p.id)?.[1]??1);
/** The runner may revise a version's pick before kickoff (ids ending :r1, :r2). Only the latest pregame revision counts. */
export function currentRevisions(picks){
 const best=new Map();
 for(const p of picks){
  if(!(Date.parse(p.capturedAt)<Date.parse(p.startTime)))continue;
  const key=p.versionId+'|'+p.sport+'|'+p.gameId,prev=best.get(key);
  if(!prev||revisionOf(p)>revisionOf(prev)||revisionOf(p)===revisionOf(prev)&&p.capturedAt>prev.capturedAt)best.set(key,p);
 }
 return [...best.values()];
}
export const payout=odds=>finite(odds)&&Math.abs(odds)>=100?(odds>0?odds/100:100/-odds):null;

/** Grade one challenger pick against its saved line; the runner's result supplies the final score and closing line. */
export function gradeChallenger(pick,result){
 if(!result)return {outcome:pick.side?'pending':'no-play',pnl:null,clv:null};
 if(result.status==='void')return {outcome:'void',pnl:null,clv:null};
 if(!pick.side)return {outcome:'no-play',pnl:null,clv:null};
 const cover=(result.homeScore-result.awayScore+pick.homeSpread)*(pick.side==='home'?1:-1);
 const outcome=Math.abs(cover)<1e-9?'push':cover>0?'win':'loss';
 const stake=finite(pick.stakeUnits)?pick.stakeUnits:1,win=payout(pick.odds);
 const pnl=win===null?null:outcome==='push'?0:outcome==='win'?win*stake:-stake;
 // Closing line value in points from the picked side: positive means the line moved toward us.
 const clv=finite(result.clv)?result.clv:finite(result.closingHomeSpread)?(pick.side==='home'?pick.homeSpread-result.closingHomeSpread:result.closingHomeSpread-pick.homeSpread):null;
 return {outcome,pnl,clv,stake};
}
/** Records in the shape the shared bankroll replay reads. */
function bankrollRecord(g,cohort){
 const p=g.pick??g.f,price=g.pick?{odds:p.odds,marketHomeSpread:p.homeSpread}:{odds:p.odds,marketHomeSpread:p.marketHomeSpread};
 const result=g.outcome==='pending'?null:g.outcome==='void'?{status:'void'}:g.outcome==='no-play'?null:{status:'completed',pnl:finite(g.pnl)&&finite(g.stake)&&g.stake>0?g.pnl/g.stake:g.pnl,playedAt:g.playedAt??undefined};
 return {id:p.id,sport:p.sport,cohort,modelVersion:g.pick?p.versionId:p.modelVersion||'ridge-v1',startTime:p.startTime,side:p.side,...price,result};
}
/** Bankroll per sport with the runner's rule; null when there is nothing staked. */
export function replayPaperBankroll(graded,cohort='shadow'){
 const plays=graded.filter(g=>(g.pick??g.f)&&g.outcome!=='no-play');if(!plays.length)return null;
 const sports=[...new Set(plays.map(g=>(g.pick??g.f).sport))].sort();
 const bySport=sports.map(sport=>{try{const r=replayBankroll(plays.filter(g=>(g.pick??g.f).sport===sport).map(g=>bankrollRecord(g,cohort)));return {sport,balance:r.balance,profit:r.profit,blockedBy:r.blockedBy};}catch{return {sport,balance:null,profit:null,blockedBy:null};}});
 const known=bySport.filter(b=>finite(b.balance));
 return {balance:known.length===bySport.length?known.reduce((s,b)=>s+b.balance,0):null,start:PAPER_BANKROLL.start*sports.length,blockedBy:bySport.map(b=>b.blockedBy).filter(Boolean).sort()[0]??null,bySport};
}
/** W-L-P, ROI at saved odds, average CLV and the 2%-of-opening-balance paper bankroll.
 * @param {any[]} graded @param {{bankroll?:boolean,cohort?:string}} [options] */
export function summarizeRecord(graded,{bankroll=true,cohort='shadow'}={}){
 const count=o=>graded.filter(g=>g.outcome===o).length;
 const priced=graded.filter(g=>finite(g.pnl)),staked=priced.reduce((s,g)=>s+(finite(g.stake)?g.stake:1),0);
 const units=priced.length?priced.reduce((s,g)=>s+g.pnl,0):null;
 const clvs=graded.filter(g=>finite(g.clv)).map(g=>g.clv);
 const paper=bankroll?replayPaperBankroll(graded,cohort):null;
 return {wins:count('win'),losses:count('loss'),pushes:count('push'),pending:count('pending'),voids:count('void'),noPlays:count('no-play'),
  pricedPicks:priced.length,units,roi:units===null||!staked?null:units/staked,
  clv:clvs.length?clvs.reduce((s,x)=>s+x,0)/clvs.length:null,clvPicks:clvs.length,
  backfilled:graded.filter(g=>g.pick?.backfill).length,
  bankroll:paper?.balance??null,bankrollStart:paper?.start??null,bankrollBlockedBy:paper?.blockedBy??null};
}
/** Live-model record over saved live forecasts using the same rules as challengers. */
export function gradeLiveForecast(f){
 const g=gradeSpreadPick(f),offer=spreadOffer(f);
 if(g.outcome==='no-line')return {outcome:'no-play',pnl:null,clv:null};
 if(g.outcome==='pending'||g.outcome==='void')return {outcome:g.outcome,pnl:null,clv:null};
 const win=payout(f.odds);
 return {outcome:g.outcome,pnl:win===null?null:g.outcome==='push'?0:g.outcome==='win'?win:-1,clv:null,stake:1,basis:offer?.basis};
}
const afterFreeze=f=>Date.parse(f.capturedAt||f.startTime||'')>=Date.parse(PLAYBOOK_V1.frozenAt);
/** Group challenger picks by week and version, running totals through each week.
 * @param {{picks?:any[],results?:any[],manifest?:any,liveForecasts?:any[],promotions?:any[]}} input */
export function challengerBoard({picks=[],results=[],manifest=null,liveForecasts=[],promotions=[]}){
 const byPick=new Map(results.map(r=>[r.pickId,r]));
 picks=currentRevisions(picks);
 const versions=new Map((manifest?.versions||[]).map(v=>[v.id,v]));
 const weeks=[...new Set(picks.map(p=>p.weekKey))].sort().reverse();
 const gradedAll=picks.map(p=>({pick:p,...gradeChallenger(p,byPick.get(p.id))}));
 return weeks.map(weekKey=>{
  const inWeek=gradedAll.filter(g=>g.pick.weekKey===weekKey);
  const sportsInWeek=[...new Set(inWeek.map(g=>g.pick.sport))].sort();
  const challengers=[...new Set(inWeek.map(g=>g.pick.versionId))].sort().map(versionId=>{
   const mine=gradedAll.filter(g=>g.pick.versionId===versionId);
   const v=versions.get(versionId);
   return {versionId,label:v?.label??versionId,idea:v?.idea??null,summary:v?.summary??null,role:v?.role??'challenger',
    sports:[...new Set(mine.map(g=>g.pick.sport))].sort(),
    week:summarizeRecord(mine.filter(g=>g.pick.weekKey===weekKey),{bankroll:false}),
    running:summarizeRecord(mine.filter(g=>g.pick.weekKey<=weekKey))};
  });
  const live=sportsInWeek.map(sport=>{
   const all=liveForecasts.filter(f=>f.sport===sport).map(f=>({f,...gradeLiveForecast(f)}));
   return {sport,versionId:liveVersionAt(sport,Date.now(),promotions),
    week:summarizeRecord(all.filter(g=>g.f.weekKey===weekKey&&afterFreeze(g.f)),{bankroll:false}),
    running:summarizeRecord(all.filter(g=>g.f.weekKey<=weekKey&&afterFreeze(g.f)),{cohort:'live'})};
  });
  return {weekKey,sports:sportsInWeek,challengers,live};
 });
}
