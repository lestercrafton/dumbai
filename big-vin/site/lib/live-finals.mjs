import {canonicalTeamKey,normalizeScoreboard,SPORT_PATHS} from './feeds/adapter.mjs';

const NFL_ALIAS={LA:'LAR',STL:'LAR',SD:'LAC',OAK:'LV',JAC:'JAX',WSH:'WAS'};
const savedTeamId=(sport,team)=>sport==='nfl'?(NFL_ALIAS[team.abbreviation]||team.abbreviation):sport==='mlb'?team.key:team.id;

/** Summary URLs are constructed only from a supported sport and a saved ID. */
export function eventSummaryUrl(sport,gameId){
 if(!Object.hasOwn(SPORT_PATHS,sport)||!/^\d{1,12}$/.test(String(gameId)))throw new Error('Invalid saved event identity.');
 return `https://site.api.espn.com/apis/site/v2/sports/${SPORT_PATHS[sport]}/summary?event=${gameId}`;
}

/** A summary can supply a score only for the exact archived event and teams. */
export function matchEspnSummary(summary,forecast,sourceUrl,observedAt){
 const header=summary?.header,competition=header?.competitions?.[0];
 if(String(header?.id)!==String(forecast.gameId)||!competition||!Number.isFinite(Date.parse(competition.date)))return null;
 const board=normalizeScoreboard({events:[{...header,date:competition.date,week:{number:header.week},competitions:[competition]}]},forecast.sport,{sourceUrl,retrievedAt:observedAt});
 const game=board.games[0];
 if(!game||savedTeamId(forecast.sport,game.home)!==forecast.homeId||savedTeamId(forecast.sport,game.away)!==forecast.awayId)return null;
 return {...game,source:'ESPN event summary'};
}

/** Least-recently-attempted ordering gives omitted and older pending IDs a turn. */
export function selectSummaryCandidates(pending,gameMap,attempts={},limit=12){
 const unique=new Map();
 for(const f of pending)if(!gameMap.has(f.gameId)&&/^\d{1,12}$/.test(String(f.gameId))&&!unique.has(f.gameId))unique.set(f.gameId,f);
 const attempted=id=>Number.isFinite(Date.parse(attempts[id]))?Date.parse(attempts[id]):0;
 return [...unique.values()].sort((a,b)=>attempted(a.gameId)-attempted(b.gameId)||String(a.startTime).localeCompare(String(b.startTime))||String(a.gameId).localeCompare(String(b.gameId))).slice(0,limit);
}

// MLB IDs differ from ESPN IDs. Require an unambiguous team/time match,
// including both legs of a doubleheader, before attaching a final.
export function matchMlbFinals(payload,forecasts,sourceUrl,observedPending=new Set()){
 const games=(payload.dates||[]).flatMap(d=>d.games||[]);
 const matches=new Map();
 for(const f of forecasts){
  const candidates=games.filter(g=>canonicalTeamKey('mlb',g.teams?.home?.team?.abbreviation)===f.homeId&&canonicalTeamKey('mlb',g.teams?.away?.team?.abbreviation)===f.awayId&&Math.abs(Date.parse(g.gameDate)-Date.parse(f.startTime))<=15*60000);
  if(candidates.length!==1)continue;
  const g=candidates[0];
  if(['Preview','Live'].includes(g.status?.abstractGameState))observedPending.add(f.gameId);
  if(g.status?.abstractGameState!=='Final'||!/^(Final|Game Over|Completed Early)$/i.test(g.status?.detailedState||''))continue;
  const homeScore=g.teams.home.score,awayScore=g.teams.away.score;
  if(!Number.isInteger(homeScore)||!Number.isInteger(awayScore)||homeScore<0||awayScore<0)continue;
  matches.set(f.gameId,{id:f.gameId,sport:'mlb',startTime:g.gameDate,status:'completed',completed:true,homeScore,awayScore,sourceUrl,sourceGameId:String(g.gamePk)});
 }
 return matches;
}
export function unchangedGrade(previous,result){
 return !!previous&&['status','homeScore','awayScore','outcome','pnl'].every(k=>previous[k]===result[k])&&(previous.playedAt??null)===(result.playedAt??null)&&(previous.marketObservation?.observedAt??null)===(result.marketObservation?.observedAt??null);
}
