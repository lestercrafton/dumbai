import {slimSlateForClient} from '@/lib/slate-client-payload.mjs';
import {sportsDay} from '@/lib/time';
import {getSlate,persistFinals} from '@/lib/feeds/service';
export async function GET(request:Request){
 const p=new URL(request.url).searchParams;const sport=p.get('sport')||'nfl';const date=p.get('date')||sportsDay();
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)return Response.json({error:'Choose a valid date.'},{status:400});
 try{return Response.json(slimSlateForClient(await getSlate(sport,date,undefined,p.get('days')==='1'?1:p.get('days')==='3'?3:7)));}catch(e){return Response.json({error:e instanceof Error?e.message:'Unable to load the slate. Try again.'},{status:503});}
}

import {normalizeScoreboard,scoreboardUrl,scoreboardUrls,SPORT_PATHS} from '@/lib/feeds/adapter.mjs';
import {sameOrigin} from '@/lib/db';
import {authorizedCollector} from '@/lib/admin';
export async function POST(request:Request){
 if(!sameOrigin(request))return Response.json({error:'Invalid origin'},{status:403});
 try{const v:any=await request.json();if(!Object.hasOwn(SPORT_PATHS,v.sport)||!/^\d{4}-\d{2}-\d{2}$/.test(v.date)||!Array.isArray(v.payload?.events)||v.payload.events.length>1000)return Response.json({error:'Invalid scoreboard.'},{status:400});
 const days=v.days===1?1:v.days===3?3:7;
 const endDate=new Date(Date.parse(v.date+'T00:00:00Z')+(days-1)*86400000).toISOString().slice(0,10);
 const dailyUrls=days===3?scoreboardUrls(v.sport,{startDate:v.date,endDate,weekendDaily:true}):[];
 const normalized=normalizeScoreboard(v.payload,v.sport,{sourceUrl:dailyUrls[0]||scoreboardUrl(v.sport,{startDate:v.date,endDate:v.sport==='cbb'?v.date:endDate})});
 if(days===3){
  const rawEvents=new Map(v.payload.events.map((event:any)=>[String(event.id),event]));
  for(const game of normalized.games)if(game.startTime){
   const observed:any=rawEvents.get(game.id);
   const sourceDate=typeof observed?.scoreboardSourceDate==='string'&&/^\d{8}$/.test(observed.scoreboardSourceDate)?observed.scoreboardSourceDate:sportsDay(game.startTime).replaceAll('-','');
   const choices=dailyUrls.filter((url:string)=>new URL(url).searchParams.get('dates')===sourceDate);
   game.sourceUrl=choices.find((url:string)=>v.sport!=='cfb'||new URL(url).searchParams.get('groups')===String(observed?.scoreboardSourceGroup))||choices[0]||normalized.sourceUrl;
  }
 }else if(v.sport==='cbb')for(const game of normalized.games)if(game.startTime)game.sourceUrl=scoreboardUrl('cbb',{startDate:sportsDay(game.startTime)});
 const partialLiveCoverage=(days===3||v.sport==='cfb')&&v.payload.partialLiveCoverage===true;
 const partialWarning=v.sport==='cfb'?'Some college-football date/group checks failed or reached the response limit; coverage may be incomplete.':'Some weekend single-date feeds were unavailable; available games are shown and the three-day schedule may be incomplete.';
 const sourceUrls=days===3?dailyUrls.filter((url:string)=>Array.isArray(v.payload.sourceUrls)&&v.payload.sourceUrls.includes(url)):undefined;
 const board={...normalized,...(sourceUrls?{sourceUrls}:{}),partialLiveCoverage,warnings:[...normalized.warnings,...(partialLiveCoverage?[partialWarning]:[])]};
 const extra=Array.isArray(v.historyPayloads)?v.historyPayloads.slice(0,8):[];
 const historical=extra.filter((p:any)=>Array.isArray(p.events)&&p.events.length<=1000).map((p:any)=>normalizeScoreboard(p,v.sport));
 // Public browser payloads may power a preview, but cannot change the research history.
 if(await authorizedCollector(request))await persistFinals(v.sport,[board,...historical]);
 return Response.json(slimSlateForClient(await getSlate(v.sport,v.date,board,days)));
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Could not evaluate the slate.'},{status:503});}
}
