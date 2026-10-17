const finite=value=>typeof value==='number'&&Number.isFinite(value);
const reconstructed='cfb-reconstructed-2026-09-26';

/** Add a paper wager to a read view without altering the stored forecast.
 * The model margin is already frozen. Archived opening quotes choose and price
 * a spread side; games without a book quote use a disclosed even-money winner
 * contract so every requested model pick has a bankroll result.
 */
export function withCfbPaperWager(record,openingOdds){
 if(record.origin!==reconstructed)return record;
 if(openingOdds?.date!=='2026-09-26'||!Array.isArray(openingOdds.entries)||!finite(record.predictedMargin)||record.predictedMargin===0)throw new Error('Invalid September 26 paper-wager inputs.');
 const entry=openingOdds.entries.find(row=>row.eventId===String(record.gameId));
 if(!entry)throw new Error(`Missing opening-odds source for ${record.gameId}.`);
 const quoted=finite(entry.homeOpeningSpread)&&finite(entry.awayOpeningSpread)&&Math.abs(entry.homeOpeningSpread+entry.awayOpeningSpread)<1e-9;
 const absent=[entry.homeOpeningSpread,entry.awayOpeningSpread,entry.homeOpeningPrice,entry.awayOpeningPrice].every(value=>value===null);
 if(!quoted&&!absent)throw new Error(`Incomplete opening quote for ${record.gameId}.`);
 if(quoted){
  const edge=record.predictedMargin+entry.homeOpeningSpread;
  const side=edge>0?'home':edge<0?'away':null;
  const odds=side==='home'?entry.homeOpeningPrice:entry.awayOpeningPrice;
  if(!side||!Number.isInteger(odds)||Math.abs(odds)<100)throw new Error(`Invalid opening position for ${record.gameId}.`);
  return {...record,paperWager:{kind:'archived-opening-spread',side,homeSpread:entry.homeOpeningSpread,odds,provider:entry.provider,sourceUrl:entry.sourceUrl,retrievedAt:entry.sourceRetrievedAt,edge}};
 }
 const side=record.predictedMargin>0?'home':'away';
 return {...record,paperWager:{kind:'synthetic-winner-even',side,homeSpread:0,odds:100,provider:null,sourceUrl:entry.sourceUrl,retrievedAt:entry.sourceRetrievedAt,edge:null}};
}
