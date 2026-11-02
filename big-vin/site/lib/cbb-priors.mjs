/** College basketball preseason priors and expected possessions.
 * Built by scripts/cbb-priors.mjs from Torvik final efficiency and tempo of the
 * prior season plus ESPN roster continuity. Priors are points per 100
 * possessions versus an average team, used as ridge targets so early-season
 * ratings start from the roster instead of zero. */
import data from './cbb-priors.json' with {type:'json'};
export const cbbSeasonOf=d=>{const y=+String(d).slice(0,4),m=+String(d).slice(5,7);return m>=8?y+1:y;};
/** kind: 'roster' (continuity + transfers) or 'margin' (prior margin only). */
export function cbbPriors(season,kind='roster',source=data){
 const s=source.seasons?.[season];if(!s)return {};const c=source.coefficients;const out={};
 for(const [id,f] of Object.entries(s)){
  let v=null;
  if(kind==='roster'&&f.returning!==null&&f.transferIn!==null)v=c.roster[0]+c.roster[1]*f.margin+c.roster[2]*f.margin*f.returning+c.roster[3]*f.transferIn+c.roster[4]*f.returning;
  else v=c.marginOnly[0]+c.marginOnly[1]*f.margin;
  if(Number.isFinite(v))out[id]=+v.toFixed(2);
 }
 return out;
}
/** Expected possessions from each team's prior-season adjusted tempo. */
export function cbbPace(game,source=data){
 const season=cbbSeasonOf(game.date||game.startTime),s=source.seasons?.[season],avg=source.avgTempo?.[season];
 const h=s?.[game.homeId]?.tempo,a=s?.[game.awayId]?.tempo;
 if(!avg||!Number.isFinite(h)&&!Number.isFinite(a))return null;
 return +(((Number.isFinite(h)?h:avg)*(Number.isFinite(a)?a:avg))/avg).toFixed(2);
}
export const withCbbPace=(game,source=data)=>({...game,pace:cbbPace(game,source)});
