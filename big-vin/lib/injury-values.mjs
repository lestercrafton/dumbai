/** Big Vin injury values: how many points a team loses when starters are unavailable.
 * Free inputs only: ESPN injuries and depth charts, nflverse weekly player stats and player ids.
 * Every number is a home-margin effect; the ratings model itself never sees injuries.
 */
export const STATUS_WEIGHT={out:1,'injured reserve':1,ir:1,doubtful:1,suspension:1,suspended:1,'physically unable to perform':1,pup:1,questionable:0.25};
export const statusWeight=s=>STATUS_WEIGHT[String(s||'').toLowerCase()]??0;
/** QB: points per game = (starter EPA/play - backup EPA/play) x plays per game x adaptation. */
export const QB={playsPerGame:36,adaptation:0.85,minPoints:2,priorPlays:250,replacementEpa:-0.08,starterPriorEpa:0.02,maxPoints:10,missedGameCredit:0.08,maxMissedCredit:0.5,season2Weight:0.5};
/** Other starters: fixed points when out, from public market rules of thumb, kept small and capped per team. */
export const POSITION_POINTS={lt:0.6,rt:0.4,lg:0.3,rg:0.3,c:0.4,wr1:0.8,wr2:0.4,te1:0.4,rb1:0.4,edge:0.5,dt:0.3,lb:0.25,cb:0.5,s:0.3,pk:0.3};
export const NON_QB_CAP=3;
export const DEPTH_GROUP={lt:'lt',rt:'rt',lg:'lg',rg:'rg',c:'c',lde:'edge',rde:'edge',de:'edge',wlb:'lb',slb:'lb',mlb:'lb',lilb:'lb',rilb:'lb',dt:'dt',nt:'dt',ldt:'dt',rdt:'dt',lcb:'cb',rcb:'cb',ss:'s',fs:'s',pk:'pk'};
const r2=x=>Math.round(x*100)/100;

/** Shrunk EPA/play from weekly rows ({season,week,team,plays,epa}); the current season counts fully. */
export function qbEpa(rows,{season,prior}){
 let plays=0,epa=0;
 for(const r of rows){const w=r.season===season?1:r.season===season-1?QB.season2Weight:0;plays+=w*r.plays;epa+=w*r.epa;}
 return {plays,raw:plays?epa/plays:null,shrunk:(epa+QB.priorPlays*prior)/(plays+QB.priorPlays)};
}
/** Points a team loses with its starter replaced by the backup, before status weighting. */
export function qbPoints({starter,backup,teamGames,starterGames}){
 const gap=Math.max(0,starter.shrunk-backup.shrunk);
 // Games the starter already missed are partly in the team's results, so the ratings have seen some of it.
 const missed=Math.max(0,teamGames-starterGames);
 const credit=Math.min(QB.maxMissedCredit,missed*QB.missedGameCredit);
 const full=Math.min(QB.maxPoints,Math.max(QB.minPoints,gap*QB.playsPerGame*QB.adaptation));
 return {gapEpaPerPlay:r2(gap),fullPoints:r2(full),alreadyInRatings:r2(credit),points:r2(full*(1-credit))};
}
/** Team loss from a list of evaluated absences; QB uncapped, others capped together. */
export function teamLoss(items){
 const qb=items.filter(i=>i.group==='qb').reduce((s,i)=>s+i.points,0);
 const other=Math.min(NON_QB_CAP,items.filter(i=>i.group!=='qb').reduce((s,i)=>s+i.points,0));
 return r2(qb+other);
}
/** Home-margin change for one game from the two teams' losses. */
export const homeDelta=(homeLoss,awayLoss)=>r2((awayLoss||0)-(homeLoss||0));
