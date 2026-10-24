// RecordSummary only needs day/week/season aggregates. The full pick list with
// revision histories was ~4MB for CFB alone and left phones stuck parsing JSON.
// tracked-results still wants rows, but not every past revision.
import {slimGame} from './slate-client-payload.mjs';

export function slimTrackedHistoryForClient(history, {summary=false}={}){
 if(!history||typeof history!=='object')return history;
 if(summary){
  if(!('records' in history))return history;
  const {records: _drop, ...rest}=history;
  return rest;
 }
 const records=Array.isArray(history.records)?history.records.map(slimHistoryRecord):history.records;
 return records===history.records?history:{...history,records};
}

export function slimHistoryRecord(record){
 if(!record||typeof record!=='object')return record;
 const slimmed=slimGame(record);
 // parameters / recovery are model internals the pick list never shows
 if(slimmed.parameters==null&&slimmed.recovery==null)return slimmed;
 const {parameters: _p, recovery: _r, ...rest}=slimmed;
 return rest;
}
