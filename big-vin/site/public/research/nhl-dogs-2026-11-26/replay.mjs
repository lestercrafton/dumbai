// NHL Kelly bankroll replay, Oct 22 – Nov 23 2026 (Central), current vs fixed rules.
import fs from 'node:fs';
const recsAll=JSON.parse(fs.readFileSync('/workspace/bv-clv-data/records-nhl.json'));
const END=Date.parse('2026-11-24T06:00:00.000Z'),FROM='2026-10-22',FROM_T=Date.parse('2026-10-22T05:00:00.000Z');
const recs=recsAll.filter(r=>Date.parse(r.startTime)<END);
const L=async d=>({kb:await import(d+'/kelly-bankroll.mjs'),pr:await import(d+'/pick-revisions.mjs')});
const base=await L('/workspace/bv-nhl-base/big-vin/site/lib'),curAll=await L('./libs/currentAll/lib'),fixed=await L('./libs/fixed/lib'),fixedAll=await L('./libs/fixedAll/lib');
const fin=x=>typeof x==='number'&&Number.isFinite(x);
// Item 1: re-select the side in the window with the fixed spreadSelection (both prices needed; else unchanged).
let flipped=0,withPrices=0;
const fixedRecs=recs.map(r=>{
 if(Date.parse(r.startTime)<FROM_T||!fin(r.predictedMargin)||!fin(r.marketHomeSpread))return r;
 if(fin(r.marketHomePrice)&&fin(r.marketAwayPrice))withPrices++;
 const s=fixed.pr.spreadSelection(r.predictedMargin,r.marketHomeSpread,fixed.pr.quotePrices('nhl',{marketHomePrice:r.marketHomePrice,marketAwayPrice:r.marketAwayPrice,marketObservedAt:r.marketObservedAt}));
 if(!s.side||s.side===r.side)return r;
 flipped++;
 return {...r,side:s.side,odds:s.side==='home'?r.marketHomePrice:r.marketAwayPrice};
});
const pay=o=>o>0?o/100:100/-o;
const summarize=(name,rep)=>{
 const inWin=rep.bets.filter(b=>Date.parse(b.t)>=FROM_T);
 const staked=inWin.filter(b=>b.amount>0);
 const g=inWin.filter(b=>b.outcome==='win'||b.outcome==='loss');
 return {rule:name,picks:inWin.length,flatRecord:`${g.filter(b=>b.outcome==='win').length}-${g.filter(b=>b.outcome==='loss').length}`,
  flatROI:+(g.reduce((s,b)=>s+(b.outcome==='win'?pay(b.odds):-1),0)/g.length).toFixed(3),
  dogShare:+(inWin.filter(b=>b.line>0).length/inWin.length).toFixed(3),
  kellyBets:staked.length,stakedRecord:`${staked.filter(b=>b.outcome==='win').length}-${staked.filter(b=>b.outcome==='loss').length}`,
  stakedDogShare:staked.length?+(staked.filter(b=>b.line>0).length/staked.length).toFixed(3):null,
  avgWinChanceStaked:staked.length?+(staked.reduce((s,b)=>s+b.winChance,0)/staked.length).toFixed(3):null,
  avgStake:+rep.averageStake.toFixed(3),maxStake:+rep.maxStake.toFixed(3),
  end:Math.round(rep.kelly.bankroll),change:+rep.kelly.change.toFixed(3),maxDrawdown:+rep.kelly.maxDrawdown.toFixed(3),reups:rep.kelly.reups,flat1pct:Math.round(rep.flat.bankroll)};
};
const opt={applyFrom:FROM};
const rows=[
 summarize('A. Current rules, as live (stars only from Nov 4)',base.kb.replayKellyBankroll(recs,opt)),
 summarize('B. Current rules, every positive-Kelly pick staked',curAll.kb.replayKellyBankroll(recs,opt)),
 summarize('C. Fixed side + 50/50 win chance, every positive-Kelly pick staked',fixedAll.kb.replayKellyBankroll(fixedRecs,opt)),
 summarize('D. Fixed rules as shipped (items 1-3: NHL unstaked)',fixed.kb.replayKellyBankroll(fixedRecs,opt)),
];
// Calibration of the win chance used, graded picks in window
const calib=(rep)=>{const g=rep.bets.filter(b=>Date.parse(b.t)>=FROM_T&&(b.outcome==='win'||b.outcome==='loss')&&fin(b.winChance));
 const bins=[[0,.4],[.4,.5],[.5,.6],[.6,.7],[.7,1]];return bins.map(([lo,hi])=>{const s=g.filter(b=>b.winChance>=lo&&b.winChance<hi);return {bin:`${lo}-${hi}`,n:s.length,predicted:s.length?+(s.reduce((t,b)=>t+b.winChance,0)/s.length).toFixed(3):null,actual:s.length?+(s.filter(b=>b.outcome==='win').length/s.length).toFixed(3):null};});};
const out={window:'Oct 22 – Nov 23, 2026 (Central)',picksInWindow:rows[0].picks,withBothPrices:withPrices,sidesFlipped:flipped,results:rows,
 calibrationCurrent:calib(curAll.kb.replayKellyBankroll(recs,opt)),calibrationFixed:calib(fixedAll.kb.replayKellyBankroll(fixedRecs,opt))};
// sanity: A equals live replay restricted? record the full-history live numbers too
const full=base.kb.replayKellyBankroll(recs,{});out.fullHistoryCurrent={end:Math.round(full.kelly.bankroll),bets:full.betCount};
fs.writeFileSync('replay.json',JSON.stringify(out,null,1));
console.log(JSON.stringify({...out,results:undefined},null,1));console.table(rows);
