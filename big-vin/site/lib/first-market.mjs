const finite=x=>typeof x==='number'&&Number.isFinite(x);
const at=x=>typeof x==='string'?Date.parse(x):NaN;

/** Attach the first real offer to a previously unpriced forecast, before kickoff. */
export function firstMarketObservation(f,g,recordedAt=new Date().toISOString()){
 if(f.origin==='cfb-reconstructed-2026-09-26')return null;
 if(f.cohort!=='live'||f.marketHomeSpread!=null||!finite(f.predictedMargin)||g.id!==f.gameId||g.sport!==f.sport||g.status!=='scheduled'||f.result!=null)return null;
 if(f.homeId!==g.homeId||f.awayId!==g.awayId)return null;
 const now=at(recordedAt),observed=at(g.market?.observedAt),forecasted=at(f.capturedAt),kickoff=Math.min(at(f.startTime),at(g.startTime));
 if(![now,observed,forecasted,kickoff].every(Number.isFinite)||now+60000>=kickoff||forecasted>observed||observed>now||now-observed>1800000||!finite(g.market?.homeSpread))return null;
 const edge=f.predictedMargin+g.market.homeSpread,side=edge===0?null:edge>0?'home':'away';
 const price=side==='home'?g.market.homeSpreadPrice:side==='away'?g.market.awaySpreadPrice:null;
 return {forecastId:f.id,gameId:f.gameId,homeId:f.homeId,awayId:f.awayId,forecastCapturedAt:f.capturedAt,startTime:g.startTime,recordedAt,observedAt:g.market.observedAt,marketHomeSpread:g.market.homeSpread,side,odds:finite(price)&&Number.isInteger(price)&&Math.abs(price)>=100?price:null,provider:g.market.provider,sourceUrl:g.sourceUrl,protocol:'first-available-market-v1'};
}

/** An annotated read view; the original persisted forecast is never updated. */
export function withFirstMarket(f,observation){
 if(!observation||f.marketHomeSpread!=null||f.cohort!=='live')return f;
 const g={id:observation.gameId,sport:f.sport,homeId:observation.homeId,awayId:observation.awayId,status:'scheduled',startTime:observation.startTime,sourceUrl:observation.sourceUrl,market:{homeSpread:observation.marketHomeSpread,observedAt:observation.observedAt,provider:observation.provider,homeSpreadPrice:observation.side==='home'?observation.odds:null,awaySpreadPrice:observation.side==='away'?observation.odds:null}};
 const checked=firstMarketObservation({...f,result:null},g,observation.recordedAt);
 if(!checked||observation.protocol!=='first-available-market-v1'||observation.forecastId!==f.id||observation.forecastCapturedAt!==f.capturedAt||observation.side!==checked.side)return f;
 return {...f,marketHomeSpread:checked.marketHomeSpread,side:checked.side,odds:checked.odds,provider:checked.provider,marketObservedAt:checked.observedAt,firstMarket:observation,originalMarket:{marketHomeSpread:f.marketHomeSpread??null,side:f.side??null,odds:f.odds??null,observedAt:f.marketObservedAt??null}};
}
