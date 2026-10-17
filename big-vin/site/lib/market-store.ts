import {db} from './db';
import {firstMarketObservation} from './first-market.mjs';

export async function firstMarkets(sport:string){
 const rows=await db().prepare('SELECT m.forecast_id,m.payload FROM first_market_observations m JOIN forecasts f ON f.id=m.forecast_id WHERE f.sport=?').bind(sport).all<{forecast_id:string,payload:string}>();
 return new Map(rows.results.map(r=>[r.forecast_id,JSON.parse(r.payload)]));
}
export async function captureFirstMarkets(sport:string,games:any[],recordedAt:string){
 const rows=await db().prepare('SELECT id,payload FROM forecasts WHERE sport=? AND cohort=? AND start_time>? AND result IS NULL').bind(sport,'live',recordedAt).all<{id:string,payload:string}>();
 const byId=new Map(games.map(g=>[g.id,g]));
 const candidates=[...games].sort((a,b)=>String(a.market?.observedAt).localeCompare(String(b.market?.observedAt)));
 const captures=rows.results.flatMap(row=>{const f=JSON.parse(row.payload),latest=byId.get(f.gameId);if(latest?.status!=='scheduled')return [];
  for(const g of candidates){if(g.id!==f.gameId||g.homeId!==latest.homeId||g.awayId!==latest.awayId)continue;const observation=firstMarketObservation(f,{...g,startTime:latest.startTime},new Date().toISOString());if(observation)return [observation];}return [];
 });
 let inserted=0;
 for(let i=0;i<captures.length;i+=40){const result=await db().batch(captures.slice(i,i+40).map(o=>db().prepare('INSERT INTO first_market_observations (forecast_id,observed_at,recorded_at,payload) VALUES (?,?,?,?) ON CONFLICT(forecast_id) DO NOTHING').bind(o.forecastId,o.observedAt,o.recordedAt,JSON.stringify(o))));inserted+=result.reduce((s,r)=>s+(r.meta.changes??0),0);}
 return inserted;
}
