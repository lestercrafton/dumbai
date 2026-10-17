import {projectGame} from './ratings.mjs';

const finite=value=>typeof value==='number'&&Number.isFinite(value);
const validScore=value=>Number.isInteger(value)&&value>=0;

/** Retrospective research only: never writes a frozen pregame forecast. */
export function projectResearchGame(source,model,current=null,generatedAt=new Date().toISOString()){
 const homeId=String(source.home.id),awayId=String(source.away.id);
 const original=projectGame({homeId,awayId,neutral:source.neutralSite===true,marketHomeSpread:null},model);
 const homeRated=finite(model.ratings[homeId])&&!!model.teamGames[homeId];
 const awayRated=finite(model.ratings[awayId])&&!!model.teamGames[awayId];
 const ratingCoverage=homeRated&&awayRated?'both-rated':homeRated||awayRated?'one-prior':'both-prior';
 // An unseen team gets a zero-centered rating prior. This is an explicit,
 // low-confidence research fallback, not a claim that the saved model rated it.
 const modelHomeMargin=finite(original.predictedHomeMargin)?original.predictedHomeMargin:
  (homeRated?model.ratings[homeId]:0)-(awayRated?model.ratings[awayId]:0)+(source.neutralSite?0:model.homeAdvantage);
 const identityMatches=current&&String(current.home?.id)===homeId&&String(current.away?.id)===awayId;
 const latest=identityMatches&&current.completed&&validScore(current.homeScore)&&validScore(current.awayScore)?current:null;
 const captured=source.capturedStatus==='completed'&&validScore(source.capturedHomeScore)&&validScore(source.capturedAwayScore);
 const actualHomeScore=latest?latest.homeScore:captured?source.capturedHomeScore:null;
 const actualAwayScore=latest?latest.awayScore:captured?source.capturedAwayScore:null;
 const actualHomeMargin=actualHomeScore===null?null:actualHomeScore-actualAwayScore;
 const absoluteError=actualHomeMargin===null?null:Math.abs(actualHomeMargin-modelHomeMargin);
 const outcome=actualHomeMargin===null?null:actualHomeMargin===0||modelHomeMargin===0?'tie':Math.sign(actualHomeMargin)===Math.sign(modelHomeMargin)?'correct':'incorrect';
 const lateMarketHomeSpread=finite(source.lateMarketHomeSpread)?source.lateMarketHomeSpread:null;
 const edge=lateMarketHomeSpread===null?null:modelHomeMargin+lateMarketHomeSpread;
 const researchSide=edge===null||Math.abs(edge)<1e-9?null:edge>0?'home':'away';
 const cover=actualHomeMargin===null||lateMarketHomeSpread===null||!researchSide?null:(actualHomeMargin+lateMarketHomeSpread)*(researchSide==='home'?1:-1);
 const coverOutcome=cover===null?null:Math.abs(cover)<1e-9?'push':cover>0?'win':'loss';
 const predictedWinner=modelHomeMargin>=0?source.home.name:source.away.name;
 return {id:source.id,category:source.category,date:source.date,startTime:source.startTime,home:source.home.name,away:source.away.name,
  homeId,awayId,modelHomeMargin,predictedWinner,ratingCoverage,forecastTiming:'late-entered-reconstruction',modelCapturedAt:generatedAt,
  actualHomeScore,actualAwayScore,actualHomeMargin,outcome,absoluteError,lateMarketHomeSpread,lateMarketProvider:source.lateMarketProvider,
  researchSide,coverOutcome,sourceUrl:source.sourceUrl,sourceRetrievedAt:source.sourceRetrievedAt};
}

export function summarizeResearchGames(games){
 const finals=games.filter(game=>finite(game.actualHomeMargin)&&finite(game.absoluteError));
 const sortedErrors=finals.map(game=>game.absoluteError).sort((a,b)=>a-b);
 const medianAbsoluteError=sortedErrors.length?sortedErrors.length%2?sortedErrors[(sortedErrors.length-1)/2]:(sortedErrors[sortedErrors.length/2-1]+sortedErrors[sortedErrors.length/2])/2:null;
 return {evaluated:finals.length,winnerWins:finals.filter(game=>game.outcome==='correct').length,winnerLosses:finals.filter(game=>game.outcome==='incorrect').length,winnerTies:finals.filter(game=>game.outcome==='tie').length,
  mae:finals.length?sortedErrors.reduce((sum,value)=>sum+value,0)/finals.length:null,medianAbsoluteError,
  bias:finals.length?finals.reduce((sum,game)=>sum+game.actualHomeMargin-game.modelHomeMargin,0)/finals.length:null,
  lateMarketCount:games.filter(game=>finite(game.lateMarketHomeSpread)).length,
  lateMarketWins:games.filter(game=>game.coverOutcome==='win').length,lateMarketLosses:games.filter(game=>game.coverOutcome==='loss').length,lateMarketPushes:games.filter(game=>game.coverOutcome==='push').length,
  priorOnlyEvaluated:finals.filter(game=>game.ratingCoverage!=='both-rated').length,bothRatedEvaluated:finals.filter(game=>game.ratingCoverage==='both-rated').length};
}
