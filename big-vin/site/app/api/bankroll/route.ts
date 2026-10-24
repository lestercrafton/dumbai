import {readForecastRecords} from '@/lib/result-store';
import {selectTrackedHistory} from '@/lib/tracked-history.mjs';
import {historicalModelSpecs} from '@/lib/model-versions';
import {replayKellyBankroll} from '@/lib/kelly-bankroll.mjs';
import {SUPPORTED_SPORTS,sportLabel} from '@/lib/presentation.mjs';
export async function GET(request:Request){
 const calibration=new URL(request.url).searchParams.get('calibration')==='1';
 try{
  const sports=await Promise.all(SUPPORTED_SPORTS.map(async(sport:string)=>{
   const {records}=selectTrackedHistory(await readForecastRecords(sport),{sport,models:historicalModelSpecs(sport)});
   const replay=replayKellyBankroll(records);
   // Thin the chart to at most 120 points.
   const step=Math.max(1,Math.ceil(replay.series.length/120));
   const {rows,...rest}=replay;
   return {sport,...rest,...(calibration?{rows}:{}),series:rest.series.filter((pt:any,i:number)=>pt.reup||i%step===0||i===rest.series.length-1)};
  }));
  return Response.json({sports},{headers:{'Cache-Control':'public, max-age=300'}});
 }catch(e){console.error('Bankroll read failed',e);return Response.json({error:'Bankroll is temporarily unavailable.'},{status:503});}
}
