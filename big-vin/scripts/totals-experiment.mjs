/** Big Vin over/under experiment (NFL). Separate from the spread record and its bankroll.
 * Hourly: fit offense/defense points ratings on nflverse finals, compare with the current market
 * total on the Big Vin slate, save over/under picks before kickoff, grade finals, replay a $500 paper
 * bankroll, and write big-vin/data/totals/nfl.json for the site. Problems become warnings; never fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {fitTotals,projectTotal,totalPick,gradeTotal} from '../lib/totals.mjs';
import {parse,nflGames,backtest,backtestHistory,summarize} from './totals-backtest.mjs';
import {build as buildHistory,historyFile,WINDOWS} from './totals-history.mjs';
import {TOTALS_CONFIGS} from '../lib/totals.mjs';
import {OUT_FILE as INJURY_FILE} from './injury-lines.mjs';

export const ledgerFile=sport=>fileURLToPath(new URL(`../../playbook/totals/${sport}.jsonl`,import.meta.url));
export const summaryFile=sport=>fileURLToPath(new URL(`../data/totals/${sport}.json`,import.meta.url));
export const TOTALS_SPORTS=['nfl','cfb','nba','wnba','cbb'];
const LABEL={nfl:'NFL',cfb:'college football',nba:'NBA',wnba:'WNBA',cbb:'men’s college basketball'};
const SITE=process.env.BIG_VIN_SITE_URL||'https://big-vin.lestercrafton.workers.dev';
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

export async function run({sport='nfl',fetchImpl=globalThis.fetch,now=new Date().toISOString(),ledger=ledgerFile(sport),summary=summaryFile(sport),injuryFile=INJURY_FILE}={}){
 const warnings=[],nfl=sport==='nfl';
 let games;
 if(nfl)games=nflGames(parse(await (await fetchImpl(GAMES_CSV,{signal:AbortSignal.timeout(60000)})).text()));
 else{try{await buildHistory(sport,{fetchImpl,today:now.slice(0,10)});}catch(e){warnings.push('History refresh failed, using the saved history: '+e.message);}
  games=JSON.parse(fs.readFileSync(historyFile(sport),'utf8')).games.map(g=>({...g,marketTotal:g.total}));}
 const model=fitTotals(games,{sport,asOf:now});
 let injuries=null;if(nfl)try{injuries=JSON.parse(fs.readFileSync(injuryFile,'utf8'));if(!(Date.parse(now)-Date.parse(injuries.generatedAt)<=36*3600000)){warnings.push('Injury table is stale; no injury effect.');injuries=null;}}catch(e){warnings.push('Injury table unavailable: '+e.message);}
 let slate={games:[]};try{const r=await fetchImpl(`${SITE}/api/slate?sport=${sport}`,{signal:AbortSignal.timeout(90000)});if(!r.ok)throw new Error('HTTP '+r.status);slate=await r.json();}catch(e){warnings.push('Slate unavailable: '+e.message);}
 const events=read(ledger),last=effectivePicks(events),added=[];
 for(const g of slate.games||[]){
  if(g.status!=='scheduled'||!(Date.parse(g.startTime)>Date.parse(now)+60000)||g.exhibition)continue;
  const q=g.moneylineMarket;if(!Number.isFinite(q?.total)||!(Date.parse(now)-Date.parse(q.observedAt)<=QUOTE_MAX_AGE)){continue;}
  const homeId=nfl?abbr(g.home):String(g.home.id),awayId=nfl?abbr(g.away):String(g.away.id);
  const sched=nfl?games.find(x=>x.homeId===homeId&&x.awayId===awayId&&Math.abs(Date.parse(x.date)-Date.parse(easternDay(g.startTime)))<=86400000):null;
  const inj=injuries?{home:injuries.teams[homeId]?.items||[],away:injuries.teams[awayId]?.items||[]}:null;
  const p=projectTotal({homeId,awayId,neutral:g.neutralSite===true},model,{injuries:inj,dome:sched?.dome});if(!p||(!nfl&&p.sparse))continue;
  const pick=totalPick({sport,total:p.total,marketTotal:q.total,injuryEffect:p.injuryEffect,weatherEffect:p.weatherEffect});
  const price=pick.side==='over'?q.overPrice:pick.side==='under'?q.underPrice:null;
  const e={type:'pick',version:`bv-${sport}-totals-v1`,gameId:g.id,startTime:g.startTime,homeId,awayId,home:g.home.name,away:g.away.name,
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
  const f=nfl?games.find(x=>x.homeId===p.homeId&&x.awayId===p.awayId&&Math.abs(Date.parse(x.date)-Date.parse(easternDay(p.startTime)))<=86400000&&x.homeScore!==null):games.find(x=>x.id===String(p.gameId));
  if(!f)continue;const actual=f.homeScore+f.awayScore,result=gradeTotal(p.side,p.marketTotal,actual);
  if(result)added.push({type:'grade',gameId:p.gameId,pickCapturedAt:p.capturedAt,side:p.side,line:p.marketTotal,actualTotal:actual,result,gradedAt:now,source:nfl?GAMES_CSV:'ESPN scoreboard final'});
 }
 if(added.length){fs.mkdirSync(path.dirname(ledger),{recursive:true});fs.appendFileSync(ledger,added.map(e=>JSON.stringify(e)).join('\n')+'\n');}
 const all=[...events,...added],picks=effectivePicks(all),grades=new Map(all.filter(e=>e.type==='grade').map(e=>[e.gameId,e]));
 const book=replay([...picks.values()],grades);
 // Backtest: frozen settings, walk-forward weekly refits on 2023-2025.
 // The backtest is slow for college basketball, so it is reused for a week.
 let prev=null;try{prev=JSON.parse(fs.readFileSync(summary,'utf8'));}catch{}
 const W=WINDOWS[sport],testWindow=W?W[W.length===2?0:1]:null;
 const bt=prev?.backtest&&Date.parse(now)-Date.parse(prev.backtest.computedAt||0)<7*86400000?prev.backtest
  :{seasons:nfl?'2023-2025':`${testWindow[0]} to ${testWindow[1]}`,computedAt:now,...summarize(nfl?backtest(games,{seasons:[2023,2024,2025]}):backtestHistory(sport,games,{start:testWindow[0],end:testWindow[1]}))};
 const out={schema:'big-vin-totals/1',version:`bv-${sport}-totals-v1`,sport,generatedAt:now,
  method:(nfl?'':`${LABEL[sport]}: `)+'Offense and defense points ratings fit to '+(nfl?'nflverse':'ESPN')+' finals (ridge shrinkage, '+TOTALS_CONFIGS[sport].halfLifeDays+'-day half-life, home edge'+(nfl?', indoor edge':'')+'; for basketball the ratings are points per game, so pace is inside them). Game total = both teams’ expected points. '+(nfl?'Injuries: 60% of each team’s offensive injury value comes off its own points; 60% of its defensive injury value is added to the opponent’s points. ':'No injury data for this sport yet. ')+`A total ${TOTALS_CONFIGS[sport].threshold}+ points from the market with no injury or weather explanation is halved toward the market and marked for review.`,
  record:{wins:book.wins,losses:book.losses,pushes:book.pushes,pending:book.pending,bankroll:book.bankroll,bankrollStart:START},
  backtest:bt,warnings,
  games:Object.fromEntries([...picks.values()].map(p=>[p.gameId,{side:p.side,total:p.total,modelTotal:p.modelTotal,marketTotal:p.marketTotal,edge:p.edge,price:p.price,provider:p.provider,capturedAt:p.capturedAt,startTime:p.startTime,homePoints:p.homePoints,awayPoints:p.awayPoints,injuryEffect:p.injuryEffect,check:p.check,result:grades.get(p.gameId)?.result??null,actualTotal:grades.get(p.gameId)?.actualTotal??null,stake:book.plays[p.gameId]??null}]))};
 fs.mkdirSync(path.dirname(summary),{recursive:true});fs.writeFileSync(summary,JSON.stringify(out,null,1)+'\n');
 return {added:added.length,record:out.record,warnings};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const only=process.argv.find(a=>a.startsWith('--sport='))?.slice(8);
 for(const sport of only?[only]:TOTALS_SPORTS){try{const r=await run({sport});for(const w of r.warnings)console.log(`::warning title=Totals ${sport}::${w}`);console.log(sport,JSON.stringify(r));}
 catch(e){console.log(`::warning title=Totals ${sport}::${e.message}`);}}
}
