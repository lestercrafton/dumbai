/** Big Vin: opponent-adjusted ridge line model. Pure JavaScript, no dependencies.
 *
 * Canonical game:
 * {homeId, awayId, date:'YYYY-MM-DD' (or ISO timestamp), homeScore?, awayScore?,
 *  neutral:boolean, restDiff?:number, marketHomeSpread?:number}
 *
 * IMPORTANT: marketHomeSpread uses sportsbook sign (negative home favorite).
 * NFL input team IDs must be abbreviations; franchise aliases are normalized.
 * Model uses only completed outcomes dated strictly before asOf's UTC date.
 * Team IDs in schedules are allowed, but no ratings are invented for unseen teams.
 */
export const NFL_TEAM_IDS = Object.freeze(['ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS']);
const NFL_ALIASES={LA:'LAR',STL:'LAR',SD:'LAC',OAK:'LV',JAC:'JAX'};
const SPORT_ALIASES={football:'nfl',cfb:'ncaaf',collegefootball:'ncaaf',cbb:'ncaab',collegebasketball:'ncaab','mens-college-basketball':'ncaab','college-football':'ncaaf',basketball:'nba',baseball:'mlb',hockey:'nhl'};
const COMMON={lookbackDays:1460,halfLifeDays:120,ratingPenalty:6,homePenalty:30,restPenalty:100,homePrior:2,useRest:false};
export const MODEL_CONFIGS = Object.freeze({
  nfl:Object.freeze({...COMMON,useRest:true,validated:true}),
  nba:Object.freeze({...COMMON,lookbackDays:730,halfLifeDays:120,homePrior:2.5,validated:false}),
  ncaab:Object.freeze({...COMMON,lookbackDays:730,halfLifeDays:180,homePrior:3,validated:false}),
  ncaaf:Object.freeze({...COMMON,lookbackDays:1460,halfLifeDays:240,homePrior:2.5,validated:false}),
  mlb:Object.freeze({...COMMON,lookbackDays:730,halfLifeDays:120,homePrior:0.2,validated:false}),
  nhl:Object.freeze({...COMMON,lookbackDays:730,halfLifeDays:120,homePrior:0.2,validated:false}),
  wnba:Object.freeze({...COMMON,lookbackDays:730,halfLifeDays:120,homePrior:2,validated:false}),
});
const DAY=86400000;
const finite=(x)=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
const num=(x,fallback=0)=>finite(x)?Number(x):fallback;
const clipRest=(x)=>Math.max(-7,Math.min(7,num(x)));
function dayOf(value) {
  const s=value instanceof Date?value.toISOString():String(value??'');
  const day=s.slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const ms=Date.parse(day+'T00:00:00Z');
  return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===day?ms/DAY:null;
}
function canonical(id,sport){const s=String(id??'').trim();return sport==='nfl'?(NFL_ALIASES[s]??s):s;}
function sportKey(s){const key=String(s??'nfl').toLowerCase();return SPORT_ALIASES[key]??key;}

/** Cholesky solve for a symmetric positive-definite ridge normal matrix.
 * Full lower triangular factor; O(p^3/6) work and O(p^2) memory.
 */
function choleskySolve(A,b,n) {
  const L=new Float64Array(n*n);
  for(let i=0;i<n;i++)for(let j=0;j<=i;j++) {
    let sum=A[i*n+j];
    for(let k=0;k<j;k++)sum-=L[i*n+k]*L[j*n+k];
    if(i===j) {
      if(!(sum>0)||!Number.isFinite(sum))throw new Error('The rating matrix could not be solved.');
      L[i*n+j]=Math.sqrt(sum);
    } else L[i*n+j]=sum/L[j*n+j];
  }
  const z=new Float64Array(n),x=new Float64Array(n);
  for(let i=0;i<n;i++) {let sum=b[i];for(let k=0;k<i;k++)sum-=L[i*n+k]*z[k];z[i]=sum/L[i*n+i];}
  for(let i=n-1;i>=0;i--) {let sum=z[i];for(let k=i+1;k<n;k++)sum-=L[k*n+i]*x[k];x[i]=sum/L[i*n+i];}
  return x;
}

/** @param {Array<any>} games @param {{sport?:string,asOf?:string,variant?:string,parameters?:any}} options */
export function fitRatings(games,{sport='nfl',asOf=undefined,variant='incumbent',parameters=undefined}={}) {
  sport=sportKey(sport);
  const base=MODEL_CONFIGS[sport];
  if(!base)throw new Error('Unsupported sport: '+sport);
  let config=base&&variant==='no-rest'&&sport==='nfl'?{...base,useRest:false,validated:false}:base;
  if(parameters){
    const bounds={lookbackDays:[1,3650],halfLifeDays:[1,1460],ratingPenalty:[0.01,1000],homePenalty:[0.01,1000],restPenalty:[0.01,1000],homePrior:[-10,10],fixedHomeAdvantage:[-10,10]};
    for(const [key,value] of Object.entries(parameters)){
      if(key==='useRest'){if(typeof value!=='boolean')throw new Error('useRest must be boolean');continue;}
      if(key==='fixedHomeAdvantage'&&value===null)continue;
      const range=bounds[key];if(!range||typeof value!=='number'||!Number.isFinite(value)||value<range[0]||value>range[1])throw new Error('Invalid model parameter: '+key);
    }
    config={...config,...parameters,validated:false};
  }
  if(!config)throw new Error('Unsupported sport: '+sport);
  const fixedHome=parameters?.fixedHomeAdvantage??(variant==='fixed-home'&&sport==='ncaaf'?config.homePrior:null);
  const cutoff=dayOf(asOf);
  if(cutoff===null)throw new Error('asOf must be a valid YYYY-MM-DD date or ISO timestamp.');
  if(!Array.isArray(games))throw new Error('games must be an array.');
  const canonicalGames=games.map(g=>({...g,homeId:canonical(g.homeId,sport),awayId:canonical(g.awayId,sport),day:dayOf(g.date)}));
  const validIds=(g)=>g.homeId&&g.awayId&&g.homeId!==g.awayId;
  const allowedNFL=new Set(NFL_TEAM_IDS);
  const training=canonicalGames.filter(g=>validIds(g)&&g.day!==null&&0<cutoff-g.day&&cutoff-g.day<=config.lookbackDays&&finite(g.homeScore)&&finite(g.awayScore)&&Number(g.homeScore)>=0&&Number(g.awayScore)>=0&&(sport!=='nfl'||allowedNFL.has(g.homeId)&&allowedNFL.has(g.awayId)));
  // All NFL franchise priors are known. Other sports require actual pre-cutoff games.
  const teamIds=sport==='nfl'?[...NFL_TEAM_IDS]:[...new Set(training.flatMap(g=>[g.homeId,g.awayId]))].sort();
  const indices=new Map(teamIds.map((t,i)=>[t,i]));
  const nTeams=teamIds.length,n=nTeams+2,hi=nTeams,ri=nTeams+1;
  const A=new Float64Array(n*n),b=new Float64Array(n),teamGames={},effectiveTeamGames={};
  for(let i=0;i<nTeams;i++)A[i*n+i]=config.ratingPenalty;
  A[hi*n+hi]=config.homePenalty;A[ri*n+ri]=config.restPenalty;b[hi]=config.homePenalty*config.homePrior;
  let effectiveGames=0,lastDay=null;
  for(const g of training) {
    const h=indices.get(g.homeId),a=indices.get(g.awayId),w=2**(-(cutoff-g.day)/config.halfLifeDays),y=Number(g.homeScore)-Number(g.awayScore)-(fixedHome!==null&&!g.neutral?fixedHome:0);
    const entries=[[h,1],[a,-1]];
    if(!g.neutral&&fixedHome===null)entries.push([hi,1]);
    const rest=config.useRest?clipRest(g.restDiff):0;
    if(rest!==0)entries.push([ri,rest]);
    for(const [i,xi]of entries){b[i]+=w*xi*y;for(const[j,xj]of entries)A[i*n+j]+=w*xi*xj;}
    effectiveGames+=w;lastDay=lastDay===null?g.day:Math.max(lastDay,g.day);
    teamGames[g.homeId]=(teamGames[g.homeId]??0)+1;teamGames[g.awayId]=(teamGames[g.awayId]??0)+1;
    effectiveTeamGames[g.homeId]=(effectiveTeamGames[g.homeId]??0)+w;effectiveTeamGames[g.awayId]=(effectiveTeamGames[g.awayId]??0)+w;
  }
  const c=choleskySolve(A,b,n),ratings={};
  teamIds.forEach((t,i)=>ratings[t]=c[i]);
  const validation=config.validated?{
    status:'Retrospective NFL holdout evaluated; no clear improvement established',
    seasons:[2023,2024,2025],games:855,mae:10.35230439954015,rmse:13.285988078419868,
    baselineMae:10.36768158952548,marketMae:9.785964912280702,
    note:'Parameters selected using 2021–22 only. Historical results use weekly cutoffs. Market benchmark was more accurate. Probabilities and profitability are not validated.'
  }:parameters?{status:'Selected using known outcomes; future performance unproven',note:'These settings maximize the stated retrospective objective within a bounded search. Future frozen forecasts are the test.'}:{status:'Experimental defaults; not backtested',note:'These sport parameters were specified in advance without tuning or held-out evaluation. No predictive advantage is established.'};
  return {sport,asOf:new Date(cutoff*DAY).toISOString().slice(0,10),config:{...config,...(fixedHome!==null?{fixedHomeAdvantage:fixedHome}:{})},ratings,homeAdvantage:fixedHome??c[hi],restCoefficient:config.useRest?c[ri]:0,trainingGames:training.length,effectiveGames,lastTrainingDate:lastDay===null?null:new Date(lastDay*DAY).toISOString().slice(0,10),teamGames,effectiveTeamGames,validation};
}

export function projectGame(game,model) {
  const homeId=canonical(game.homeId,model.sport),awayId=canonical(game.awayId,model.sport);
  const missingTeams=[homeId,awayId].filter(t=>!Object.hasOwn(model.ratings,t)||!model.teamGames[t]);
  const marketHomeSpread=finite(game.marketHomeSpread)?Number(game.marketHomeSpread):null;
  const homeEffectiveGames=model.effectiveTeamGames?.[homeId]??0,awayEffectiveGames=model.effectiveTeamGames?.[awayId]??0;
  const sparseTeams=[homeId,awayId].filter(t=>(model.effectiveTeamGames?.[t]??0)<5);
  const sample={homeEffectiveGames,awayEffectiveGames,sparseTeams,sparseSample:sparseTeams.length>0};
  if(missingTeams.length||homeId===awayId)return{homeId,awayId,...sample,predictedHomeMargin:null,fairHomeSpread:null,homeEdgePoints:null,marketHomeSpread,homeRating:null,awayRating:null,homeAdvantage:null,restAdjustment:null,missingTeams,error:homeId===awayId?'A team cannot play itself.':'No completed pre-cutoff results for one or both teams.'};
  const homeRating=model.ratings[homeId],awayRating=model.ratings[awayId],homeAdvantage=game.neutral?0:model.homeAdvantage,restAdjustment=model.config.useRest?model.restCoefficient*clipRest(game.restDiff):0;
  const predictedHomeMargin=homeRating-awayRating+homeAdvantage+restAdjustment;
  return{homeId,awayId,...sample,homeRating,awayRating,homeAdvantage,restAdjustment,predictedHomeMargin,fairHomeSpread:-predictedHomeMargin,marketHomeSpread,homeEdgePoints:marketHomeSpread===null?null:predictedHomeMargin+marketHomeSpread,missingTeams:[]};
}
