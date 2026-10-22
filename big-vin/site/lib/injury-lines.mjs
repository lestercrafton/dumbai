/** Injury adjustments and the market-gap check for Big Vin's live lines.
 * The injury table is built every 30 minutes on GitHub Actions (big-vin/scripts/injury-lines.mjs)
 * from free ESPN and nflverse data and read here from the public repo.
 */
export const INJURY_TABLE_URL='https://raw.githubusercontent.com/lestercrafton/dumbai/main/big-vin/data/injury-lines/nfl.json';
export const INJURY_SPORTS=new Set(['nfl']);
export const INJURY_MAX_AGE=36*3600000;
/** Spread gap vs the market that needs an explanation before it is published as-is. */
export const GAP_THRESHOLD={nfl:4,cfb:7};
export const GAP_SHRINK=0.5;
export const EXPLAINING_INJURY=1.5;
const finite=Number.isFinite;
const r2=x=>Math.round(x*100)/100;

/** Home-margin change for one game, or null when no fresh table covers it. */
export function gameInjury(table,sport,homeId,awayId,now=Date.now()){
 if(!INJURY_SPORTS.has(sport)||!table?.teams||!(now-Date.parse(table.generatedAt)<=INJURY_MAX_AGE))return null;
 const home=table.teams[homeId],away=table.teams[awayId];if(!home||!away)return null;
 const brief=t=>({loss:t.loss,items:(t.items||[]).map(i=>({player:i.player,position:i.position,status:i.status,points:i.points,replacement:i.replacement??null}))});
 return {homeDelta:r2((away.loss||0)-(home.loss||0)),home:brief(home),away:brief(away),tableAt:table.generatedAt};
}
/** Flag a line far from the market. An injury that moves Big Vin the same way explains it;
 * otherwise the edge is halved toward the market and marked for review. */
export function marketCheck({sport,margin,homeSpread,injuryDelta=0}){
 const threshold=GAP_THRESHOLD[sport];
 if(!threshold||!finite(margin)||!finite(homeSpread))return {margin,check:null};
 const edge=margin+homeSpread;
 if(Math.abs(edge)<threshold)return {margin,check:null};
 // Injuries pushing the same way explain only their own size; the rest must stay under the threshold.
 const covered=finite(injuryDelta)&&Math.sign(injuryDelta)===Math.sign(edge)?Math.min(Math.abs(injuryDelta),Math.abs(edge)):0;
 const rest=Math.abs(edge)-covered;
 if(rest<threshold)return {margin,check:{flagged:true,gap:r2(edge),threshold,explanation:'injury',review:false,note:`Gap of ${r2(Math.abs(edge))} points vs the market; injuries account for ${r2(covered)} of it.`}};
 const shrunk=r2(-homeSpread+Math.sign(edge)*(covered+rest*GAP_SHRINK));
 return {margin:shrunk,check:{flagged:true,gap:r2(edge),threshold,explanation:covered?'partly injury':null,review:true,unshrunkMargin:r2(margin),note:`Gap of ${r2(Math.abs(edge))} points vs the market${covered?`, of which injuries explain ${r2(covered)}`:''}; the unexplained part is halved toward the market and marked for review.`}};
}
/** Full live margin: frozen model margin + current injury effect, then the market check. */
export function liveMargin({sport,baseMargin,homeSpread,injury}){
 const delta=injury?.homeDelta??0;
 const withInjury=finite(baseMargin)&&delta?r2(baseMargin+delta):baseMargin;
 const {margin,check}=marketCheck({sport,margin:withInjury,homeSpread,injuryDelta:delta});
 return {margin,injuryAdjustment:injury?delta:null,marketCheck:check};
}
