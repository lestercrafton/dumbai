/** Append-only timestamped odds snapshots for every Big Vin market (spread, total, moneyline).
 * Files: playbook/odds/<sport>/<YYYY-MM>.jsonl (month of capture).
 *  - type 'odds': a game's first-seen market and every later change, with the hours before start.
 *  - type 'refresh': one line per run listing games whose market was re-checked and unchanged,
 *    so every hourly refresh is on record without repeating the prices.
 *  - type 'close': the last snapshot observed before the start, written once after the start.
 * Nothing is rewritten; corrections would be new lines.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const ODDS_DIR=fileURLToPath(new URL('../../playbook/odds',import.meta.url));
const FIELDS=['homeSpread','awaySpread','homeSpreadPrice','awaySpreadPrice','total','overPrice','underPrice','homeMoneyline','awayMoneyline','openHomeSpread','openTotal'];
const num=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
const month=at=>new Date(at).toISOString().slice(0,7);

export function phase(hoursToStart,first){
 if(first)return 'first-seen';
 return hoursToStart>=72?'early-72h+':hoursToStart>=24?'early-24-72h':hoursToStart>=6?'day-of-6-24h':hoursToStart>=1?'late-1-6h':'final-hour';
}
export function marketOf(game){
 const m=game?.moneylineMarket;if(!m)return null;
 const out={provider:m.provider??null,providerId:m.providerId??null,observedAt:m.observedAt??null,providerUpdatedAt:m.providerUpdatedAt??null,timing:m.timing??null};
 for(const f of FIELDS)out[f]=num(m[f]);
 return FIELDS.some(f=>out[f]!==null)?out:null;
}
const same=(a,b)=>FIELDS.every(f=>a[f]===b[f])&&a.provider===b.provider;

export function readOdds(sport,{dir=ODDS_DIR,months}={}){
 const d=path.join(dir,sport);if(!fs.existsSync(d))return [];
 const files=fs.readdirSync(d).filter(f=>f.endsWith('.jsonl')&&(!months||months.includes(f.slice(0,7)))).sort();
 return files.flatMap(f=>fs.readFileSync(path.join(d,f),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)));
}
/** Latest priced snapshot per game, from odds lines. */
export function latestByGame(lines){
 const m=new Map();for(const l of lines)if(l.type==='odds')m.set(l.gameId,l);return m;
}

/** New lines for one run. games are slate games; lines are what is already on file. */
export function snapshotRun(sport,games,lines,{at=new Date().toISOString(),source}={}){
 const latest=latestByGame(lines),closed=new Set(lines.filter(l=>l.type==='close').map(l=>l.gameId));
 const lastRefresh=new Map();for(const l of lines)if(l.type==='refresh')for(const id of l.gameIds)lastRefresh.set(id,l.at);
 const out=[],unchanged=[];
 for(const g of games){
  const start=Date.parse(g.startTime);if(!Number.isFinite(start))continue;
  const prev=latest.get(g.id);
  if(start<=Date.parse(at)){
   // Started: freeze the last pregame snapshot once.
   if(prev&&!closed.has(g.id)){
    const confirmed=[prev.at,lastRefresh.get(g.id)].filter(t=>t&&Date.parse(t)<start).sort().at(-1);
    out.push({type:'close',id:`close:${sport}:${g.id}`,at,sport,gameId:g.id,startTime:g.startTime,fromSnapshot:prev.id,lastConfirmedPregameAt:confirmed??prev.at,
     minutesBeforeStart:confirmed?Math.round((start-Date.parse(confirmed))/60000):null,market:prev.market,
     basis:'Last market the runner saw before the start. Runs are not continuous, so this approximates the true close.'});
   }
   continue;
  }
  const market=marketOf(g);if(!market)continue;
  if(prev&&same(prev.market,market)){unchanged.push(g.id);continue;}
  const hours=(start-Date.parse(at))/3600000;
  out.push({type:'odds',id:`odds:${sport}:${g.id}:${at}`,at,sport,gameId:g.id,startTime:g.startTime,hoursToStart:Math.round(hours*100)/100,phase:phase(hours,!prev),
   previous:prev?.id??null,home:g.home?.abbreviation??g.home?.name??null,away:g.away?.abbreviation??g.away?.name??null,market,source});
 }
 if(unchanged.length)out.push({type:'refresh',id:`refresh:${sport}:${at}`,at,sport,gameIds:unchanged,source});
 return out;
}
export function appendOdds(sport,newLines,{dir=ODDS_DIR}={}){
 const byMonth=new Map();for(const l of newLines){const k=month(l.at);if(!byMonth.has(k))byMonth.set(k,[]);byMonth.get(k).push(l);}
 for(const [k,ls] of byMonth){const f=path.join(dir,sport,k+'.jsonl');fs.mkdirSync(path.dirname(f),{recursive:true});fs.appendFileSync(f,ls.map(l=>JSON.stringify(l)).join('\n')+'\n');}
}
/** Market observations in the shape the shadow ledger uses (spread only). */
export function spreadObservations(lines){
 return lines.filter(l=>l.type==='odds'&&l.market.homeSpread!==null).map(l=>({id:l.id,gameId:l.gameId,sport:l.sport,at:l.at,startTime:l.startTime,provider:l.market.provider,observedAt:l.market.observedAt??l.at,homeSpread:l.market.homeSpread,homeSpreadPrice:l.market.homeSpreadPrice,awaySpreadPrice:l.market.awaySpreadPrice}));
}
/** Spread line as of a moment (last snapshot at or before t). */
export function spreadAt(lines,gameId,t){
 let best=null;for(const l of lines)if(l.type==='odds'&&l.gameId===gameId&&Date.parse(l.at)<=Date.parse(t)&&l.market.homeSpread!==null)best=l;
 return best;
}
