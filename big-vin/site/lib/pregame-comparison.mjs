import {displayLines} from './board-presentation.mjs';

const finite=value=>typeof value==='number'&&Number.isFinite(value);

/** A fresh offer for the saved pick's team, separate from its grading inputs.
 * Never move a started game's line, change its side, or recalculate its rank.
 */
export function pregameComparison(game={}, {now=Date.now()}={}) {
  const quote=game.moneylineMarket;
  const start=Date.parse(game.startTime),observed=Date.parse(quote?.observedAt);
  if(game.status!=='scheduled'||game.completed||['completed','void'].includes(game.result?.status)||game.paperWager
    ||!finite(now)||!Number.isFinite(start)||start<=now||!quote||quote.timing!=='current-displayed-snapshot'
    ||!Number.isFinite(observed)||observed>now||now-observed>30*60*1000||!finite(quote.homeSpread))return null;
  const lines=displayLines(game);
  const marketLine=lines.side==='away'?-quote.homeSpread:quote.homeSpread;
  return {marketLine:marketLine===0?0:marketLine,
    edge:lines.side&&finite(lines.fairLine)?marketLine-lines.fairLine:null,
    savedLine:game.archived?lines.marketLine:null,provider:quote.provider||'Sportsbook',observedAt:quote.observedAt};
}
