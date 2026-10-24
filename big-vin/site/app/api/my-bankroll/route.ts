import {readForecastRecords} from '@/lib/result-store';
import {selectTrackedHistory} from '@/lib/tracked-history.mjs';
import {historicalModelSpecs} from '@/lib/model-versions';
import {replayKellyBankroll} from '@/lib/kelly-bankroll.mjs';
import {SUPPORTED_SPORTS} from '@/lib/presentation.mjs';
import {currentUser,loadStarts} from '@/lib/my-bankroll-session';
import {ctDate} from '@/lib/today-plays.mjs';

function afterEffective(records:any[],effectiveFrom:string|null){
 if(!effectiveFrom)return records;
 return records.filter((r:any)=>r?.startTime&&ctDate(r.startTime)>=effectiveFrom);
}

export async function GET(request:Request){
 try{
  const user=await currentUser(request);
  if(!user)return Response.json({error:'Sign in first.'},{status:401,headers:{'Cache-Control':'no-store'}});
  const {starts,effectiveFrom}=await loadStarts(user.id);
  const only=new URL(request.url).searchParams.get('sport');
  const sports=await Promise.all(SUPPORTED_SPORTS.filter((s:string)=>(!only||s===only)&&starts[s]!=null).map(async(sport:string)=>{
   const start=starts[sport] as number;
   const {records}=selectTrackedHistory(await readForecastRecords(sport),{sport,models:historicalModelSpecs(sport)});
   const replay=replayKellyBankroll(afterEffective(records,effectiveFrom[sport]),{start,includeLegacy:sport==='mlb'});
   const step=Math.max(1,Math.ceil(replay.series.length/120));
   const {rows,bets,...rest}=replay;
   return {
    sport,
    originalStart:start,
    effectiveFrom:effectiveFrom[sport],
    ...rest,
    ...(only?{bets}:{}),
    series:rest.series.filter((pt:any,i:number)=>pt.reup||i%step===0||i===rest.series.length-1),
   };
  }));
  return Response.json({email:user.email,starts,effectiveFrom,sports},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('my-bankroll read',e);return Response.json({error:'My Bankroll is temporarily unavailable.'},{status:503});}
}
