import cohort from '@/lib/college-experiment-cohort-2026-09-26.json';
import openingOdds from '@/lib/cfb-opening-odds-2026-09-26.json';
import {scoreboard} from '@/lib/feeds/service';
import {projectResearchGame,summarizeResearchGames} from '@/lib/college-experiment.mjs';

export async function GET(request:Request){
 const date=new URL(request.url).searchParams.get('date')||cohort.date;
 if(date!==cohort.date)return Response.json({error:'The frozen September 26 research cohort is the available experiment.'},{status:400});
 try{
  let board:{games:any[];retrievedAt?:string}|null=null;
  try{board=await scoreboard('cfb',date,date)}catch(error){console.error('College experiment live score refresh unavailable; using captured finals',error)}
  const model=cohort.model;
  const byId=new Map<string,any>((board?.games||[]).map((game:any)=>[String(game.id),game] as [string,any]));
  const generatedAt=new Date().toISOString();
  const games=cohort.games.map(source=>({...projectResearchGame(source,model,byId.get(source.id),cohort.capturedAt),modelVersion:cohort.modelVersion}));
  const summary=summarizeResearchGames(games);
  const archivedOpeningQuotes=openingOdds.entries.filter(entry=>entry.provider==='DraftKings').length;
  const syntheticWinnerContracts=openingOdds.entries.filter(entry=>entry.provider===null).length;
  if(openingOdds.date!==date||openingOdds.entries.length!==games.length||archivedOpeningQuotes!==77||syntheticWinnerContracts!==3)throw new Error('Opening-odds archive does not cover the frozen college cohort.');
  const coverage={discovered:cohort.coreDiscovered,boardGames:cohort.boardGames,savedBeforeKickoff:cohort.savedBeforeKickoff,
   noMarketOnBoard:cohort.games.filter(game=>game.category==='no-market-on-board').length,
   omittedFromBoard:cohort.games.filter(game=>game.category==='omitted-from-board').length,
   pricedWithoutSaved:cohort.games.filter(game=>game.category==='priced-without-saved-forecast').length,
   projected:games.length,finals:summary.evaluated,priorOnly:games.filter(game=>game.ratingCoverage!=='both-rated').length,
   archivedOpeningQuotes,syntheticWinnerContracts};
  return Response.json({date,asOf:date,generatedAt,cohortCapturedAt:cohort.capturedAt,boardRetrievedAt:board?.retrievedAt||null,
   modelVersion:cohort.modelVersion,modelLabel:'Frozen September 26 tuned ratings',trainingGames:model.trainingGames,lastTrainingDate:model.lastTrainingDate,
   coverage,summary,games,warnings:[`These lines use the rating model captured ${cohort.capturedAt}. Its training cutoff excludes September 26 outcomes, but earlier results may have become available after some games kicked off.`,
    'Unrated teams use a zero-centered prior and are marked low confidence. The paper bankroll uses 77 archived DraftKings opening quotes and three synthetic even-money winner contracts. Later reference spreads are hindsight research and never set a paper bet or payout.',
    ...(!board?['Live server score refresh was unavailable; captured finals remain visible, and the browser will check pending games directly.']:[])],
   sources:cohort.coreSourceUrls},{headers:{'Cache-Control':'no-store'}});
 }catch(error){console.error('College experiment unavailable',error);return Response.json({error:'The research card is temporarily unavailable.'},{status:503});}
}
