/** Save timestamped odds snapshots, capture live-control and challenger shadow picks,
 * freeze closing lines and grade finals.
 * Reads only public endpoints: the Big Vin slate API and keyless ESPN JSON.
 * Never writes to the Site. Shadow problems are reported but never fail the run.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {SPORT_PATHS,normalizeScoreboard,scoreboardUrls} from '../lib/feeds/adapter.mjs';
import {loadManifest,variantsFor,predict,NEEDS} from '../lib/playbook.mjs';
import {weatherContext} from '../lib/weather.mjs';
import {manifestDocument,pendingDocuments,queue,readQueue,flush,PLAYBOOK_URL} from '../lib/playbook-outbox.mjs';
import {ODDS_DIR,readOdds,snapshotRun,appendOdds,spreadObservations,spreadAt} from '../lib/odds-log.mjs';
import {injuryContext,scoreboardLeaders} from '../lib/injuries.mjs';
import {readEvents,mergeEvents,writeEvents,capturePick,observeMarket,closeEvent,gradeEvents,currentPicks} from '../lib/shadow-ledger.mjs';

export const REPO_LEDGER=fileURLToPath(new URL('../../playbook/ledger',import.meta.url));
export const stateDir=(root=path.join(os.homedir(),'.local/share/big-vin'))=>path.join(root,'playbook');
const SITE=process.env.BIG_VIN_SITE_URL||'https://big-vin-grind-to-win.sunlightisfree.chatgpt.site';
const day=ms=>new Date(ms).toISOString().slice(0,10);
const easternDay=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));

async function json(url,fetchImpl,tries=2){
 let last;for(let i=0;i<tries;i++){try{const r=await fetchImpl(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(60000)});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.json();}catch(e){last=e;}}
 throw new Error(`${url.split('?')[0]}: ${last.message}`);
}
/** Raw scoreboard events (for embedded season leaders) and normalized games (for grading). */
async function scoreboards(sport,dates,fetchImpl){
 const raw=new Map(),games=new Map();
 const add=(payload,url)=>{const retrievedAt=new Date().toISOString();
  for(const e of payload.events||[])raw.set(String(e.id),{event:e,url,retrievedAt});
  for(const g of normalizeScoreboard(payload,sport,{sourceUrl:url,retrievedAt}).games)games.set(g.id,g);};
 if(sport==='cfb'){
  // ESPN currently rejects CFB date ranges (HTTP 400) and caps single dates at 25 events,
  // so read whole weeks: every week whose calendar window touches a requested date.
  for(const group of [80,81]){
   const base=`https://site.api.espn.com/apis/site/v2/sports/${SPORT_PATHS.cfb}/scoreboard?groups=${group}&limit=300`;
   const current=await json(base,fetchImpl);
   const weeks=(current.leagues?.[0]?.calendar||[]).flatMap(t=>(t.entries||[]).map(w=>({value:w.value,season:t.value,start:w.startDate,end:w.endDate})));
   const wanted=weeks.filter(w=>dates.some(d=>Date.parse(d+'T12:00:00Z')>=Date.parse(w.start)&&Date.parse(d+'T00:00:00Z')<=Date.parse(w.end)));
   if(!wanted.length){add(current,base);continue;}
   for(const w of wanted){const url=`${base}&week=${w.value}&seasontype=${w.season}`;add(await json(url,fetchImpl),url);}
  }
  return {raw,games};
 }
 // One date per request: ESPN rejects some multi-day ranges with HTTP 400.
 for(const d of dates)for(const url of scoreboardUrls(sport,{startDate:d}))add(await json(url,fetchImpl),url);
 return {raw,games};
}

export async function runSport(sport,{manifest,events,odds=[],now=new Date().toISOString(),fetchImpl=globalThis.fetch,log=console.error}){
 const added=[],warnings=[];const all=()=>[...events,...added];
 const slateUrl=`${SITE}/api/slate?sport=${sport}`;
 const slate=await json(slateUrl,fetchImpl);
 // 1. Odds snapshots for every game on the board, before anything else.
 const oddsLines=snapshotRun(sport,slate.games||[],odds,{at:now,source:slateUrl});
 // Close any logged game that has started but fell off the board.
 const onBoard=new Set((slate.games||[]).map(g=>g.id));
 const stale=[...new Map(odds.filter(l=>l.type==='odds'&&!onBoard.has(l.gameId)).map(l=>[l.gameId,{id:l.gameId,startTime:l.startTime}])).values()];
 oddsLines.push(...snapshotRun(sport,stale,odds,{at:now,source:slateUrl}).filter(l=>l.type==='close'));
 const allOdds=[...odds,...oddsLines];
 const variants=variantsFor(manifest,sport,now);if(!variants.length)return {sport,skipped:'no playbook versions active yet',added,oddsLines,warnings};
 const upcoming=(slate.games||[]).filter(g=>g.status==='scheduled'&&Date.parse(g.startTime)>Date.parse(now)+60000&&!g.modelExcludedReason&&!g.exhibition);
 const needs=new Set(variants.filter(v=>v.role==='challenger').map(v=>NEEDS[v.feature]));
 const dates=[...new Set(upcoming.map(g=>easternDay(g.startTime)))].sort();
 let raw=new Map(),rawOk=false;
 if((needs.has('players')||needs.has('weather'))&&dates.length){try{raw=(await scoreboards(sport,dates,fetchImpl)).raw;rawOk=true;}catch(e){warnings.push('Scoreboard unavailable, injury and weather challengers not captured this run: '+e.message);}}
 const context=needs.has('players')&&rawOk?injuryContext(sport,{fetchImpl,now,log}):null;
 const weather=needs.has('weather')&&rawOk?weatherContext({fetchImpl,log}):null;
 for(const g of upcoming){
  const mm=g.moneylineMarket;
  const market=mm?{provider:mm.provider,homeSpread:mm.homeSpread,homeSpreadPrice:mm.homeSpreadPrice,awaySpreadPrice:mm.awaySpreadPrice,openHomeSpread:mm.openHomeSpread,observedAt:mm.observedAt}:null;
  const base={version:g.pickRevision?.modelVersion||g.modelVersion,predictedMargin:Number.isFinite(g.pickRevision?.predictedMargin)?g.pickRevision.predictedMargin:g.projection?.predictedHomeMargin,source:slateUrl,asOf:g.modelAsOf??slate.asOf??null};
  const r=raw.get(String(g.id));
  let players=null,wx=null;
  if(context&&r){
   const leaders=scoreboardLeaders(r.event,sport,{url:r.url,observedAt:r.retrievedAt});
   try{players={home:await context.keyPlayers(g.home,{leaders:leaders[String(g.home.id)]||[],kickoff:g.startTime}),away:await context.keyPlayers(g.away,{leaders:leaders[String(g.away.id)]||[],kickoff:g.startTime})};}
   catch(e){warnings.push(`${g.id} injury inputs: ${e.message}`);}
  }
  if(weather&&r)wx=await weather.forGame(r.event,g.startTime);
  const first=allOdds.find(l=>l.type==='odds'&&l.gameId===g.id);
  const lineAt=t=>{const l=spreadAt(allOdds,g.id,t);return l?{homeSpread:l.market.homeSpread,at:l.at}:null;};
  for(const v of variants){
   if(v.role==='challenger'){const need=NEEDS[v.feature];if(need==='players'&&!players||need==='weather'&&!wx)continue;}
   const {predictedMargin,reasoning}=predict(v,{base,players,market,lineAt,firstSeen:first?{homeSpread:first.market.homeSpread,at:first.at}:null,weather:wx});
   const e=capturePick(all(),{version:v.version,sport,game:g,predictedMargin,market,reasoning:{...reasoning,marketSource:'Big Vin slate current feed snapshot (moneylineMarket)'},at:now,eligible:!g.lowEvidence&&!g.stale});
   if(e)added.push(e);
  }
 }
 // Freeze a close from the odds log once a game has started; grade picks whose games should be final.
 const observations=spreadObservations(allOdds);
 const picks=[...currentPicks(all()).values()];
 const closed=new Set(all().filter(e=>e.type==='close').map(e=>e.gameId));
 for(const p of picks)if(!closed.has(p.gameId)&&Date.parse(p.startTime)<=Date.parse(now)){const c=closeEvent(observations,{sport,gameId:p.gameId,startTime:p.startTime,at:now});if(c){added.push(c);closed.add(p.gameId);}}
 const gradedIds=new Set(all().filter(e=>e.type==='grade').map(e=>e.pickId));
 const due=picks.filter(p=>p.side&&!gradedIds.has(p.id)&&Date.parse(p.startTime)<Date.parse(now)-2.5*3600000&&Date.parse(p.startTime)>Date.parse(now)-21*86400000);
 if(due.length){
  try{const {games}=await scoreboards(sport,[...new Set(due.map(p=>easternDay(p.startTime)))].sort(),fetchImpl);added.push(...gradeEvents(all(),games,{at:now}));}
  catch(e){warnings.push('Grading scoreboard unavailable: '+e.message);}
 }
 if(context?.errors.length)warnings.push(...context.errors.slice(0,5).map(e=>`${e.key}: ${e.error}`));
 if(weather?.errors.length)warnings.push(...weather.errors.slice(0,3).map(e=>`weather ${e.venue}: ${e.error}`));
 return {sport,variants:variants.map(v=>v.version),upcoming:upcoming.length,added,oddsLines,warnings};
}

export async function main({sports=Object.keys(SPORT_PATHS),root,repoLedger=REPO_LEDGER,oddsDir=ODDS_DIR,fetchImpl=globalThis.fetch,now=new Date().toISOString(),postEnabled=process.env.BIG_VIN_PLAYBOOK_POST==='1',playbookUrl=process.env.BIG_VIN_PLAYBOOK_URL||PLAYBOOK_URL,ref=process.env.GITHUB_RUN_ID?`${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`:null}={}){
 const manifest=loadManifest();const dir=stateDir(root);const report={at:now,sports:[]};
 const outbox=path.join(dir,'outbox');const fresh=new Set();
 // The odds log is kept in the repo and, so a failed commit never loses it, in the checkpoint too.
 const stateOdds=path.join(dir,'odds');
 for(const k of queue(outbox,{manifestDoc:manifestDocument(manifest,{generatedAt:now})}))fresh.add(k);
 for(const sport of sports){
  const ledgerFiles=[path.join(dir,'ledger',sport+'.jsonl'),path.join(repoLedger,sport+'.jsonl')];
  const events=mergeEvents(...ledgerFiles.map(readEvents));
  try{
   const odds=mergeEvents(readOdds(sport,{dir:oddsDir}),readOdds(sport,{dir:stateOdds}));
   const r=await runSport(sport,{manifest,events,odds,now,fetchImpl});
   if(r.oddsLines.length){appendOdds(sport,r.oddsLines,{dir:oddsDir});appendOdds(sport,r.oddsLines,{dir:stateOdds});}
   const merged=mergeEvents(events,r.added);
   if(merged.length)for(const f of ledgerFiles)writeEvents(f,merged);
   const docs=pendingDocuments(merged,readQueue(outbox));
   for(const k of queue(outbox,{picks:docs.picks,results:docs.results,odds:r.oddsLines}))fresh.add(k);
   const count=t=>r.added.filter(e=>e.type===t).length,oc=t=>r.oddsLines.filter(e=>e.type===t).length;
   report.sports.push({sport,variants:r.variants,upcoming:r.upcoming,odds:{snapshots:oc('odds'),refreshed:r.oddsLines.find(l=>l.type==='refresh')?.gameIds.length??0,closes:oc('close')},picks:count('pick'),closes:count('close'),grades:count('grade'),warnings:r.warnings,skipped:r.skipped});
  }catch(e){report.sports.push({sport,error:e.message});}
 }
 // Post to the Cloudflare site; earlier queued documents go as a labeled backfill. Failure only warns.
 report.playbook=postEnabled?await flush(outbox,{siteUrl:playbookUrl,fresh,ref,fetchImpl}):{skipped:'BIG_VIN_PLAYBOOK_POST is not 1; documents stay queued in the outbox.'};
 return report;
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const requested=process.argv.find(a=>a.startsWith('--sport='))?.slice(8);
 const report=await main({sports:requested?[requested]:undefined});
 if(report.playbook?.error)console.log(`::warning title=Playbook posting::${report.playbook.error} Documents stay queued in the checkpoint outbox.`);
 for(const s of report.sports){if(s.error)console.log(`::warning title=Shadow ${s.sport}::${s.error}`);for(const w of s.warnings||[])console.log(`::warning title=Shadow ${s.sport}::${w}`);}
 console.log(JSON.stringify(report,null,1));
}
