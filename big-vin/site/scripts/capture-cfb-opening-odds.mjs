/** Freeze ESPN's archived opening odds for the missed September 26 CFB card.
 * Only opening spread contracts are saved; scores and later/current odds are
 * intentionally excluded. This is a retrospective source capture, not a
 * timestamped record of what this site displayed before each kickoff.
 */
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {makeCfbReconstructedRecords} from '../lib/cfb-reconstructed-records.mjs';

const cohortPath=fileURLToPath(new URL('../lib/college-experiment-cohort-2026-09-26.json',import.meta.url));
const target=fileURLToPath(new URL('../lib/cfb-opening-odds-2026-09-26.json',import.meta.url));
const cohort=JSON.parse(fs.readFileSync(cohortPath,'utf8'));
if(cohort.date!=='2026-09-26'||cohort.games?.length!==80)throw new Error('Expected the frozen 80-game September 26 cohort.');
const margins=new Map(makeCfbReconstructedRecords(cohort,new Date().toISOString()).map(record=>[record.gameId,record.predictedMargin]));
const unpricedIds=new Set(['401870839','401868243','401868308']);
const oddsBase='https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/events';

function number(value,label,{american=false}={}){
 if(typeof value!=='string'||!/^[+-]?\d+(?:\.\d+)?$/.test(value))throw new Error(`Missing or invalid ${label}: ${value}`);
 const parsed=Number(value);
 if(!Number.isFinite(parsed)||(american&&(!Number.isInteger(parsed)||Math.abs(parsed)<100)))throw new Error(`Invalid ${label}: ${value}`);
 return parsed;
}
async function read(url){
 const response=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error(`ESPN core odds HTTP ${response.status}: ${url}`);
 const body=await response.json();
 return {body,retrievedAt:new Date().toISOString()};
}
function teamId(offer){return String(offer?.team?.$ref||'').match(/\/teams\/(\d+)/)?.[1]||null;}

let index=0;
const entries=[];
await Promise.all(Array.from({length:8},async()=>{
 while(index<cohort.games.length){
  const game=cohort.games[index++];
  const eventId=String(game.id);
  const sourceUrl=`${oddsBase}/${eventId}/competitions/${eventId}/odds?lang=en&region=us`;
  const {body,retrievedAt}=await read(sourceUrl);
  const offers=body.items||[];
  if(body.count!==offers.length)throw new Error(`Incomplete ESPN odds page for ${eventId}.`);
  const primary=offers.filter(item=>item.provider?.id==='100'&&item.provider?.name==='DraftKings');
  if(primary.length>1||(!primary.length&&offers.length))throw new Error(`Missing or ambiguous ESPN opening quote for ${eventId}.`);
  const offer=primary[0];
  const base={eventId,sourceUrl,sourceRetrievedAt:retrievedAt};
  if(!offer){
   if(!unpricedIds.has(eventId))throw new Error(`Unexpected unpriced event ${eventId}.`);
   entries.push({...base,provider:null,homeOpeningSpread:null,awayOpeningSpread:null,homeOpeningPrice:null,awayOpeningPrice:null});
   continue;
  }
  if(unpricedIds.has(eventId)||offer.provider?.name!=='DraftKings')throw new Error(`Unexpected sportsbook for ${eventId}.`);
  if(teamId(offer.homeTeamOdds)!==String(game.home.id)||teamId(offer.awayTeamOdds)!==String(game.away.id))throw new Error(`ESPN odds teams differ from frozen event ${eventId}.`);
  const homeOpeningSpread=number(offer.homeTeamOdds?.open?.pointSpread?.american,`${eventId} home opening spread`);
  const awayOpeningSpread=number(offer.awayTeamOdds?.open?.pointSpread?.american,`${eventId} away opening spread`);
  const homeOpeningPrice=number(offer.homeTeamOdds?.open?.spread?.american,`${eventId} home opening price`,{american:true});
  const awayOpeningPrice=number(offer.awayTeamOdds?.open?.spread?.american,`${eventId} away opening price`,{american:true});
  if(Math.abs(homeOpeningSpread+awayOpeningSpread)>1e-9)throw new Error(`Nonreciprocal ESPN opening spreads for ${eventId}.`);
  if(Math.abs(margins.get(eventId)+homeOpeningSpread)<1e-9)throw new Error(`No model point edge against the opening spread for ${eventId}.`);
  entries.push({...base,provider:offer.provider.name,homeOpeningSpread,awayOpeningSpread,homeOpeningPrice,awayOpeningPrice});
 }
}));

if(entries.length!==80||new Set(entries.map(entry=>entry.eventId)).size!==80||entries.filter(entry=>entry.provider!==null).length!==77||entries.filter(entry=>entry.provider===null).length!==3)throw new Error('Opening-odds coverage differs from the expected 77 priced and 3 unpriced events.');
entries.sort((a,b)=>a.eventId.localeCompare(b.eventId));
const fixture={date:cohort.date,capturedAt:new Date().toISOString(),source:'ESPN core competition odds, DraftKings opening spread quotes',entries};
fs.writeFileSync(target,JSON.stringify(fixture)+'\n');
console.log(JSON.stringify({target,capturedAt:fixture.capturedAt,events:entries.length,priced:77,unpriced:3,zeroOpeningEdges:0}));
