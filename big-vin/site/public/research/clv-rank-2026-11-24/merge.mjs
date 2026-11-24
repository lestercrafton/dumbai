// Merge weekly tracked-history pulls (/api/results?sport=S&history=1&historyDate=D)
// into one record file per sport. DATA defaults to /workspace/bv-clv-data.
import fs from 'node:fs';
const DATA=process.env.DATA||'/workspace/bv-clv-data';
for(const s of ['cfb','cbb','nba','nfl','nhl','mlb','wnba']){
 const map=new Map();
 for(const f of fs.readdirSync(DATA+'/res').filter(f=>f.startsWith(s+'-')).sort()){
  const d=JSON.parse(fs.readFileSync(DATA+'/res/'+f));if(d.error)throw new Error(f+': '+d.error);
  for(const r of d.records||[])map.set(r.id,r);
 }
 fs.writeFileSync(`${DATA}/records-${s}.json`,JSON.stringify([...map.values()]));
 console.log(s,map.size);
}
