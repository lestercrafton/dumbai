/** Tuesday scoreboard: live-formula mirror versus each challenger, per sport, plus a short lessons entry.
 * Output follows the site contract (schema big-vin-scoreboard/1). Decisions are never automatic.
 */
import {compare} from './promotion.mjs';
import {versionRecords,summarize} from './shadow-ledger.mjs';
const pct=v=>typeof v==='number'?(v*100).toFixed(1)+'%':'n/a';
const pts=v=>typeof v==='number'?(v>=0?'+':'')+v.toFixed(2):'n/a';
const record=s=>({wins:s.wins,losses:s.losses,pushes:s.pushes,pending:s.pending,pricedPicks:s.priced,units:Math.round(s.units*100)/100,roi:s.roi,clv:s.meanClv,clvCoverage:s.clvCoverage,bankroll:s.bankroll?.balance??null});
export function tuesdayOf(at,tz='America/Chicago'){
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
 const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+((2-d.getUTCDay()+7)%7));return d.toISOString().slice(0,10);
}
export function buildScoreboard(eventsBySport,manifest,{at=new Date().toISOString()}={}){
 const publishedFor=tuesdayOf(at);const monday=new Date(Date.parse(publishedFor+'T12:00:00Z')-8*86400000).toISOString().slice(0,10);
 const entries=[],won=[],lost=[],kept=[],dropped=[],lessons=[];
 for(const [sport,events] of Object.entries(eventsBySport)){
  const control=manifest.bigVin.sports[sport]?.version;if(!control)continue;
  const live=summarize(versionRecords(events,control));
  entries.push({versionId:control,role:'frozen',sport,decision:'kept',record:record(live),note:`Runner mirror of ${manifest.bigVin.sports[sport].liveModel}.`});kept.push(control);
  for(const row of compare(events,manifest,sport)){
   const a=row.challengerSummary;
   const decision=row.decision==='retain-control'?'dropped':'continuing';
   entries.push({versionId:row.challenger,role:'challenger',sport,decision,record:record(a),
    note:`${row.note} Sample ${row.checks.gradedPicks.have}/${row.checks.gradedPicks.need} graded, ${row.checks.discordantPicks.have}/${row.checks.discordantPicks.need} disagreements, ${row.checks.weeks.have}/${row.checks.weeks.need} weeks.`.slice(0,2000)});
   (decision==='dropped'?dropped:kept).push(row.challenger);
   if(a.priced&&row.controlSummary.priced){
    const line=`${sport.toUpperCase()} ${row.feature}: ROI ${pct(a.roi)} vs live ${pct(row.controlSummary.roi)}, CLV ${pts(a.meanClv)} vs ${pts(row.controlSummary.meanClv)} on ${a.priced} priced picks.`;
    (row.checks.roi.ok&&row.checks.clv.ok?won:lost).push(line);
   }
   if(row.decision==='eligible-for-promotion')lessons.push(`${row.challenger} meets the registered rule; it needs Lester's decision and a new dated version before it goes live.`);
  }
 }
 if(!lessons.length)lessons.push(won.length+lost.length?'No challenger has met the registered minimum sample yet; weekly differences are descriptive only.':'Forward records are still collecting; nothing has been graded yet.');
 lessons.push('Parameter reshuffles are not tested here: the 2021-2026 NFL walk-forward showed they do not persist. Challengers use injury timing, line movement and weather.');
 const scoreboard={schema:'big-vin-scoreboard/1',id:`scoreboard-${publishedFor}`,weekKey:monday,publishedFor,liveVersionId:'v1',
  summary:`Playbook v1 forward record through ${at.slice(0,10)}. ${lessons[0]}`.slice(0,4000),won:won.slice(0,50),lost:lost.slice(0,50),kept:[...new Set(kept)].slice(0,50),dropped:[...new Set(dropped)].slice(0,50),lessonEntryId:null,
  entries:entries.slice(0,100),supersedes:null};
 const md=[`# Big Vin playbook scoreboard for Tuesday ${publishedFor}`,'',`Generated ${at}. Paper results, entertainment only.`,'',
  '| Sport | Version | Role | Decision | W-L-P | Priced | ROI | CLV (pts) | CLV coverage |','|---|---|---|---|---|---|---|---|---|',
  ...entries.map(e=>`| ${e.sport} | ${e.versionId} | ${e.role} | ${e.decision} | ${e.record.wins}-${e.record.losses}-${e.record.pushes} | ${e.record.pricedPicks} | ${pct(e.record.roi)} | ${pts(e.record.clv)} | ${pct(e.record.clvCoverage)} |`),
  '','## Lessons',...lessons.map(l=>'- '+l)].join('\n')+'\n';
 return {scoreboard,lessons,markdown:md};
}
