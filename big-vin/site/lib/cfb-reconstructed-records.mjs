import {projectGame} from './ratings.mjs';
import {gradeForecast,reportingWeek} from './results.mjs';

const finite=value=>typeof value==='number'&&Number.isFinite(value);
const validScore=value=>Number.isInteger(value)&&value>=0;
export const CFB_RECONSTRUCTION_ORIGIN='cfb-reconstructed-2026-09-26';

/**
 * Backfill the missed September 26 card into the model's official winner and
 * margin record. The numeric lines are created and timestamped on import. The
 * saved model is limited to results before September 26; source scores and
 * later reference spreads are never passed to the projection function.
 */
export function makeCfbReconstructedRecords(cohort,importedAt){
 const model=cohort?.model;
 if(cohort?.date!=='2026-09-26'||model?.asOf!==cohort.date||!model.lastTrainingDate||model.lastTrainingDate>=cohort.date||!Number.isFinite(Date.parse(importedAt))||Date.parse(importedAt)<Date.parse(cohort.capturedAt))throw new Error('The reconstructed card has invalid forecast provenance.');
 if(!Array.isArray(cohort.games)||cohort.games.length!==80||new Set(cohort.games.map(game=>String(game.id))).size!==cohort.games.length)throw new Error('The reconstructed card is incomplete.');
 return cohort.games.map(source=>{
  if(source.date!==cohort.date||!/^\d{1,12}$/.test(String(source.id))||!Number.isFinite(Date.parse(source.startTime))||!source.home?.id||!source.away?.id||String(source.home.id)===String(source.away.id))throw new Error('Invalid reconstructed event identity.');
  const homeId=String(source.home.id),awayId=String(source.away.id);
  // Restrict inputs by construction: no score, status, odds, or market line.
  const inputs={homeId,awayId,neutral:source.neutralSite===true,marketHomeSpread:null};
  const ordinary=projectGame(inputs,model);
  const homeRated=finite(model.ratings[homeId])&&!!model.teamGames[homeId];
  const awayRated=finite(model.ratings[awayId])&&!!model.teamGames[awayId];
  const ratingCoverage=homeRated&&awayRated?'both-rated':homeRated||awayRated?'one-prior':'both-prior';
  const homeRating=homeRated?model.ratings[homeId]:0,awayRating=awayRated?model.ratings[awayId]:0;
  const homeAdvantage=inputs.neutral?0:model.homeAdvantage;
  const predictedMargin=finite(ordinary.predictedHomeMargin)?ordinary.predictedHomeMargin:homeRating-awayRating+homeAdvantage;
  if(!finite(predictedMargin))throw new Error('The reconstructed model did not produce a finite line.');
  const id=`${cohort.modelVersion}:cfb:${source.id}`;
  const projection={...ordinary,predictedHomeMargin:predictedMargin,fairHomeSpread:-predictedMargin,marketHomeSpread:null,homeEdgePoints:null,homeRating,awayRating,homeAdvantage,restAdjustment:0,ratingCoverage,priorTeamIds:[...(!homeRated?[homeId]:[]),...(!awayRated?[awayId]:[])]};
  const record={id,gameId:String(source.id),sport:'cfb',season:2026,weekKey:reportingWeek({sport:'cfb',startTime:source.startTime}),cohort:'live',origin:CFB_RECONSTRUCTION_ORIGIN,reconstructionCategory:source.category,
   startTime:source.startTime,capturedAt:importedAt,reconstructedAt:importedAt,modelCapturedAt:cohort.capturedAt,
   rank:null,rankBasis:'Missed September 26 collection · no contemporaneous market rank',projection,
   home:source.home.name,away:source.away.name,homeId,awayId,predictedMargin,marketHomeSpread:null,side:null,odds:null,marketObservedAt:null,provider:null,
   sourceUrl:source.sourceUrl,trainingCutoff:model.asOf,modelVersion:cohort.modelVersion,parameters:model.config,homeAdvantage:model.homeAdvantage,restCoefficient:model.restCoefficient,
   trainingGames:model.trainingGames,lastTrainingDate:model.lastTrainingDate,ratingCoverage,
   coverageNote:'Missed scheduled run. Numeric line reconstructed and entered after the model snapshot; model trained only on results before September 26. No saved pregame spread or odds.',
   reconstructionNote:'Missed scheduled run; backfilled for winner and margin evaluation. No market or bankroll return is claimed.'};
  const capturedFinal=source.capturedStatus==='completed'&&validScore(source.capturedHomeScore)&&validScore(source.capturedAwayScore);
  if(!capturedFinal)return record;
  const game={startTime:source.startTime,status:'completed',completed:true,homeScore:source.capturedHomeScore,awayScore:source.capturedAwayScore,sourceUrl:source.sourceUrl};
  const result=gradeForecast(record,game,source.sourceRetrievedAt);
  return result?{...record,result}:record;
 });
}

/** Straight-up winner and score-margin record, including unpriced games. */
export function summarizeWinners(records){
 const modeled=records.filter(record=>finite(record.predictedMargin));
 const finals=modeled.filter(record=>record.result?.status==='completed'&&finite(record.result.actualMargin));
 const wins=finals.filter(record=>Math.sign(record.predictedMargin)===Math.sign(record.result.actualMargin)&&record.predictedMargin!==0&&record.result.actualMargin!==0).length;
 const ties=finals.filter(record=>record.predictedMargin===0||record.result.actualMargin===0).length;
 const losses=finals.length-wins-ties;
 const reconstructed=modeled.filter(record=>record.origin===CFB_RECONSTRUCTION_ORIGIN);
 const times=reconstructed.map(record=>record.reconstructedAt).filter(time=>Number.isFinite(Date.parse(time)));
 return {recorded:modeled.length,graded:finals.length,pending:modeled.filter(record=>!record.result).length,wins,losses,ties,winRate:wins+losses?wins/(wins+losses):null,
  mae:finals.length?finals.reduce((sum,record)=>sum+Math.abs(record.result.actualMargin-record.predictedMargin),0)/finals.length:null,
  reconstructedCount:reconstructed.length,reconstructedGraded:finals.filter(record=>record.origin===CFB_RECONSTRUCTION_ORIGIN).length,latestReconstructedAt:times.sort().at(-1)||null};
}
