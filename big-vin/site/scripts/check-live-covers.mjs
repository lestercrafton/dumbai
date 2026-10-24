// Health check for the live cover boxes. If ESPN shows games in progress, the
// deployed /api/live-scores must return them with fresh scores, otherwise the
// cards lose "Covering by / Needs X to cover". Exits 1 on failure.
import {liveScoreUrls} from '../lib/live-scores.mjs';
const site=process.env.BV_SITE||'https://big-vin.lestercrafton.workers.dev';
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
let failed=false;
for(const sport of ['cfb','nfl','nba','wnba','cbb','nhl','mlb']){
 const espn=(await Promise.all(liveScoreUrls(sport,today).map(u=>fetch(u).then(r=>r.ok?r.json():{events:[]}).catch(()=>({events:[]})))))
  .flatMap(p=>p.events||[]).filter(e=>e.status?.type?.state==='in').map(e=>String(e.id));
 if(!espn.length){console.log(`${sport}: no games in progress`);continue;}
 const r=await fetch(`${site}/api/live-scores?sport=${sport}&date=${today}&endDate=${today}`);
 const got=r.ok?(await r.json()).games||[]:[];
 const live=got.filter(g=>espn.includes(String(g.id))&&Number.isFinite(g.liveHomeScore)&&Date.now()-Date.parse(g.scoreObservedAt)<10*60000);
 const ok=live.length===espn.length;
 console.log(`${sport}: ${espn.length} in progress, ${live.length} with fresh live scores ${ok?'OK':'FAIL'}`);
 if(!ok)failed=true;
}
if(failed){console.error('Live cover boxes would be missing: /api/live-scores is not returning in-progress games.');process.exit(1);}
