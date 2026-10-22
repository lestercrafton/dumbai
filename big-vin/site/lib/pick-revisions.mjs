import {liveMargin} from './injury-lines.mjs';
import {winProbability,moneylineExpectedValue} from './moneyline.mjs';
const at=value=>typeof value==='string'?Date.parse(value):NaN;
const finite=Number.isFinite;
export const PICK_PROTOCOL='pregame-revisions-v1';
export const QUOTE_MAX_AGE=30*60*1000;
const earlier=(...dates)=>new Date(Math.min(...dates.map(at).filter(finite))).toISOString();

/** All sports use a home-margin model. A positive home edge selects home;
 * a negative edge selects away. Zero is an explicit no-pick revision. */
/** MLB moneyline: the side whose quoted price beats the model's win
 * chance by at least MIN_ML_VALUE per unit staked; otherwise pass. Same bar both sides. */
export const MIN_ML_VALUE=0.03;
const ML_SPORTS=new Set(['mlb']);
export const quotePrices=(sport,q)=>({sport,homePrice:q?.homeSpreadPrice??q?.marketHomePrice??null,awayPrice:q?.awaySpreadPrice??q?.marketAwayPrice??null});
export function spreadSelection(margin,homeSpread,{sport,homePrice,awayPrice}={}){
 if(!finite(margin)||!finite(homeSpread))return {side:null,edge:null};
 if(ML_SPORTS.has(sport)&&homeSpread===0){
  const p=winProbability(margin,sport);
  const home=moneylineExpectedValue(p,homePrice),away=moneylineExpectedValue(1-p,awayPrice);
  if(home===null||away===null)return {side:null,edge:null};
  const best=home>=away?{side:'home',value:home/100}:{side:'away',value:away/100};
  return best.value>=MIN_ML_VALUE?{side:best.side,edge:Math.round(best.value*1000)/1000}:{side:null,edge:0};
 }
 const homeEdge=margin+homeSpread;
 return {side:Math.abs(homeEdge)<1e-9?null:homeEdge>0?'home':'away',edge:Math.abs(homeEdge)<1e-9?0:Math.abs(homeEdge)};
}
/** The model margin before injuries and the market check; older records have no separate base. */
export const baseMargin=f=>finite(f?.baseMargin)?f.baseMargin:f?.predictedMargin;
export function revisableForecast(f){
 return f?.cohort==='live'&&['collector','local-pregame-archive'].includes(f.origin)&&!f.paperWager
  &&finite(f.predictedMargin)&&finite(at(f.startTime))&&finite(at(f.capturedAt))&&at(f.capturedAt)<at(f.startTime);
}
export function matchingPickGame(f,g){
 return !!g&&f.gameId===g.id&&f.sport===g.sport&&f.homeId===g.homeId&&f.awayId===g.awayId;
}
export function validPregameQuote(f,g,now=Date.now(),lockAt=f.startTime){
 const q=g?.market,observed=at(q?.observedAt),start=at(g?.startTime);
 return revisableForecast(f)&&matchingPickGame(f,g)&&f.result==null&&g.status==='scheduled'&&!g.completed
  &&finite(start)&&now<Math.min(start,at(f.startTime),at(lockAt))&&finite(now)
  &&q?.timing==='current-displayed-snapshot'&&finite(q.homeSpread)
  &&(!finite(q.awaySpread)||Math.abs(q.homeSpread+q.awaySpread)<1e-9)
  &&finite(observed)&&observed>=Math.min(at(f.capturedAt),finite(at(f.marketObservedAt))?at(f.marketObservedAt):Infinity)&&observed<=now&&now-observed<=QUOTE_MAX_AGE;
}
const odds=value=>finite(value)&&Number.isInteger(value)&&Math.abs(value)>=100?value:null;
const sameOffer=(a,b)=>['side','marketHomeSpread','odds','marketHomePrice','marketAwayPrice','runLineHomeSpread','runLineHomePrice','runLineAwayPrice','provider','predictedMargin'].every(key=>a?.[key]===b?.[key]);

/** Pure prospective state transition. Original forecasts are never rewritten.
 * Earliest observed kickoff and a started/unknown-status latch only tighten. */
export function advancePickState(f,previous,g,recordedAt=new Date().toISOString()){
 const now=at(recordedAt);
 if(!revisableForecast(f)||!matchingPickGame(f,g)||!finite(now))return previous??null;
 // Do not enroll historical games or manufacture a pregame revision after start.
 if(!previous&&(now>=at(f.startTime)||f.result!=null))return null;
 // Once the deadline has elapsed, later provider corrections cannot rewrite
 // the effective pick. The lock is time-based even before a worker next wakes.
 if(previous&&(previous.closedAt||now>=at(previous.lockAt)))return {...previous,closedAt:previous.closedAt??previous.lockAt};
 const state=previous??{protocol:PICK_PROTOCOL,forecastId:f.id,lockAt:f.startTime,closedAt:null,verifiedAt:null,revisions:[]};
 const lockAt=earlier(state.lockAt,f.startTime,...(finite(at(g.startTime))?[g.startTime]:[]),...(g.status!=='scheduled'||g.completed?[recordedAt]:[]));
 const closedAt=state.closedAt??(now>=at(lockAt)||g.status!=='scheduled'||g.completed||f.result!=null?recordedAt:null);
 let next={...state,lockAt,closedAt};
 if(closedAt||!validPregameQuote(f,g,now,lockAt))return next;
 const q=g.market;
 if(at(q.observedAt)<at(state.verifiedAt))return next;
 const base=baseMargin(f),live=liveMargin({sport:f.sport,baseMargin:base,homeSpread:q.homeSpread,injury:g.injury});
 const selected=spreadSelection(live.margin,q.homeSpread,quotePrices(f.sport,q));
 const revision={id:f.id+':'+q.observedAt,forecastId:f.id,gameId:f.gameId,homeId:f.homeId,awayId:f.awayId,
  modelVersion:f.modelVersion,predictedMargin:live.margin,...(live.margin!==f.predictedMargin?{baseMargin:base}:{}),
  ...(live.injuryAdjustment!==null?{injuryAdjustment:live.injuryAdjustment,injury:g.injury}:{}),...(live.marketCheck?{marketCheck:live.marketCheck}:{}),marketHomeSpread:q.homeSpread,marketHomePrice:odds(q.homeSpreadPrice),marketAwayPrice:odds(q.awaySpreadPrice),...(finite(q.runLineHomeSpread)?{runLineHomeSpread:q.runLineHomeSpread,runLineHomePrice:odds(q.runLineHomePrice),runLineAwayPrice:odds(q.runLineAwayPrice)}:{}),...selected,
  odds:odds(selected.side==='home'?q.homeSpreadPrice:selected.side==='away'?q.awaySpreadPrice:null),
  provider:q.provider||'Sportsbook',observedAt:q.observedAt,recordedAt,startTime:g.startTime,lockAt,sourceUrl:g.sourceUrl};
 const last=state.revisions.at(-1);
 // Equal-time contradictory quotes cannot replace an accepted observation.
 if(last&&at(q.observedAt)===at(state.verifiedAt)&&!sameOffer(last,revision))return next;
 next={...next,verifiedAt:q.observedAt};
 if(!sameOffer(last,revision))next.revisions=[...state.revisions,revision];
 return next;
}

/** Shared by board, record totals, bankroll replay and both grading writers. */
export function withPickState(f,state){
 if(!state||state.protocol!==PICK_PROTOCOL||state.forecastId!==f.id||!revisableForecast(f))return f;
 const cutoff=Math.min(at(f.startTime),at(state.lockAt));
 const revisions=state.revisions.filter(r=>r.forecastId===f.id&&r.gameId===f.gameId&&r.homeId===f.homeId&&r.awayId===f.awayId
  &&(r.baseMargin??r.predictedMargin)===baseMargin(f)&&r.modelVersion===f.modelVersion&&finite(r.marketHomeSpread)
  &&at(r.recordedAt)<cutoff&&at(r.observedAt)<=at(r.recordedAt)&&at(r.observedAt)>=Math.min(at(f.capturedAt),finite(at(f.marketObservedAt))?at(f.marketObservedAt):Infinity)
  &&r.side===spreadSelection(r.predictedMargin,r.marketHomeSpread,quotePrices(f.sport,r)).side);
 const selected=[...revisions].sort((a,b)=>at(a.observedAt)-at(b.observedAt)||at(a.recordedAt)-at(b.recordedAt)||a.id.localeCompare(b.id)).at(-1);
 const originalPick={side:f.side,marketHomeSpread:f.marketHomeSpread,odds:f.odds,marketObservedAt:f.marketObservedAt,capturedAt:f.capturedAt,recordedAt:f.firstMarket?.recordedAt??f.capturedAt,provider:f.provider};
 const validOriginal=at(f.capturedAt)<cutoff&&(!finite(f.marketHomeSpread)||at(f.marketObservedAt)<cutoff);
 return {...f,baseMargin:baseMargin(f),...(selected?{predictedMargin:selected.predictedMargin,injuryAdjustment:selected.injuryAdjustment??f.injuryAdjustment??null,injury:selected.injury??f.injury??null,marketCheck:selected.marketCheck??null,side:selected.side,marketHomeSpread:selected.marketHomeSpread,odds:selected.odds,marketHomePrice:selected.marketHomePrice??null,marketAwayPrice:selected.marketAwayPrice??null,...(finite(selected.runLineHomeSpread)?{runLineHomeSpread:selected.runLineHomeSpread,runLineHomePrice:selected.runLineHomePrice,runLineAwayPrice:selected.runLineAwayPrice}:{}),edge:selected.edge??f.edge,provider:selected.provider,marketObservedAt:selected.observedAt}:!validOriginal?{side:null,marketHomeSpread:null,odds:null}:{}),
  originalPick,pickRevision:selected??null,pickRevisions:state.revisions,pickLock:{lockAt:state.lockAt,closedAt:state.closedAt,verifiedAt:state.verifiedAt,protocol:PICK_PROTOCOL}};
}

export function actionablePick(f,g,now=Date.now()){
 if(!f?.pickLock||f.pickLock.closedAt||!validPregameQuote(f,g,now,f.pickLock.lockAt))return false;
 // Persistence must confirm the same current offer, including an explicit pass.
 return f.pickRevision?.marketHomeSpread===g.market.homeSpread&&f.side===spreadSelection(f.predictedMargin,g.market.homeSpread,quotePrices(f.sport,g.market)).side
  &&at(f.pickLock.verifiedAt)>=at(g.market.observedAt);
}

/** Expire a previously fetched recommendation on the client, too. */
export function currentBoardPick(game,now=Date.now()){
 if(game.actionable===undefined)return !game.stale; // legacy saved-only views
 const verified=at(game.pickLock?.verifiedAt);
 return game.actionable===true&&!game.stale&&!game.pickLock?.closedAt&&game.status==='scheduled'
  &&now<Math.min(at(game.startTime),at(game.pickLock?.lockAt))&&finite(verified)&&verified<=now&&now-verified<=QUOTE_MAX_AGE;
}
export function expireBoardPick(game,now=Date.now()){
 return game.status==='scheduled'&&game.actionable!==undefined&&!currentBoardPick(game,now)
  ?{...game,actionable:false,stale:true}:game; // keep the server's rank number; only the live pick expires
}
