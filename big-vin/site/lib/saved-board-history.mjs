import {selectTrackedHistory} from './tracked-history.mjs';

/** Default boards use the same saved picks as tracked history. Research and
 * collector calls that explicitly select a formula do not use this view.
 * Board sorting remains a current-window view; expose the saved-history rank
 * separately so it cannot be confused with that newly sorted window.
 * @param {any[]} records
 * @param {{sport:string,models:any[],date:string,days:number}} options
 */
export function savedBoardHistory(records,{sport,models,date,days}){
 return selectTrackedHistory(records,{sport,models,rankPeriod:days===1?'day':'week',rankAnchor:days===7?date:null});
}

/** Never generate a replacement forecast for a game that has already started,
 * including provider feeds that incorrectly still describe it as scheduled.
 */
export function canProjectUncapturedGame(game,now=Date.now()){
 return game.status==='scheduled'&&Number.isFinite(Date.parse(game.startTime))&&Date.parse(game.startTime)>now&&game.seasonType!==1&&!game.modelExcludedReason;
}
