/** NHL puck-line pricing (owner decision, Nov 26 2026; research: public/research/nhl-dogs-2026-11-26).
 *
 * The NHL puck line is almost always ±1.5. Comparing the model's expected margin
 * with 1.5 while ignoring the price made Big Vin take the +1.5 side in 97% of
 * games, and the price-blind bucket win chance (earned mostly at about −200)
 * made Kelly treat cheap prices, even a +114 −1.5, as ~61% bets.
 *
 * From NHL_PRICE_AWARE_FROM on:
 * 1. Side: the cover chance for each side comes from the model margin (normal,
 *    MARGIN_SIGMA.nhl = 2.6 goals); take the side with the better expected value
 *    at its own price.
 * 2. Win chance (ranking, Kelly %): 50% that model cover chance + 50% the
 *    market's no-vig chance from both puck-line prices.
 * 3. No NHL stars and no NHL bankroll stakes until a walk-forward test shows an
 *    edge (revisit at about 500 graded games). Picks are still shown and graded.
 * Earlier games keep the rules they were picked and staked under. */
import {winProbability,moneylineExpectedValue} from './moneyline.mjs';
export const NHL_PRICE_AWARE_FROM='2026-11-27T06:00:00.000Z'; // Nov 27, 2026, 12:00 AM Central
export const NHL_MODEL_WEIGHT=0.5;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const price=x=>finite(x)&&Number.isInteger(x)&&Math.abs(x)>=100?x:null;
const payout=o=>o>0?o/100:100/-o;
const breakEven=o=>1/(1+payout(o));
/** True when the NHL price-aware rules apply at this ISO time. Missing or bad times keep the old rules. */
export function nhlPriceAware(sport,iso){
 if(sport!=='nhl'||typeof iso!=='string')return false;
 const t=Date.parse(iso);return Number.isFinite(t)&&t>=Date.parse(NHL_PRICE_AWARE_FROM);
}
/** Model chance that `side` covers its line, from the home margin and home spread. */
export function nhlCoverChance(margin,homeSpread,side){
 if(!finite(margin)||!finite(homeSpread)||!(side==='home'||side==='away'))return null;
 const home=winProbability(margin+homeSpread,'nhl');
 return home===null?null:side==='home'?home:1-home;
}
/** Market no-vig chance for `side`; with only the side's price, its break-even (vig included). */
export function nhlMarketChance(side,homePrice,awayPrice){
 const h=price(homePrice),a=price(awayPrice),own=side==='home'?h:a,other=side==='home'?a:h;
 if(own===null)return null;
 if(other===null)return breakEven(own);
 const p=breakEven(own),q=breakEven(other);return p/(p+q);
}
/** Side with the better expected value at each side's price; null when either price is missing. */
export function nhlSelection(margin,homeSpread,homePrice,awayPrice){
 const h=price(homePrice),a=price(awayPrice),p=nhlCoverChance(margin,homeSpread,'home');
 if(h===null||a===null||p===null)return null;
 const home=moneylineExpectedValue(p,h),away=moneylineExpectedValue(1-p,a);
 if(home===null||away===null)return null;
 const side=home>away||(home===away&&margin+homeSpread>=0)?'home':'away';
 return {side,value:(side==='home'?home:away)/100,coverChance:side==='home'?p:1-p};
}
/** Blended win chance used for NHL ranking and Kelly %. */
export function nhlWinChance({margin,homeSpread,side,homePrice,awayPrice,odds}){
 const model=nhlCoverChance(margin,homeSpread,side);
 if(model===null)return null;
 const hp=finite(homePrice)?homePrice:side==='home'?odds:null,ap=finite(awayPrice)?awayPrice:side==='away'?odds:null;
 const market=nhlMarketChance(side,hp,ap);
 const blended=market===null?NHL_MODEL_WEIGHT*model+(1-NHL_MODEL_WEIGHT)*breakEven(-110):NHL_MODEL_WEIGHT*model+(1-NHL_MODEL_WEIGHT)*market;
 return {winChance:blended,modelChance:model,marketChance:market};
}
