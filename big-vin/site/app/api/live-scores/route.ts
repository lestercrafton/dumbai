import {scoreboardUrls,normalizeScoreboard,SPORT_PATHS} from '@/lib/feeds/adapter.mjs';
const FIELDS=['id','status','statusDescription','statusName','statusDetail','statusShortDetail','period','clock','scoreObservedAt','outs','isTopInning','liveHomeScore','liveAwayScore','homeScore','awayScore'];
// Live scores read server-side for the card overlay; browsers can be refused by the scoreboard host.
export async function GET(request:Request){
 const p=new URL(request.url).searchParams,sport=p.get('sport')||'',date=p.get('date')||'',endDate=p.get('endDate')||date;
 if(!Object.hasOwn(SPORT_PATHS,sport)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{4}-\d{2}-\d{2}$/.test(endDate))return Response.json({error:'Choose a sport and date.'},{status:400});
 const urls:string[]=scoreboardUrls(sport,{startDate:date,endDate});
 const now=new Date().toISOString();
 const games=(await Promise.allSettled(urls.map(async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error(String(r.status));
  const raw:any=await r.json();return normalizeScoreboard({...raw,events:(raw.events||[]).map((e:any)=>({...e,scoreObservedAt:now}))},sport,{retrievedAt:now,sourceUrl:url}).games;})))
  .flatMap(x=>x.status==='fulfilled'?x.value:[]).filter((g:any)=>g.status==='live'||g.status==='completed')
  .map((g:any)=>Object.fromEntries(FIELDS.map(k=>[k,g[k]])));
 return Response.json({games},{headers:{'Cache-Control':'public, max-age=20'}});
}
