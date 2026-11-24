// The local replay must match the live /api/bankroll before any comparison.
import fs from 'node:fs';
import {replayKellyBankroll} from '../../../lib/kelly-bankroll.mjs';
const DATA=process.env.DATA||'/workspace/bv-clv-data';
const totals=JSON.parse(fs.readFileSync(new URL('../../../../data/totals/nba.json',import.meta.url)));
for(const s of ['cfb','cbb','nba','nfl','nhl','mlb','wnba']){
 const recs=JSON.parse(fs.readFileSync(`${DATA}/records-${s}.json`));
 const live=JSON.parse(fs.readFileSync(`${DATA}/bankroll-${s}.json`)).sports[0];
 const rep=replayKellyBankroll(recs,{includeLegacy:s==='mlb',totals:s==='nba'?totals:null});
 console.log(s,'picks',rep.picks,live.picks,'staked',rep.betCount,live.betCount,'end',Math.round(rep.kelly.bankroll),Math.round(live.kelly.bankroll));
}
