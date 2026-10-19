/** Append-only shadow ledger: live control and challenger picks on the same games.
 * Events are JSON lines keyed by a unique id. Merging keeps the first copy of an id,
 * so a saved pick, its captured price and reasoning are never rewritten.
 */
import fs from 'node:fs';
import path from 'node:path';
import {gradeForecast,reportingWeek} from './results.mjs';
import {replayBankroll} from './bankroll.mjs';
const finite=x=>typeof x==='number'&&Number.isFinite(x);

export function readEvents(file){
 if(!fs.existsSync(file))return [];
 return fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line));
}
/** Union by id, first copy wins, stable order by time then id. */
export function mergeEvents(...lists){
 const byId=new Map();
 for(const list of lists)for(const e of list)if(e?.id&&!byId.has(e.id))byId.set(e.id,e);
 return [...byId.values()].sort((a,b)=>String(a.at).localeCompare(String(b.at))||a.id.localeCompare(b.id));
}
export function writeEvents(file,events){
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,events.map(e=>JSON.stringify(e)).join('\n')+(events.length?'\n':''));fs.renameSync(tmp,file);
}

/** Latest pick revision per version/game captured before kickoff. */
export function currentPicks(events){
 const picks=new Map();
 for(const e of events)if(e.type==='pick'&&Date.parse(e.at)<Date.parse(e.startTime)){
  const key=e.version+'|'+e.gameId,prev=picks.get(key);
  if(!prev||e.revision>prev.revision)picks.set(key,e);
 }
 return picks;
}

const sideSpread=(homeSpread,side)=>finite(homeSpread)?side==='home'?homeSpread:-homeSpread:null;
/** Choose a side the way the live board does: the sign of model margin plus the home spread. */
export function choosePick({predictedMargin,market}){
 if(!finite(predictedMargin)||!finite(market?.homeSpread))return {side:null,edge:null,odds:null};
 const homeEdge=predictedMargin+market.homeSpread;
 const side=homeEdge===0?null:homeEdge>0?'home':'away';
 const odds=side==='home'?market.homeSpreadPrice:side==='away'?market.awaySpreadPrice:null;
 return {side,edge:Math.abs(homeEdge),odds:finite(odds)?odds:null};
}

/** Append a new revision only when the side differs from the version's current pick. */
export function capturePick(events,{version,sport,game,predictedMargin,market,reasoning,at,eligible=true}){
 const key=version+'|'+game.id;const prev=currentPicks(events).get(key);
 const pick=eligible?choosePick({predictedMargin,market}):{side:null,edge:null,odds:null};
 if(prev?prev.side===pick.side:!pick.side)return null;
 if(!(Date.parse(game.startTime)>Date.parse(at)+60000))return null;
 const revision=(prev?.revision??0)+1;
 return {type:'pick',id:`${version}:${sport}:${game.id}:r${revision}`,at,version,sport,gameId:game.id,revision,supersedes:prev?.id??null,
  startTime:game.startTime,weekKey:reportingWeek({...game,sport}),home:{id:game.home.id,name:game.home.name},away:{id:game.away.id,name:game.away.name},
  predictedMargin,side:pick.side,edge:pick.edge,odds:pick.odds,
  market:{provider:market?.provider??null,homeSpread:market?.homeSpread??null,sideSpread:sideSpread(market?.homeSpread,pick.side),observedAt:market?.observedAt??null},
  reasoning};
}

/** Market observations live in the checkpoint; only a frozen close enters the ledger. */
export function observeMarket(observations,{sport,game,market,at}){
 if(!finite(market?.homeSpread))return null;
 const last=[...observations].reverse().find(o=>o.gameId===game.id);
 if(last&&last.homeSpread===market.homeSpread&&last.homeSpreadPrice===market.homeSpreadPrice&&last.awaySpreadPrice===market.awaySpreadPrice)return null;
 return {gameId:game.id,sport,at,startTime:game.startTime,provider:market.provider??null,observedAt:market.observedAt??at,homeSpread:market.homeSpread,homeSpreadPrice:market.homeSpreadPrice??null,awaySpreadPrice:market.awaySpreadPrice??null};
}
export function closeEvent(observations,{sport,gameId,startTime,at}){
 const before=observations.filter(o=>o.gameId===gameId&&Date.parse(o.observedAt||o.at)<Date.parse(startTime));
 const last=before.at(-1);if(!last)return null;
 return {type:'close',id:`close:${sport}:${gameId}`,at,sport,gameId,startTime,homeSpread:last.homeSpread,homeSpreadPrice:last.homeSpreadPrice,awaySpreadPrice:last.awaySpreadPrice,provider:last.provider,observedAt:last.observedAt,observations:before.length,basis:'Last line observed by the runner before kickoff; runs are not continuous, so this approximates the true close.'};
}

/** Grade each final pick once; corrections append a numbered grade. */
export function gradeEvents(events,games,{at}){
 const out=[];const graded=new Map();
 for(const e of events)if(e.type==='grade')graded.set(e.pickId,e);
 const closes=new Map(events.filter(e=>e.type==='close').map(e=>[e.gameId,e]));
 for(const pick of currentPicks(events).values()){
  if(!pick.side)continue;
  const game=games.get(pick.gameId);if(!game)continue;
  const result=gradeForecast({sport:pick.sport,startTime:pick.startTime,predictedMargin:pick.predictedMargin,marketHomeSpread:pick.market.homeSpread,side:pick.side,odds:pick.odds},game,at);
  if(!result||result.status!=='completed'&&result.status!=='void')continue;
  const close=closes.get(pick.gameId);const closeSide=close?sideSpread(close.homeSpread,pick.side):null;
  const clvPoints=finite(closeSide)&&finite(pick.market.sideSpread)?pick.market.sideSpread-closeSide:null;
  const prev=graded.get(pick.id);
  if(prev&&prev.outcome===result.outcome&&prev.homeScore===result.homeScore&&prev.awayScore===result.awayScore&&prev.clvPoints===clvPoints)continue;
  const n=events.filter(e=>e.type==='grade'&&e.pickId===pick.id).length;
  out.push({type:'grade',id:`grade:${pick.id}${n?':'+(n+1):''}`,at,pickId:pick.id,version:pick.version,sport:pick.sport,gameId:pick.gameId,status:result.status,homeScore:result.homeScore??null,awayScore:result.awayScore??null,outcome:result.outcome,pnl:result.pnl,clvPoints,closeId:close?.id??null,sourceUrl:result.sourceUrl??null});
 }
 return out;
}

/** Per-version records for summaries and the shared bankroll calculator. */
export function versionRecords(events,version){
 const grades=new Map();for(const e of events)if(e.type==='grade')grades.set(e.pickId,e);
 return [...currentPicks(events).values()].filter(p=>p.version===version&&p.side).map(p=>{const g=grades.get(p.id);
  return {id:p.id,gameId:p.gameId,sport:p.sport,cohort:'shadow',modelVersion:version,startTime:p.startTime,weekKey:p.weekKey,side:p.side,odds:p.odds,marketHomeSpread:p.market.homeSpread,capturedAt:p.at,reasoning:p.reasoning,
   result:g?{status:g.status,outcome:g.outcome,pnl:g.pnl,homeScore:g.homeScore,awayScore:g.awayScore}:null,clvPoints:g?.clvPoints??null};});
}
export function summarize(records){
 const graded=records.filter(r=>r.result?.status==='completed');const priced=graded.filter(r=>finite(r.result.pnl));
 const clv=graded.filter(r=>finite(r.clvPoints));
 const w=graded.filter(r=>r.result.outcome==='win').length,l=graded.filter(r=>r.result.outcome==='loss').length,p=graded.filter(r=>r.result.outcome==='push').length;
 const units=priced.reduce((s,r)=>s+r.result.pnl,0);
 let bankroll=null;try{bankroll=records.length?replayBankroll(records):null;}catch{bankroll=null;}
 return {picks:records.length,graded:graded.length,priced:priced.length,pending:records.filter(r=>!r.result).length,wins:w,losses:l,pushes:p,units,roi:priced.length?units/priced.length:null,
  clvCoverage:graded.length?clv.length/graded.length:null,meanClv:clv.length?clv.reduce((s,r)=>s+r.clvPoints,0)/clv.length:null,
  weeks:new Set(graded.map(r=>r.weekKey)).size,bankroll:bankroll?{balance:bankroll.balance,profit:bankroll.profit,returnRate:bankroll.returnRate,blockedBy:bankroll.blockedBy}:null};
}
