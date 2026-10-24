// Big Vin browser transport; existing one-day and week requests stay intact.
import {scoreboardUrl,scoreboardUrls,isThreeDayScoreboardWindow,scoreboardPayloadLimited,normalizeScoreboard} from '@/lib/feeds/adapter.mjs';
type Row=Record<string,any>;
export async function api(url:string,options?:RequestInit){const r=await fetch(url,options);const v:any=await r.json();if(!r.ok)throw new Error(v.error||'The request could not be completed.');return v;}
const browserCache=new Map<string,{time:number,payload:any}>();
export async function browserBoard(sport:string,startDate:string,endDate?:string){
 const urls=scoreboardUrls(sport,{startDate,endDate,weekendDaily:isThreeDayScoreboardWindow({startDate,endDate})});
 // A cache hit retains the actual network observation time for every score;
 // posting cached events again must not make an old live score look fresh.
 const read=async(url:string)=>{const found=browserCache.get(url);if(found&&Date.now()-found.time<60000)return found.payload;const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('Browser feed unavailable');const raw=await r.json() as Row;const time=Date.now();const query=new URL(url).searchParams;const sourceDate=query.get('dates');const payload={...raw,partialLiveCoverage:scoreboardPayloadLimited(sport,raw,Number(query.get('limit'))),...(Array.isArray(raw.events)?{events:raw.events.map((event:Row)=>({...event,scoreObservedAt:new Date(time).toISOString(),...(sourceDate&&/^\d{8}$/.test(sourceDate)?{scoreboardSourceDate:sourceDate,scoreboardSourceGroup:query.get('groups')}:{} )}))}:{})};browserCache.set(url,{time,payload});return payload;};
 let payloads:any[],partialLiveCoverage=false;
 let successfulSourceUrls:string[]|undefined;
 if(isThreeDayScoreboardWindow({startDate,endDate})){
  const checked=await Promise.allSettled(urls.map(read));
  payloads=checked.flatMap(item=>item.status==='fulfilled'?[item.value]:[]);
  successfulSourceUrls=urls.filter((_url:string,index:number)=>checked[index].status==='fulfilled');
  if(!payloads.length)throw checked.find(item=>item.status==='rejected')?.reason||new Error('Weekend feeds unavailable');
  partialLiveCoverage=checked.some(item=>item.status==='rejected')||payloads.some(payload=>payload.partialLiveCoverage);
 }else try{payloads=await Promise.all(urls.map(read));}
 catch(error){
  if(sport!=='cfb')throw error;
  const compactUrls:string[]=[];
  for(let ms=Date.parse(startDate+'T00:00:00Z');ms<=Date.parse((endDate||startDate)+'T00:00:00Z');ms+=86400000)for(const group of [80,81]){
   const url=new URL(scoreboardUrl('cfb',{startDate:new Date(ms).toISOString().slice(0,10),group}));
   url.searchParams.set('dates',new Date(ms).toISOString().slice(0,10).replaceAll('-',''));
   compactUrls.push(url.toString());
  }
  const checked=await Promise.allSettled(compactUrls.map(read));
  payloads=checked.flatMap(item=>item.status==='fulfilled'?[item.value]:[]);
  if(!payloads.length)throw error;
  partialLiveCoverage=checked.some(item=>item.status==='rejected')||payloads.some(payload=>payload.partialLiveCoverage);
 }
 partialLiveCoverage ||= payloads.some(payload=>payload.partialLiveCoverage);
 return {...payloads[0],partialLiveCoverage,...(successfulSourceUrls?{sourceUrls:successfulSourceUrls}:{}),events:[...new Map(payloads.flatMap(p=>(p.events||[]).map((e:any)=>({...e,season:e.season||p.season,week:e.week||p.week}))).map(e=>[e.id,e])).values()]};
}
export async function fetchSlate(sport:string,date:string,days=1){
 const endDate=new Date(Date.parse(date+'T00:00:00Z')+((days===1?1:days===3?3:7)-1)*86400000).toISOString().slice(0,10);
 // Server observations can persist the current pregame pick before returning
 // it. Browser feeds are a read-only fallback and cannot revise the ledger.
 try{return await withLiveScores(sport,date,endDate,await api(`/api/slate?sport=${sport}&date=${date}&days=${days}`));}
 catch{return api('/api/slate',JsonCall({sport,date,days,payload:await browserBoard(sport,date,endDate)}));}
}
export function JsonCall(body:Row,method='POST'){return {method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};}

const LIVE_FIELDS=['status','statusDescription','statusName','statusDetail','statusShortDetail','period','clock','scoreObservedAt','outs','isTopInning','liveHomeScore','liveAwayScore'];
// The server slate is a cached render, so its live scores age past the
// freshness window between renders. Overlay scores read directly from the
// scoreboard for games that have started and are not final yet.
export async function withLiveScores(sport:string,date:string,endDate:string,slate:any){
 const games:Row[]=Array.isArray(slate?.games)?slate.games:[];
 const now=Date.now();
 const active=games.some(g=>!g.completed&&!g.result?.status&&(g.status==='live'||(Date.parse(g.startTime)<=now&&now-Date.parse(g.startTime)<8*3600000)));
 if(!active)return slate;
 try{
  const fresh=(await api(`/api/live-scores?sport=${sport}&date=${date}&endDate=${endDate}`)).games as Row[];
  const byId=new Map(fresh.map(g=>[String(g.id),g]));
  return {...slate,games:games.map(g=>{const f=byId.get(String(g.id));if(!f||g.completed||g.result?.status||!['live','completed'].includes(f.status))return g;
   // Just finished but not graded yet: keep showing the cover status against the final score.
   if(f.status==='completed')return {...g,status:'live',statusDescription:'Final',statusDetail:'Final',statusShortDetail:'Final',period:f.period,clock:null,scoreObservedAt:f.scoreObservedAt,liveHomeScore:f.homeScore,liveAwayScore:f.awayScore,finalPendingGrade:true};
   return {...g,...Object.fromEntries(LIVE_FIELDS.map(k=>[k,f[k]]))};})};
 }catch{return slate;}
}
