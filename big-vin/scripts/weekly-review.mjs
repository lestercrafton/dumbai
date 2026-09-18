import {collectorConfig,collectorAuthorization} from '../lib/collector-access.mjs';
import fs from 'node:fs';
import {SPORT_PATHS} from '../lib/feeds/adapter.mjs';
import os from 'node:os';
import path from 'node:path';
const config=collectorConfig();
const site=process.env.BIG_VIN_SITE_URL||config.url;
const apply=process.argv.includes('--apply');
async function api(route,body){const r=await fetch(site+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:await collectorAuthorization(config)},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});const v=await r.json();if(!r.ok)throw new Error(v.error||`Site error ${r.status}`);return v;}
const fmt=(v,n=2)=>typeof v==='number'?v.toFixed(n):'unavailable';
const today=new Date().toISOString().slice(0,10);const log=(await api('/api/learning')).entries;
const output=[];const allPaired=[];
for(const sport of Object.keys(SPORT_PATHS)){
 const overview=await api(`/api/results?sport=${sport}&cohort=live`);
 // Evaluate only saved records. Missing games stay visible as missing coverage.
 for(const version of overview.versions){
 const versionOverview=await api(`/api/results?sport=${sport}&cohort=live&version=${encodeURIComponent(version.id)}`);
 for(const week of versionOverview.weeks){
  if(!week.graded)continue;
  const data=await api(`/api/results?sport=${sport}&cohort=live&week=${encodeURIComponent(week.key)}&version=${encodeURIComponent(version.id)}`);
  if(['nfl','cfb'].includes(sport))for(const f of data.records)if(f.shadow?.eligible&&f.result?.status==='completed'&&Number.isFinite(f.shadow.predictedMargin))allPaired.push({...f,shadowError:Math.abs(f.result.actualMargin-f.shadow.predictedMargin)});
  if([...data.records,...data.missing].some(f=>Date.parse(f.startTime)>Date.now()))continue;
  const id=`weekly-${sport}-${week.key.toLowerCase()}${version.id==='ridge-v1'?'':'-'+version.id}`;
  const previous=log.filter(e=>e.id===id||e.id.startsWith(id+'-update-')).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt))[0];
  const s=data.summary;
  const signature=JSON.stringify({graded:s.graded,recorded:s.recorded,w:s.wins,l:s.losses,p:s.pushes,pnl:s.pnl,mae:s.mae,pending:s.pending,missing:data.missing.map(g=>g.id).sort()});
  if(previous?.signature===signature)continue;
  const finals=data.records.filter(f=>f.result?.status==='completed');
  const biggest=[...finals].sort((a,b)=>b.result.absoluteError-a.result.absoluteError).slice(0,3);
  const chronological=[...finals].sort((a,b)=>a.capturedAt.localeCompare(b.capturedAt));const current=chronological.at(-1),first=chronological[0];
  const priors=current?.parameters?[{name:'Half-life',before:`${first.parameters?.halfLifeDays??current.parameters.halfLifeDays} days`,after:`${current.parameters.halfLifeDays} days`,note:'Fixed prior configuration'},{name:'Home-advantage prior',before:fmt(first.parameters?.homePrior??current.parameters.homePrior),after:fmt(current.parameters.homePrior),note:'Do not confuse the prior with the learned coefficient'},{name:'Fitted home advantage',before:fmt(first.homeAdvantage,3),after:fmt(current.homeAdvantage,3),note:'First versus last captured fit this week'}]:[];
  const entry={id:previous?`${id}-update-${Date.now()}`:id,sport,weekKey:week.key,kind:previous?'correction':'review',modelVersion:version.id,signature,title:`${week.key.replace('-W',' · Week ')}: ${s.wins}–${s.losses}–${s.pushes}, with the formula retained`,learned:`${s.graded} final scores from ${s.recorded} saved forecasts; ${s.pending} remain pending. Average model error was ${fmt(s.mae)} points. On ${s.matchedGames} games with both lines, Big Vin averaged ${fmt(s.matchedModelMae)} versus ${fmt(s.marketMae)} for the market. Mean actual-minus-predicted margin was ${fmt(s.bias)} points. These numbers describe the recorded subset and do not establish a causal explanation for its misses.`,decision:`Continue measuring ${version.label} under its recorded parameters. New verified scores update future team ratings; prior forecasts remain unchanged. Tuning on known results is recorded separately from this future performance record.`,priors,evidence:[`Coverage: ${s.recorded} forecasts / ${data.knownScheduledGames||s.recorded} known games; ${data.missing.length} without a saved pregame forecast.`,`Hypothetical return at saved prices: ${fmt(s.pnl)} units across ${s.pricedGames} priced finals. No default price is supplied.`,...biggest.map(f=>`${f.away} at ${f.home}: predicted home margin ${fmt(f.predictedMargin)}, actual ${fmt(f.result.actualMargin)}, absolute error ${fmt(f.result.absoluteError)}.`)],nextTest:version.id!=='ridge-v1'?'Compare this formula’s future saved-price return, spread record and line error with its original benchmark. The September 14 hindsight optimization is not counted as a live result.':sport==='nfl'?'Continue the registered no-rest challenger from Week 2. Weekly looks are descriptive; the promotion decision waits until after the 2026 regular season, no earlier than January 12, 2027, with at least 12 eligible weeks and 200 paired finals.':'Continue freezing outcomes and evaluate one prespecified sport-specific challenger on future games before changing the experimental defaults.'};
  output.push({entry,result:apply?await api('/api/learning',entry):'draft'});
 }
}
}
function pairedSummary(rows){const blocks=new Map();for(const f of rows){const b=blocks.get(f.weekKey)||[];b.push(f);blocks.set(f.weekKey,b);}
const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
return rows.length?{games:rows.length,weeks:blocks.size,incumbentMae:mean(rows.map(f=>f.result.absoluteError)),shadowMae:mean(rows.map(f=>f.shadowError)),incumbentRmse:Math.sqrt(mean(rows.map(f=>f.result.residual**2))),shadowRmse:Math.sqrt(mean(rows.map(f=>(f.result.actualMargin-f.shadow.predictedMargin)**2))),promotionAllowedNow:false,note:'Descriptive only. Follow the registered single decision after the 2026 regular season.'}:{games:0,weeks:0,promotionAllowedNow:false};
}
const shadow=Object.fromEntries(['nfl','cfb'].map(sport=>[sport,pairedSummary(allPaired.filter(f=>f.sport===sport))]));
const folder=path.join(os.homedir(),'.local/share/big-vin/reviews');fs.mkdirSync(folder,{recursive:true,mode:0o700});const file=path.join(folder,`${today}-${Date.now()}.json`);fs.writeFileSync(file,JSON.stringify({createdAt:new Date().toISOString(),applied:apply,updates:output,shadow},null,2),{mode:0o600});console.log(JSON.stringify({artifact:file,entries:output.length,applied:apply,shadow},null,2));
