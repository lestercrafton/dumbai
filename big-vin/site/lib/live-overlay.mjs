/** Overlay fresh live scores onto a cached slate so the live cover boxes
 * (Covering by / Needs X to cover, green/yellow) stay on. Pure and tested. */
export const LIVE_FIELDS=['status','statusDescription','statusName','statusDetail','statusShortDetail','period','clock','scoreObservedAt','outs','isTopInning','liveHomeScore','liveAwayScore'];
export function hasActiveGames(games,now=Date.now()){
 return games.some(g=>!g.completed&&!g.result?.status&&(g.status==='live'||(Date.parse(g.startTime)<=now&&now-Date.parse(g.startTime)<8*3600000)));
}
export function mergeLiveScores(games,fresh){
 const byId=new Map((fresh||[]).map(g=>[String(g.id),g]));
 return games.map(g=>{const f=byId.get(String(g.id));if(!f||g.completed||g.result?.status||!['live','completed'].includes(f.status))return g;
  // Just finished but not graded yet: keep showing the cover status against the final score.
  if(f.status==='completed')return {...g,status:'live',statusDescription:'Final',statusDetail:'Final',statusShortDetail:'Final',period:f.period,clock:null,scoreObservedAt:f.scoreObservedAt,liveHomeScore:f.homeScore,liveAwayScore:f.awayScore,finalPendingGrade:true};
  return {...g,...Object.fromEntries(LIVE_FIELDS.map(k=>[k,f[k]]))};});
}
