import {db} from './db';
import {advancePickState} from './pick-revisions.mjs';

export async function pickStates(sport:string){
 const rows=await db().prepare('SELECT p.forecast_id,p.payload FROM pick_revision_states p JOIN forecasts f ON f.id=p.forecast_id WHERE f.sport=?').bind(sport).all<{forecast_id:string,payload:string}>();
 return new Map(rows.results.map(r=>[r.forecast_id,JSON.parse(r.payload)]));
}

/** Call only with server-fetched sources or the authenticated collector.
 * CAS serializes overlapping requests; the DB clock enforces the insert boundary. */
export async function capturePickRevisions(forecasts:any[],games:any[]){
 const byGame=new Map(games.map(g=>[g.id,g]));
 let cursor=0;
 await Promise.all(Array.from({length:Math.min(4,forecasts.length)},async()=>{
  while(cursor<forecasts.length){
   const f=forecasts[cursor++],g=byGame.get(f.gameId);if(!g)continue;
   for(let attempt=0;attempt<3;attempt++){
    const row=await db().prepare('SELECT payload FROM pick_revision_states WHERE forecast_id=?').bind(f.id).first<{payload:string}>();
    const previous=row?JSON.parse(row.payload):null;
    const next=advancePickState(f,previous,g,new Date().toISOString());
    if(!next||JSON.stringify(next)===row?.payload)break;
    const addsRevision=next.revisions.length>(previous?.revisions.length??0);
    const payload=JSON.stringify(next);
    const statement=row
     ?db().prepare("UPDATE pick_revision_states SET payload=? WHERE forecast_id=? AND payload=? AND (?=0 OR (julianday('now')<julianday(?) AND EXISTS(SELECT 1 FROM forecasts WHERE id=? AND result IS NULL)))").bind(payload,f.id,row.payload,addsRevision?1:0,next.lockAt,f.id)
     :db().prepare("INSERT INTO pick_revision_states (forecast_id,payload) SELECT ?,? WHERE EXISTS(SELECT 1 FROM forecasts WHERE id=? AND result IS NULL) AND (?=0 OR julianday('now')<julianday(?)) ON CONFLICT(forecast_id) DO NOTHING").bind(f.id,payload,f.id,addsRevision?1:0,next.lockAt);
    const result=await statement.run();if(result.meta.changes)break;
   }
  }
 }));
}
