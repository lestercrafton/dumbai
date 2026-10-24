import {readForecastRecords} from '@/lib/result-store';
import {selectTrackedHistory} from '@/lib/tracked-history.mjs';
import {historicalModelSpecs} from '@/lib/model-versions';
import {replayKellyBankroll} from '@/lib/kelly-bankroll.mjs';
import {SUPPORTED_SPORTS,sportLabel} from '@/lib/presentation.mjs';
export async function GET(){
 try{
  const sports=await Promise.all(SUPPORTED_SPORTS.map(async(sport:string)=>{
   const {records}=selectTrackedHistory(await readForecastRecords(sport),{sport,models:historicalModelSpecs(sport)});
   const replay=replayKellyBankroll(records);
   // Thin the chart to at most 120 points.
   const step=Math.max(1,Math.ceil(replay.series.length/120));
   return {sport,...replay,series:replay.series.filter((_,i)=>i%step===0||i===replay.series.length-1)};
  }));
  return Response.json({sports},{headers:{'Cache-Control':'public, max-age=300'}});
 }catch(e){console.error('Bankroll read failed',e);return Response.json({error:'Bankroll is temporarily unavailable.'},{status:503});}
}
