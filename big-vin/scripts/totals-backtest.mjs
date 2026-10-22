/** Walk-forward NFL totals backtest on nflverse games: weekly refits, closing totals from nflverse. */
import fs from 'node:fs';
import {fitTotals,projectTotal,totalPick,gradeTotal} from '../lib/totals.mjs';
const A={LA:'LAR',STL:'LAR',SD:'LAC',OAK:'LV'};
export function parse(text){const [h,...rows]=text.trim().split('\n').map(l=>l.split(','));return rows.map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]])));}
export function nflGames(rows){return rows.filter(r=>+r.season>=2015).map(r=>({season:+r.season,week:+r.week,date:r.gameday,homeId:A[r.home_team]||r.home_team,awayId:A[r.away_team]||r.away_team,homeScore:r.home_score===''?null:+r.home_score,awayScore:r.away_score===''?null:+r.away_score,neutral:r.location==='Neutral',wind:r.wind===''?null:+r.wind,dome:['dome','closed'].includes(r.roof),marketTotal:r.total_line===''?null:+r.total_line}));}
export function backtest(games,{seasons,config}={}){
 const out=[];
 for(const s of seasons){const weeks=[...new Set(games.filter(g=>g.season===s).map(g=>g.week))].sort((a,b)=>a-b);
  for(const w of weeks){const wk=games.filter(g=>g.season===s&&g.week===w&&g.homeScore!==null);if(!wk.length)continue;
   const asOf=wk.map(g=>g.date).sort()[0];const m=fitTotals(games,{sport:'nfl',asOf,config});
   for(const g of wk){const p=projectTotal(g,m,{wind:g.dome?null:g.wind,dome:g.dome});if(!p||g.marketTotal===null)continue;
    const actual=g.homeScore+g.awayScore,pick=totalPick({sport:'nfl',total:p.total,marketTotal:g.marketTotal,weatherEffect:p.weatherEffect});
    out.push({s,w,actual,model:p.total,market:g.marketTotal,pick,result:gradeTotal(pick.side,g.marketTotal,actual)});}}}
 return out;
}
export function summarize(rows){
 const mae=k=>rows.reduce((a,r)=>a+Math.abs(r[k]-r.actual),0)/rows.length;
 const rec=f=>{const x=rows.filter(f);const w=x.filter(r=>r.result==='win').length,l=x.filter(r=>r.result==='loss').length;return {picks:w+l,wins:w,losses:l,hitRate:w+l?+(w/(w+l)).toFixed(3):null};};
 return {games:rows.length,modelMae:+mae('model').toFixed(2),marketMae:+mae('market').toFixed(2),all:rec(()=>true),edge2plus:rec(r=>r.pick.edge>=2),edge3plus:rec(r=>r.pick.edge>=3),reviewed:rec(r=>r.pick.check?.review)};
}
if(import.meta.url===`file://${process.argv[1]}`){
 const text=fs.existsSync(process.argv[2]||'')?fs.readFileSync(process.argv[2],'utf8'):await (await fetch('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv')).text();
 const g=nflGames(parse(text));
 for(const seasons of [[2021,2022],[2023,2024,2025]])console.log(seasons.join('+'),JSON.stringify(summarize(backtest(g,{seasons}))));
}
