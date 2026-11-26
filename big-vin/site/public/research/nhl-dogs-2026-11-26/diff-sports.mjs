// Before/after on stored snapshots: main (bv-nhl-base) vs branch (bv-nhl-fix).
import fs from 'node:fs';
const B='/workspace/bv-nhl-base/big-vin/site/lib/',N='/workspace/bv-nhl-fix/big-vin/site/lib/';
const load=async root=>({kb:await import(root+'kelly-bankroll.mjs'),pr:await import(root+'pick-revisions.mjs'),rs:await import(root+'rank-signal.mjs')});
const base=await load(B),next=await load(N);
const totalsNba=JSON.parse(fs.readFileSync('/workspace/bv-nhl-fix/big-vin/data/totals/nba.json'));
const FUTURE='2026-12-05T00:00:00.000Z';
const out={};
for(const sport of ['cfb','cbb','nba','nfl','nhl','mlb','wnba']){
 const recs=JSON.parse(fs.readFileSync(`/workspace/bv-clv-data/records-${sport}.json`));
 const opts={includeLegacy:sport==='mlb',totals:sport==='nba'?totalsNba:null};
 const a=JSON.stringify(base.kb.replayKellyBankroll(recs,opts)),b=JSON.stringify(next.kb.replayKellyBankroll(recs,opts));
 let sideDiff=0,sideDiffFuture=0,scoreDiff=0,scoreDiffFuture=0,starDiff=0,starDiffFuture=0,n=0;
 const sigB=base.rs.learnRankSignal(recs),sigN=next.rs.learnRankSignal(recs);
 const sigSame=JSON.stringify(sigB)===JSON.stringify(sigN);
 for(const r of recs){
  if(!Number.isFinite(r.predictedMargin)||!Number.isFinite(r.marketHomeSpread))continue;n++;
  for(const [at,which] of [[r.marketObservedAt,'now'],[FUTURE,'future']]){
   const q={marketHomePrice:r.marketHomePrice,marketAwayPrice:r.marketAwayPrice,marketObservedAt:at,observedAt:at};
   const sa=base.pr.spreadSelection(r.predictedMargin,r.marketHomeSpread,base.pr.quotePrices(sport,q));
   const sb=next.pr.spreadSelection(r.predictedMargin,r.marketHomeSpread,next.pr.quotePrices(sport,q));
   if(JSON.stringify(sa)!==JSON.stringify(sb))which==='now'?sideDiff++:sideDiffFuture++;
   const side=r.side;if(side!=='home'&&side!=='away')continue;
   const st=which==='now'?r.startTime:FUTURE;
   const args={side,homeSpread:r.marketHomeSpread,edge:Math.abs(r.predictedMargin+r.marketHomeSpread),odds:r.odds,sport,margin:r.predictedMargin,homePrice:r.marketHomePrice,awayPrice:r.marketAwayPrice,startTime:st};
   const ga=base.rs.scoreGame(sigB,args),gb=next.rs.scoreGame(sigN,args);
   if(JSON.stringify(ga)!==JSON.stringify(gb))which==='now'?scoreDiff++:scoreDiffFuture++;
   const game={neutralSite:r.neutralSite,edge:args.edge,startTime:st};
   if(String(base.rs.advantageRule(sport,game,ga))!==String(next.rs.advantageRule(sport,game,gb)))which==='now'?starDiff++:starDiffFuture++;
  }
 }
 out[sport]={records:recs.length,priced:n,bankrollReplayIdentical:a===b,rankSignalIdentical:sigSame,sideDiff,scoreDiff,starDiff,sideDiff_ifQuotedAfterNov27:sideDiffFuture,scoreDiff_ifStartingAfterNov27:scoreDiffFuture,starDiff_ifStartingAfterNov27:starDiffFuture};
}
fs.writeFileSync('diff-sports.json',JSON.stringify(out,null,1));console.table(out);
