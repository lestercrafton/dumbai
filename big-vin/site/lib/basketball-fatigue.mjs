/** NBA schedule fatigue, from the schedule alone (no outcomes).
 * b2bDiff: home on the second night of a back-to-back minus away (1, 0, -1).
 * tzDiff: time zones crossed since each team's previous game (only when it was
 * within two days), home minus away. Fitted with the ratings; kept because each
 * lowered error on the 2024-25 selection season (research/nba-2026-11-01). */
const COORDS={'1':-84.40,'2':-71.06,'17':-73.97,'30':-80.84,'4':-87.67,'5':-81.69,'6':-96.81,'7':-105.01,'8':-83.06,'9':-122.39,'10':-95.36,'11':-86.16,'12':-118.34,'13':-118.27,'29':-90.05,'14':-80.19,'15':-87.92,'16':-93.28,'3':-90.08,'18':-73.99,'25':-97.52,'19':-81.38,'20':-75.17,'21':-112.07,'22':-122.67,'23':-121.50,'24':-98.44,'28':-79.38,'26':-111.90,'27':-77.02};
const DAY=86400000;
const dayOf=g=>Math.floor(Date.parse(String(g.startTime||g.date).slice(0,10)+'T00:00:00Z')/DAY);
export const fatigueKey=g=>`${g.homeId}:${g.awayId}:${String(g.startTime||g.date).slice(0,10)}`;
/** Returns Map(fatigueKey -> {b2bDiff,tzDiff}) for every game given. */
export function fatigueMap(games){
 const list=[...new Map(games.filter(g=>g?.homeId&&g?.awayId&&(g.startTime||g.date)).map(g=>[fatigueKey(g),g])).values()].sort((a,b)=>dayOf(a)-dayOf(b)||String(a.startTime||'').localeCompare(String(b.startTime||'')));
 const last=new Map(),out=new Map();
 for(const g of list){
  const d=dayOf(g),loc=COORDS[g.homeId];
  const side=t=>{const p=last.get(t);if(!p)return {b2b:0,tz:0};const rest=d-p.day;
   return {b2b:rest===1?1:0,tz:rest>=1&&rest<=2&&Number.isFinite(p.lon)&&Number.isFinite(loc)?Math.abs(p.lon-loc)/15:0};};
  const h=side(g.homeId),a=side(g.awayId);
  out.set(fatigueKey(g),{b2bDiff:h.b2b-a.b2b,tzDiff:Math.round((h.tz-a.tz)*1000)/1000});
  for(const t of [g.homeId,g.awayId])last.set(t,{day:d,lon:loc});
 }
 return out;
}
export function withFatigue(game,map){const f=map?.get(fatigueKey(game));return f?{...game,...f}:game;}
