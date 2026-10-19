/** Forward-only promotion check: challenger versus the live control on shared games. */
import {versionRecords,summarize} from './shadow-ledger.mjs';
const finite=x=>typeof x==='number'&&Number.isFinite(x);

export function compare(events,manifest,sport){
 const control=manifest.bigVin.sports[sport]?.version;if(!control)return [];
 const rule=manifest.promotion,min=rule.minimums[sport];
 const controlRecords=versionRecords(events,control);const controlByGame=new Map(controlRecords.map(r=>[r.gameId,r]));
 return manifest.challengers.filter(c=>c.sport===sport).map(c=>{
  // Only games that started after registration: unseen when the challenger was chosen.
  const after=r=>Date.parse(r.startTime)>Date.parse(c.registeredAt);
  const mine=versionRecords(events,c.version).filter(after);
  const games=new Set([...mine.map(r=>r.gameId),...controlRecords.filter(after).map(r=>r.gameId)]);
  const theirs=controlRecords.filter(r=>games.has(r.gameId));
  const mineByGame=new Map(mine.map(r=>[r.gameId,r]));
  const discordant=[...games].filter(id=>mineByGame.get(id)?.side!==controlByGame.get(id)?.side&&(mineByGame.get(id)?.result||controlByGame.get(id)?.result)).length;
  const a=summarize(mine),b=summarize(theirs);
  const checks={
   gradedPicks:{need:min.gradedPicks,have:a.priced,ok:a.priced>=min.gradedPicks},
   discordantPicks:{need:min.discordantPicks,have:discordant,ok:discordant>=min.discordantPicks},
   weeks:{need:min.weeks,have:a.weeks,ok:a.weeks>=min.weeks},
   clvCoverage:{need:0.8,have:a.clvCoverage,ok:finite(a.clvCoverage)&&a.clvCoverage>=0.8},
   roi:{challenger:a.roi,control:b.roi,ok:finite(a.roi)&&finite(b.roi)&&a.roi>b.roi},
   clv:{challenger:a.meanClv,control:b.meanClv,ok:finite(a.meanClv)&&finite(b.meanClv)&&a.meanClv>b.meanClv},
  };
  const sampleMet=checks.gradedPicks.ok&&checks.discordantPicks.ok&&checks.weeks.ok&&checks.clvCoverage.ok;
  const eligible=sampleMet&&checks.roi.ok&&checks.clv.ok;
  return {challenger:c.version,control,sport,feature:c.feature,registeredAt:c.registeredAt,challengerSummary:a,controlSummary:b,discordant,checks,
   decision:eligible?'eligible-for-promotion':sampleMet?'retain-control':'collecting',
   note:eligible?'Meets the registered rule. Promotion still needs an owner decision and a new dated version; nothing switches automatically.':sampleMet?'Sample is large enough and the challenger did not beat the control on both ROI and CLV.':'Not enough forward games yet. Results are descriptive only.'};
 });
}
