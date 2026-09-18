/** Frozen forecasts and grading. Positive margin means home wins. */
export const MODEL_VERSION='ridge-v1';
export function reportingWeek(game){
 if(game.sport==='nfl'&&game.season&&game.week)return `${game.season}-W${String(game.week).padStart(2,'0')}`;
 const d=new Date(game.startTime);const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
 const t=new Date(day+'T12:00:00Z');t.setUTCDate(t.getUTCDate()-((t.getUTCDay()+6)%7));return t.toISOString().slice(0,10);
}
const finite=x=>typeof x==='number'&&Number.isFinite(x);
export function gradeForecast(f,game,observedAt=new Date().toISOString()){
 if(game.startTime&&Date.parse(game.startTime)>Date.parse(observedAt))return null;
 if(game.status==='cancelled')return {status:'void',outcome:'void',pnl:null,observedAt,sourceUrl:game.sourceUrl};
 if(!game.completed||game.status!=='completed'||!finite(game.homeScore)||!finite(game.awayScore)||game.homeScore<0||game.awayScore<0)return null;
 const actualMargin=game.homeScore-game.awayScore;
 const residual=finite(f.predictedMargin)?actualMargin-f.predictedMargin:null;
 const cover=finite(f.marketHomeSpread)&&f.side?(actualMargin+f.marketHomeSpread)*(f.side==='home'?1:-1):null;
 const outcome=cover===null?'no-line':Math.abs(cover)<1e-9?'push':cover>0?'win':'loss';
 const priced=finite(f.odds)&&Math.abs(f.odds)>=100;
 const pnl=!priced||cover===null?null:outcome==='push'?0:outcome==='loss'?-1:f.odds>0?f.odds/100:100/-f.odds;
 return {status:'completed',homeScore:game.homeScore,awayScore:game.awayScore,actualMargin,residual,absoluteError:residual===null?null:Math.abs(residual),marketAbsoluteError:finite(f.marketHomeSpread)?Math.abs(actualMargin+f.marketHomeSpread):null,outcome,pnl,observedAt,sourceUrl:game.sourceUrl,...(f.firstMarket?{marketObservation:{forecastId:f.id,observedAt:f.firstMarket.observedAt,recordedAt:f.firstMarket.recordedAt,protocol:f.firstMarket.protocol}}:{})};
}
export function summarizeForecasts(records){
 const finals=records.filter(f=>f.result?.status==='completed');
 const modeled=finals.filter(f=>finite(f.result.absoluteError));
 const matched=modeled.filter(f=>finite(f.result.marketAbsoluteError));
 const priced=finals.filter(f=>finite(f.result.pnl));
 const avg=(xs,key)=>xs.length?xs.reduce((s,f)=>s+f.result[key],0)/xs.length:null;
 const wins=finals.filter(f=>f.result.outcome==='win').length,losses=finals.filter(f=>f.result.outcome==='loss').length,pushes=finals.filter(f=>f.result.outcome==='push').length;
 const pnl=priced.length?priced.reduce((s,f)=>s+f.result.pnl,0):null;
 return {recorded:records.length,graded:finals.length,modeledFinals:modeled.length,pending:records.filter(f=>!f.result).length,voids:records.filter(f=>f.result?.status==='void').length,wins,losses,pushes,winRate:wins+losses?wins/(wins+losses):null,mae:avg(modeled,'absoluteError'),bias:avg(modeled,'residual'),rmse:modeled.length?Math.sqrt(modeled.reduce((s,f)=>s+f.result.residual**2,0)/modeled.length):null,matchedGames:matched.length,matchedModelMae:avg(matched,'absoluteError'),marketMae:avg(matched,'marketAbsoluteError'),pricedGames:priced.length,pnl,roi:pnl===null?null:pnl/priced.length};
}
