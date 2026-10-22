/** Big Vin over/under experiment: opponent-adjusted offense and defense points ratings.
 * Each team-game is one row: points scored = league average + offense(team) + defense(opponent)
 * + home edge + weather. Ridge shrinkage pulls every rating toward zero; older games fade with a half-life.
 * The game total is the sum of both teams' expected points. Pure JavaScript, no dependencies.
 */
export const TOTALS_CONFIGS={
 nfl:{halfLifeDays:150,lookbackDays:1100,ratingPenalty:16,windPerMph:0.18,windFloor:10,domeEdge:1,threshold:4,qbShare:0.6},
 cfb:{halfLifeDays:180,lookbackDays:900,ratingPenalty:3,windPerMph:0.15,windFloor:10,domeEdge:0,threshold:7,qbShare:0.6},
 nba:{halfLifeDays:90,lookbackDays:500,ratingPenalty:10,windPerMph:0,windFloor:0,domeEdge:0,threshold:8,qbShare:0},
 wnba:{halfLifeDays:90,lookbackDays:500,ratingPenalty:10,windPerMph:0,windFloor:0,domeEdge:0,threshold:7,qbShare:0},
 cbb:{halfLifeDays:90,lookbackDays:500,ratingPenalty:4,windPerMph:0,windFloor:0,domeEdge:0,threshold:8,qbShare:0},
};
const DAY=86400000;
const dayOf=v=>{const ms=Date.parse(String(v).slice(0,10)+'T00:00:00Z');return Number.isFinite(ms)?ms/DAY:null;};
function solve(A,b,n){
 const L=new Float64Array(n*n);
 for(let i=0;i<n;i++)for(let j=0;j<=i;j++){let s=A[i*n+j];for(let k=0;k<j;k++)s-=L[i*n+k]*L[j*n+k];if(i===j){if(!(s>0))throw new Error('Totals matrix could not be solved.');L[i*n+i]=Math.sqrt(s);}else L[i*n+j]=s/L[j*n+j];}
 const z=new Float64Array(n),x=new Float64Array(n);
 for(let i=0;i<n;i++){let s=b[i];for(let k=0;k<i;k++)s-=L[i*n+k]*z[k];z[i]=s/L[i*n+i];}
 for(let i=n-1;i>=0;i--){let s=z[i];for(let k=i+1;k<n;k++)s-=L[k*n+i]*x[k];x[i]=s/L[i*n+i];}
 return x;
}
/** games: {homeId,awayId,date,homeScore,awayScore,neutral?,wind?,dome?}; uses only games before asOf's date. */
export function fitTotals(games,{sport='nfl',asOf,config:override}={}){
 const c={...TOTALS_CONFIGS[sport],...override};if(!c.halfLifeDays)throw new Error('Unsupported totals sport: '+sport);
 const cut=dayOf(asOf);
 const train=games.filter(g=>{const d=dayOf(g.date);return d!==null&&d<cut&&cut-d<=c.lookbackDays&&Number.isFinite(+g.homeScore)&&Number.isFinite(+g.awayScore)&&g.homeScore!==''&&g.homeScore!==null&&g.awayScore!==null;});
 const teams=[...new Set(train.flatMap(g=>[g.homeId,g.awayId]))].sort(),idx=new Map(teams.map((t,i)=>[t,i])),T=teams.length;
 // Columns: offense[T], defense[T], intercept, home, wind, dome.
 const n=2*T+4,I=2*T,H=I+1,W=I+2,D=I+3,A=new Float64Array(n*n),b=new Float64Array(n);
 for(let i=0;i<2*T;i++)A[i*n+i]=c.ratingPenalty;
 A[I*n+I]=1e-6;A[H*n+H]=20;A[W*n+W]=50;A[D*n+D]=20;
 b[W]=-50*c.windPerMph;b[D]=20*c.domeEdge; // priors for weather terms
 const counts={};
 for(const g of train){const w=2**(-(cut-dayOf(g.date))/c.halfLifeDays),wind=Math.max(0,(+g.wind||0)-c.windFloor),dome=g.dome?1:0;
  for(const [t,o,y,home] of [[g.homeId,g.awayId,+g.homeScore,g.neutral?0:0.5],[g.awayId,g.homeId,+g.awayScore,g.neutral?0:-0.5]]){
   const e=[[idx.get(t),1],[T+idx.get(o),1],[I,1],[H,home],[W,wind],[D,dome]].filter(([,v])=>v!==0);
   for(const [i,xi] of e){b[i]+=w*xi*y;for(const [j,xj] of e)A[i*n+j]+=w*xi*xj;}
  }
  counts[g.homeId]=(counts[g.homeId]||0)+1;counts[g.awayId]=(counts[g.awayId]||0)+1;
 }
 const x=solve(A,b,n),off={},def={};teams.forEach((t,i)=>{off[t]=x[i];def[t]=x[T+i];});
 return {sport,asOf,config:c,offense:off,defense:def,average:x[I],homeEdge:x[H],windPerMph:x[W],domeEdge:x[D],games:counts,trainingGames:train.length};
}
/** Expected points for each side and the total. injuries: {homeLoss,awayLoss} spread points lost to absences. */
export function projectTotal(game,m,{injuries=null,wind=null,dome=false}={}){
 const {homeId:h,awayId:a}=game;
 if(!(h in m.offense)||!(a in m.offense))return null;
 const windFx=dome?0:Math.max(0,(+wind||0)-m.config.windFloor)*m.windPerMph,weather=windFx+(dome?m.domeEdge:0);
 const half=game.neutral?0:0.5;
 // Offensive absences cost a team its own points; defensive absences give the opponent points.
 const fx=injuries?pointsEffects(injuries.home,injuries.away,m.config.qbShare):{home:0,away:0};
 const homeInj=fx.home,awayInj=fx.away;
 const home=m.average+m.offense[h]+m.defense[a]+half*m.homeEdge+weather+homeInj;
 const away=m.average+m.offense[a]+m.defense[h]-half*m.homeEdge+weather+awayInj;
 return {homePoints:home,awayPoints:away,total:home+away,injuryEffect:homeInj+awayInj,weatherEffect:2*windFx,indoorEffect:dome?2*m.domeEdge:0,sparse:(m.games[h]||0)<5||(m.games[a]||0)<5};
}
export const DEFENSE_GROUPS=new Set(['edge','dt','lb','cb','s']);
/** items: injury-table entries {group,points}. Returns points added to each team's expected score. */
export function pointsEffects(homeItems=[],awayItems=[],share=0.6){
 const off=items=>items.filter(i=>!DEFENSE_GROUPS.has(i.group)).reduce((a,i)=>a+i.points,0);
 const def=items=>Math.min(3,items.filter(i=>DEFENSE_GROUPS.has(i.group)).reduce((a,i)=>a+i.points,0));
 return {home:share*(-off(homeItems)+def(awayItems)),away:share*(-off(awayItems)+def(homeItems))};
}
/** Over/under pick vs the market total, with the same gap guard as the spread line. */
export function totalPick({sport,total,marketTotal,injuryEffect=0,weatherEffect=0}){
 if(!Number.isFinite(total)||!Number.isFinite(marketTotal))return {side:null,edge:null,total,check:null};
 const threshold=TOTALS_CONFIGS[sport].threshold;let gap=total-marketTotal,check=null,final=total;
 if(Math.abs(gap)>=threshold){
  const explain=injuryEffect+weatherEffect;
  const explained=Math.abs(explain)>=1.5&&Math.sign(explain)===Math.sign(gap);
  if(explained)check={flagged:true,review:false,gap:r2(gap),note:`Gap of ${r2(Math.abs(gap))} points is explained by ${Math.abs(injuryEffect)>=Math.abs(weatherEffect)?'injuries':'weather'}.`};
  else{final=marketTotal+gap/2;check={flagged:true,review:true,gap:r2(gap),unshrunkTotal:r2(total),note:`Gap of ${r2(Math.abs(gap))} points vs the market total has no injury or weather explanation; halved toward the market and marked for review.`};}
 }
 const edge=final-marketTotal;
 return {side:Math.abs(edge)<1e-9?null:edge>0?'over':'under',edge:r2(Math.abs(edge)),total:r2(final),check};
}
export function gradeTotal(side,line,actual){if(!side||!Number.isFinite(line)||!Number.isFinite(actual))return null;if(actual===line)return 'push';return (actual>line)===(side==='over')?'win':'loss';}
const r2=x=>Math.round(x*100)/100;
