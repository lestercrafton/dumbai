/** Big Vin over/under experiment (NFL). Separate from the spread record and its bankroll.
 * Hourly: fit offense/defense points ratings on nflverse finals, compare with the current market
 * total on the Big Vin slate, save over/under picks before kickoff, grade finals, replay a $500 paper
 * bankroll, and write big-vin/data/totals/nfl.json for the site. Problems become warnings; never fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {fitTotals,projectTotal,totalPick,gradeTotal} from '../lib/totals.mjs';
import {parse,nflGames,backtest,summarize} from './totals-backtest.mjs';
import {OUT_FILE as INJURY_FILE} from './injury-lines.mjs';

export const LEDGER=fileURLToPath(new URL('../../playbook/totals/nfl.jsonl',import.meta.url));
export const SUMMARY=fileURLToPath(new URL('../data/totals/nfl.json',import.meta.url));
const SITE=process.env.BIG_VIN_SITE_URL||'https://big-vin.sitetime.workers.dev';
const GAMES_CSV='https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const ALIAS={WSH:'WAS',LA:'LAR',JAC:'JAX'};const abbr=t=>ALIAS[t?.abbreviation]||t?.abbreviation;
const QUOTE_MAX_AGE=30*60000,START=500,STAKE=0.02;
const easternDay=v=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
const read=f=>fs.existsSync(f)?fs.readFileSync(f,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];
const profit=(price,stake)=>price>0?stake*price/100:stake*100/Math.abs(price);

/** The effective pick for a game is the last one saved before kickoff. */
export function effectivePicks(events){
 const m=new Map();for(const e of events)if(e.type==='pick'&&Date.parse(e.capturedAt)<Date.parse(e.startTime)){const p=m.get(e.gameId);if(!p||e.capturedAt>p.capturedAt)m.set(e.gameId,e);}
 return m;
}
/** Paper bankroll: 2% of each Eastern day's opening balance per priced pick, settled in start order. */
export function replay(picks,grades){
 let bal=START,day=null,open=START;const rec={wins:0,losses:0,pushes:0,pending:0},plays={};
 for(const p of [...picks].filter(p=>p.side).sort((a,b)=>a.startTime.localeCompare(b.startTime)||a.gameId.localeCompare(b.gameId))){
  const d=easternDay(p.startTime);if(d!==day){day=d;open=bal;}
  const g=grades.get(p.gameId);if(!g){rec.pending++;continue;}
  const stake=Math.round(open*STAKE*100)/100,price=Number.isFinite(p.price)?p.price:-110;
  const net=g.result==='win'?profit(price,stake):g.result==='loss'?-stake:0;bal=Math.round((bal+net)*100)/100;
  rec[g.result==='win'?'wins':g.result==='loss'?'losses':'pushes']++;plays[p.gameId]={stake,net:Math.round(net*100)/100};
 }
 return {...rec,bankroll:bal,bankrollStart:START,plays};
}

export async function run({fetchImpl=globalThis.fetch,now=new Date().toISOString(),ledger=LEDGER,summary=SUMMARY,injuryFile=INJURY_FILE}={}){
 const warnings=[];
 const csv=await (await fetchImpl(GAMES_CSV,{signal:AbortSignal.timeout(60000)})).text();
 const games=nflGames(parse(csv));
 const model=fitTotals(games,{sport:'nfl',asOf:now});
 let injuries=null;try{injuries=JSON.parse(fs.readFileSync(injuryFile,'utf8'));if(!(Date.parse(now)-Date.parse(injuries.generatedAt)<=36*3600000)){warnings.push('Injury table is stale; no injury effect.');injuries=null;}}catch(e){warnings.push('Injury table unavailable: '+e.message);}
 let slate={games:[]};try{const r=await fetchImpl(`${SITE}/api/slate?sport=nfl`,{signal:AbortSignal.timeout(90000)});if(!r.ok)throw new Error('HTTP '+r.status);slate=await r.json();}catch(e){warnings.push('Slate unavailable: '+e.message);}
 const events=read(ledger),last=effectivePicks(events),added=[];
 for(const g of slate.games||[]){
  if(g.status!=='scheduled'||!(Date.parse(g.startTime)>Date.parse(now)+60000)||g.exhibition)continue;
  const q=g.moneylineMarket;if(!Number.isFinite(q?.total)||!(Date.parse(now)-Date.parse(q.observedAt)<=QUOTE_MAX_AGE)){continue;}
  const homeId=abbr(g.home),awayId=abbr(g.away);
  const sched=games.find(x=>x.homeId===homeId&&x.awayId===awayId&&Math.abs(Date.parse(x.date)-Date.parse(easternDay(g.startTime)))<=86400000);
  const inj=injuries?{home:injuries.teams[homeId]?.items||[],away:injuries.teams[awayId]?.items||[]}:null;
  const p=projectTotal({homeId,awayId,neutral:g.neutralSite===true},model,{injuries:inj,dome:sched?.dome});if(!p)continue;
  const pick=totalPick({sport:'nfl',total:p.total,marketTotal:q.total,injuryEffect:p.injuryEffect,weatherEffect:p.weatherEffect});
  const price=pick.side==='over'?q.overPrice:pick.side==='under'?q.underPrice:null;
  const e={type:'pick',version:'bv-nfl-totals-v1',gameId:g.id,startTime:g.startTime,homeId,awayId,home:g.home.name,away:g.away.name,
   modelTotal:Math.round(p.total*100)/100,total:pick.total,marketTotal:q.total,side:pick.side,edge:pick.edge,price:Number.isFinite(price)?price:null,provider:q.provider,marketObservedAt:q.observedAt,
   homePoints:Math.round(p.homePoints*10)/10,awayPoints:Math.round(p.awayPoints*10)/10,injuryEffect:Math.round(p.injuryEffect*100)/100,dome:!!sched?.dome,check:pick.check,capturedAt:now,modelAsOf:now.slice(0,10),sparse:p.sparse};
  const prev=last.get(g.id);
  if(prev&&['side','total','marketTotal','price'].every(k=>prev[k]===e[k]))continue;
  added.push(e);last.set(g.id,e);
 }
 // Grade from nflverse finals.
 const graded=new Set(events.filter(e=>e.type==='grade').map(e=>e.gameId));
 for(const p of last.values()){
  if(graded.has(p.gameId)||Date.parse(p.startTime)>Date.parse(now))continue;
  const f=games.find(x=>x.homeId===p.homeId&&x.awayId===p.awayId&&Math.abs(Date.parse(x.date)-Date.parse(easternDay(p.startTime)))<=86400000&&x.homeScore!==null);
  if(!f)continue;const actual=f.homeScore+f.awayScore,result=gradeTotal(p.side,p.marketTotal,actual);
  if(result)added.push({type:'grade',gameId:p.gameId,pickCapturedAt:p.capturedAt,side:p.side,line:p.marketTotal,actualTotal:actual,result,gradedAt:now,source:GAMES_CSV});
 }
 if(added.length){fs.mkdirSync(path.dirname(ledger),{recursive:true});fs.appendFileSync(ledger,added.map(e=>JSON.stringify(e)).join('\n')+'\n');}
 const all=[...events,...added],picks=effectivePicks(all),grades=new Map(all.filter(e=>e.type==='grade').map(e=>[e.gameId,e]));
 const book=replay([...picks.values()],grades);
 // Backtest: frozen settings, walk-forward weekly refits on 2023-2025.
 const bt=summarize(backtest(games,{seasons:[2023,2024,2025]}));
 const out={schema:'big-vin-totals/1',version:'bv-nfl-totals-v1',sport:'nfl',generatedAt:now,
  method:'Offense and defense points ratings fit to nflverse finals (ridge shrinkage, 150-day half-life, home edge, indoor edge). Game total = both teams’ expected points. Injuries: 60% of each team’s offensive injury value comes off its own points; 60% of its defensive injury value is added to the opponent’s points. A total 4+ points from the market with no injury or weather explanation is halved toward the market and marked for review.',
  record:{wins:book.wins,losses:book.losses,pushes:book.pushes,pending:book.pending,bankroll:book.bankroll,bankrollStart:START},
  backtest:{seasons:'2023-2025',...bt},warnings,
  games:Object.fromEntries([...picks.values()].map(p=>[p.gameId,{side:p.side,total:p.total,modelTotal:p.modelTotal,marketTotal:p.marketTotal,edge:p.edge,price:p.price,provider:p.provider,capturedAt:p.capturedAt,startTime:p.startTime,homePoints:p.homePoints,awayPoints:p.awayPoints,injuryEffect:p.injuryEffect,check:p.check,result:grades.get(p.gameId)?.result??null,actualTotal:grades.get(p.gameId)?.actualTotal??null,stake:book.plays[p.gameId]??null}]))};
 fs.mkdirSync(path.dirname(summary),{recursive:true});fs.writeFileSync(summary,JSON.stringify(out,null,1)+'\n');
 return {added:added.length,record:out.record,warnings};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 try{const r=await run();for(const w of r.warnings)console.log(`::warning title=Totals::${w}`);console.log(JSON.stringify(r));}
 catch(e){console.log(`::warning title=Totals::${e.message}`);}
}
