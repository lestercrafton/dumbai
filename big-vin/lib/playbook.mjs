/** Playbook versions: the frozen live control per sport plus registered challengers.
 * Challengers only add information the market may not have priced yet (news timing, line movement, weather).
 */
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
export const MANIFEST_PATH=fileURLToPath(new URL('../../playbook/versions.json',import.meta.url));
export function loadManifest(file=MANIFEST_PATH){return JSON.parse(fs.readFileSync(file,'utf8'));}
const finite=x=>typeof x==='number'&&Number.isFinite(x);

/** Control first, then challengers that were registered before this capture. */
export function variantsFor(manifest,sport,at){
 const control=manifest.bigVin.sports[sport];if(!control)return [];
 if(Date.parse(at)<Date.parse(manifest.startDate+'T00:00:00-05:00'))return [];
 return [{version:control.version,role:'control',feature:null,parameters:null,liveModel:control.liveModel},
  ...manifest.challengers.filter(c=>c.sport===sport&&c.status!=='retired'&&Date.parse(c.registeredAt)<=Date.parse(at)).map(c=>({...c,role:'challenger'}))];
}
export const NEEDS={'qb-out-unpriced':'players','scorer-out-unpriced':'players','line-move':'market','weather-severe':'weather'};

/** Out-player adjustment reduced by any line move toward that result since the news. */
function unpricedOut({players,parameters,market,lineAt},points,label){
 const adjustments=[];let delta=0;
 for(const side of ['home','away'])for(const p of players?.[side]?.players||[])if(p.out){
  const ev=p.evidence.filter(e=>e.effectiveOut);
  const times=ev.map(e=>e.reported??e.published).filter(t=>Number.isFinite(Date.parse(t))).sort();
  const newsAt=times[0]??null;
  const before=newsAt&&lineAt?lineAt(newsAt):null;
  const prior=finite(before?.homeSpread)?before:finite(market?.openHomeSpread)?{homeSpread:market.openHomeSpread,at:null,basis:'feed-open-line'}:null;
  const now=market?.homeSpread;
  // Positive move = line moved against home (home spread rose).
  const moved=finite(prior?.homeSpread)&&finite(now)?now-prior.homeSpread:null;
  const pricedIn=moved===null?0:Math.max(0,side==='home'?moved:-moved);
  const remaining=Math.max(0,points-pricedIn);const effect=side==='home'?-remaining:remaining;delta+=effect;
  adjustments.push({input:label,team:side,player:p.name,athleteId:p.athleteId,fullEffect:points,newsAt,
   lineBeforeNews:prior?{homeSpread:prior.homeSpread,at:prior.at??null,basis:prior.basis??'runner-odds-log'}:null,currentHomeSpread:finite(now)?now:null,
   lineMoveTowardNews:pricedIn,effectOnHomeMargin:effect,
   evidence:ev.map(e=>({source:e.source,url:e.url,observedAt:e.observedAt,reported:e.reported??e.published??null,status:e.status??null,headline:e.headline??null}))});
 }
 return {delta,adjustments};
}
export const FEATURES={
 'qb-out-unpriced':ctx=>unpricedOut(ctx,ctx.parameters.starterOutPoints,'Season passing leader out'),
 'scorer-out-unpriced':ctx=>unpricedOut(ctx,ctx.parameters.pointsPerPlayer,'Season scoring leader out'),
 // Credit the market's move from the earliest known line: smart early money is information.
 'line-move':({market,parameters,firstSeen})=>{
  const open=finite(market?.openHomeSpread)?{homeSpread:market.openHomeSpread,basis:'feed-open-line'}:finite(firstSeen?.homeSpread)?{homeSpread:firstSeen.homeSpread,basis:'runner-first-seen',at:firstSeen.at}:null;
  if(!open||!finite(market?.homeSpread))return {delta:0,adjustments:[],note:'No earlier line to compare.'};
  const move=market.homeSpread-open.homeSpread;
  if(Math.abs(move)<parameters.minMovePoints)return {delta:0,adjustments:[],note:`Move ${move} is under ${parameters.minMovePoints} points.`};
  const effect=-move*parameters.credit;
  return {delta:effect,adjustments:[{input:'Spread movement since the earliest known line',openHomeSpread:open.homeSpread,openBasis:open.basis,openAt:open.at??null,currentHomeSpread:market.homeSpread,currentObservedAt:market.observedAt??null,move,effectOnHomeMargin:effect}]};
 },
 // Bad weather lowers scoring, which compresses margins toward zero.
 'weather-severe':({base,weather,parameters})=>{
  if(weather?.status!=='ok'||!weather.severe)return {delta:0,adjustments:[],note:weather?.status==='ok'?'No severe conditions.':`Weather ${weather?.status??'unavailable'}.`};
  const effect=-base.predictedMargin*parameters.marginShrink;
  return {delta:effect,adjustments:[{input:'Kickoff-hour forecast',flags:weather.flags,windMph:weather.windMph,gustMph:weather.gustMph,precipitationIn:weather.precipitationIn,temperatureF:weather.temperatureF,source:weather.source,url:weather.url,observedAt:weather.observedAt,forecastFor:weather.forecastFor,effectOnHomeMargin:effect}]};
 },
};

/** Build one version's prediction and reasoning record for a game. */
export function predict(variant,{base,players,market,lineAt,firstSeen,weather}){
 const inputs={baseModel:base.version,basePredictedHomeMargin:base.predictedMargin,baseSource:base.source,baseAsOf:base.asOf??null};
 if(variant.role==='control'||!finite(base.predictedMargin))return {predictedMargin:base.predictedMargin,reasoning:{feature:null,inputs,adjustments:[],totalAdjustment:0}};
 const r=FEATURES[variant.feature]({base,players,market,lineAt,firstSeen,weather,parameters:variant.parameters});
 if(NEEDS[variant.feature]==='players')inputs.keyPlayers=['home','away'].map(side=>({team:side,players:(players?.[side]?.players||[]).map(p=>({name:p.name,athleteId:p.athleteId,leader:p.leader,leaderSource:p.source,out:p.out})),inputs:players?.[side]?.inputs??null,note:players?.[side]?.note??null}));
 if(NEEDS[variant.feature]==='weather')inputs.weather=weather?{status:weather.status,venue:weather.venue?.name??null,flags:weather.flags??[],source:weather.source??null,observedAt:weather.observedAt??null}:null;
 return {predictedMargin:base.predictedMargin+r.delta,reasoning:{feature:variant.feature,parameters:variant.parameters,inputs,adjustments:r.adjustments,totalAdjustment:r.delta,note:r.note??null}};
}
