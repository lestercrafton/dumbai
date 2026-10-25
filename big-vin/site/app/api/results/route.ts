import {readResults} from '@/lib/result-store';
import {refreshLiveResults} from '@/lib/live-results';
import {SPORT_PATHS} from '@/lib/feeds/adapter.mjs';
import {validSeason} from '@/lib/season-record.mjs';
import {calendarRecordWeek} from '@/lib/record-periods.mjs';
import {slimTrackedHistoryForClient} from '@/lib/results-client-payload.mjs';
export async function GET(request:Request){
 const p=new URL(request.url).searchParams;
 const sport=p.get('sport')||'nfl';if(!Object.hasOwn(SPORT_PATHS,sport))return Response.json({error:'Unsupported sport'},{status:400});
 const seasonParam=p.get('season'),season=validSeason(seasonParam);
 if(seasonParam!==null&&season===null)return Response.json({error:'Choose a valid league season.'},{status:400});
 const historyDate=p.get('historyDate');
 if(historyDate!==null&&!calendarRecordWeek(historyDate))return Response.json({error:'Choose a valid history date (YYYY-MM-DD).'},{status:400});
 const anchor=p.get('rankAnchor');const rankAnchor=anchor&&/^\d{4}-\d{2}-\d{2}$/.test(anchor)&&Number.isFinite(Date.parse(anchor+'T00:00:00Z'))&&new Date(anchor+'T00:00:00Z').toISOString().slice(0,10)===anchor?anchor:null;
 const historyOnly=p.get('history')==='1';
 // summary=1 is the board record strip: aggregates only, no multi-MB pick list.
 // Still run the (60s-cached) finals check — skipping it left Day/Week stuck
 // behind live cover boxes during NFL Sundays.
 const summaryOnly=historyOnly&&p.get('summary')==='1';
 try{
  let liveCheck:any;
  try{liveCheck=await refreshLiveResults(sport);}catch(e){console.error('Live finals check failed',e);liveCheck={checkedAt:null,warnings:['Live final-score check unavailable; showing saved results.']};}
  const body=await readResults(sport,p.get('cohort'),p.get('week'),p.get('version'),p.get('rankPeriod')==='day'?'day':'week',rankAnchor,season,historyOnly,historyDate);
  const payload=historyOnly?slimTrackedHistoryForClient(body,{summary:summaryOnly}):body;
  return Response.json({...payload,liveCheck},{headers:{'Cache-Control':summaryOnly?'public, max-age=60':'no-store'}});
 }
 catch(e){console.error('Results read failed',e);return Response.json({error:'Results are temporarily unavailable. Your saved forecasts are preserved.'},{status:503});}
}
