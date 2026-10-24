import {totalsTable} from '@/lib/feeds/service';
import {sportsDay} from '@/lib/time';
import {TOTALS_RECORD_SPORTS,summarizeTotalGames,totalsHasPicks,totalsRecordDays} from '@/lib/totals-record.mjs';

export async function GET(request:Request){
 const sport=new URL(request.url).searchParams.get('sport')||'';
 if(!TOTALS_RECORD_SPORTS.includes(sport))return Response.json({error:'Totals record is not available for this sport.'},{status:400});
 const table=await totalsTable(sport);
 if(!table)return Response.json({error:'Totals table unavailable.'},{status:503});
 const games=Object.entries(table.games||{}).map(([id,g]:[string,any])=>({id,...g}));
 const days=totalsRecordDays(games,sportsDay);
 const overall=summarizeTotalGames(games);
 return Response.json({
  sport,
  view:'totals-record',
  hasPicks:totalsHasPicks(table),
  generatedAt:table.generatedAt??null,
  version:table.version??null,
  record:table.record??null,
  days,
  overall,
 });
}
