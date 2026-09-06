'use strict';
function runWorld(data,conditions){
 const P=data.players,N=data.scores_cents.length,split=data.selection_count,canon=x=>x==='LA'?'LAR':x;
 const gameIndex=Object.fromEntries(data.games.map((g,i)=>[g.game_id,i]));
 const totals=data.game_scores.map(row=>row.reduce((s,g)=>s+g[0]+g[1],0)),training=totals.slice(0,split).sort((a,b)=>a-b),low=training[Math.floor(.25*(training.length-1))],high=training[Math.floor(.75*(training.length-1))];
 const matches=k=>conditions.every(c=>{if(c.kind==='theme')return c.value==='low'?totals[k]<=low:totals[k]>=high;if(c.kind==='player')return data.scores_cents[k][c.index]>=c.min*100;const j=gameIndex[c.game];if(j===undefined)return false;const score=data.game_scores[k][j],game=data.games[j];if(c.kind==='total')return c.op==='under'?score[0]+score[1]<c.value:score[0]+score[1]>c.value;return (canon(game.home)===c.team?score[1]-score[0]:score[0]-score[1])>=c.margin;});
 const train=[],test=[];for(let k=0;k<N;k++)if(matches(k))(k<split?train:test).push(k);
 if(train.length<30||test.length<30)throw Error(`Too little support: ${train.length} selection and ${test.length} evaluation worlds match. Broaden the condition; Milly will not invent confidence for a rare world.`);
 const means=P.map((_,i)=>train.reduce((s,k)=>s+data.scores_cents[k][i]/100,0)/train.length);
 let seed=271828;const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
 function solve(coef,flex){
  const needs={QB:1,RB:2,WR:3,TE:1,DST:1};needs[flex]++;let combined=Array(501).fill(null);combined[0]={v:0,ids:[]};
  for(const pos of ['QB','RB','WR','TE','DST']){
   const need=needs[pos],dp=Array.from({length:need+1},()=>Array(501).fill(null));dp[0][0]={v:0,ids:[]};
   for(let i=0;i<P.length;i++)if(P[i].position===pos){const cost=P[i].salary/100;if(!Number.isInteger(cost))throw Error('Unexpected salary increment.');for(let k=need;k>=1;k--)for(let b=500;b>=cost;b--){const prior=dp[k-1][b-cost];if(prior){const v=prior.v+coef[i];if(!dp[k][b]||dp[k][b].v<v)dp[k][b]={v,ids:[...prior.ids,i]}}}}
   const options=[];for(let b=0;b<=500;b++)if(dp[need][b])options.push([b,dp[need][b]]);
   const next=Array(501).fill(null);for(let b=0;b<=500;b++)if(combined[b])for(const [c,o] of options){if(b+c>500)break;const v=combined[b].v+o.v;if(!next[b+c]||next[b+c].v<v)next[b+c]={v,ids:[...combined[b].ids,...o.ids]}}combined=next;
  }
  let best=null;for(const x of combined)if(x&&(!best||x.v>best.v)&&new Set(x.ids.map(i=>P[i].game_id)).size>=2)best=x;return best&&best.ids;
 }
 const seen=new Set(),candidates=[],flexes=[];
 function add(ids,flex){if(!ids||ids.length!==9||new Set(ids).size!==9||ids.reduce((s,i)=>s+P[i].salary,0)>50000||new Set(ids.map(i=>P[i].game_id)).size<2)return;const key=[...ids].sort((a,b)=>a-b).join(',');if(!seen.has(key)){seen.add(key);candidates.push(ids);flexes.push(flex)}}
 data.candidates.forEach((ids,i)=>add(ids,data.flex_types[i]));
 for(const flex of ['RB','WR','TE'])for(let z=0;z<10;z++){const k=train[Math.floor(rng()*train.length)],coef=means.map((m,i)=>z===0?m:.55*m+.45*data.scores_cents[k][i]/100+(rng()-.5));add(solve(coef,flex),flex)}
 const score=(k,ids)=>ids.reduce((s,i)=>s+data.scores_cents[k][i],0);
 // Strict wins only: benchmark duplicate tie counts are absent from this browser slice.
 const ranks=candidates.map((ids,j)=>({j,rate:train.reduce((s,k)=>s+(score(k,ids)>data.benchmark_cents[k]?1:0),0)/train.length,mean:ids.reduce((s,i)=>s+means[i],0)})).sort((a,b)=>b.rate-a.rate||b.mean-a.mean),out=[];
 for(const {j} of ranks.slice(0,3)){
  const ids=candidates[j],remaining=[...ids],slots=[];
  for(const slot of ['QB','RB1','RB2','WR1','WR2','WR3','TE','FLEX','DST']){const pos=slot.replace(/[123]/g,'');const at=remaining.findIndex(i=>slot==='FLEX'?['RB','WR','TE'].includes(P[i].position):P[i].position===pos);if(at<0)throw Error('Roster slot mapping failed');const i=remaining.splice(at,1)[0];slots.push({...P[i],slot})}
  const successful=test.filter(k=>score(k,ids)>data.benchmark_cents[k]);successful.sort((a,b)=>score(a,ids)-score(b,ids));const k=successful[Math.floor(successful.length/2)];
  const witness=k===undefined?null:{world_id:k,lineup_score:score(k,ids)/100,benchmark_best:data.benchmark_cents[k]/100,player_scores:ids.map(i=>({name:P[i].name,points:data.scores_cents[k][i]/100})),games:data.games.map((g,j)=>({...g,away_score:data.game_scores[k][j][0],home_score:data.game_scores[k][j][1]})),kind:'A held-out statistical joint-score draw conditioned on your confirmed belief; not a reconciled box score'};
  out.push({rank:out.length+1,players:slots,flex:flexes[j],salary:ids.reduce((s,i)=>s+P[i].salary,0),model_mean:test.reduce((s,k)=>s+score(k,ids)/100,0)/test.length,winning_world:witness,explanation:'Selected for your confirmed conditions. The main twenty remain unchanged. A successful world must satisfy your conditions AND outperform the same hypothetical benchmark.',failure_modes:['Your belief can be wrong. Even when correct, the points may go to other players.','The model uses statistical dependence, not conserved football events or verified tournament ownership.']})
 }
 return {selection_count:train.length,evaluation_count:test.length,frequency:(train.length+test.length)/N,candidates:candidates.length,lineups:out};
}
if(typeof self!=='undefined')self.onmessage=ev=>{try{self.postMessage(runWorld(ev.data.data,ev.data.conditions))}catch(e){self.postMessage({error:e.message})}};
if(typeof module!=='undefined')module.exports={runWorld};
