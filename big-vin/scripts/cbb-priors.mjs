/** College basketball preseason priors from free sources.
 * Torvik (barttorvik.com) final adjusted efficiency and tempo for the prior
 * season, plus roster continuity from ESPN box scores: the share of last
 * season's minutes that return, and incoming transfers valued by their old
 * minutes share times their old team's efficiency margin. Coefficients are
 * fitted on the 2024-25 season only (target: that season's final Torvik
 * margin) and then applied unchanged to later seasons.
 * Usage: BOX_DIR=/path node scripts/cbb-priors.mjs   (box-cbb-2024.json,
 * box-cbb.json, games-cbb-2024.json). Writes site/lib/cbb-priors.json. */
import fs from 'node:fs';
const BOX=process.env.BOX_DIR||'/workspace/research-nba';
const UA={headers:{'User-Agent':'Mozilla/5.0 big-vin'}};
const get=async(u,t='json')=>{for(let i=0;i<3;i++){try{const r=await fetch(u,UA);if(r.ok)return t==='json'?r.json():r.text();}catch{}}return null;};
const norm=s=>s.toLowerCase().replace(/&/g,'and').replace(/state/g,'st').replace(/saint/g,'st').replace(/[^a-z0-9]/g,'');
const ALIAS={'App State':'Appalachian St.','California Baptist':'Cal Baptist','Grambling':'Grambling St.','Kansas City':'UMKC','LSU New Orleans':'New Orleans','Long Island University':'LIU','McNeese':'McNeese St.','Miami':'Miami FL','Nicholls':'Nicholls St.','Ole Miss':'Mississippi','Omaha':'Nebraska Omaha','SE Louisiana':'Southeastern Louisiana','Sam Houston':'Sam Houston St.','San José State':'San Jose St.','Seattle U':'Seattle','South Carolina Upstate':'USC Upstate','Texas A&M-Corpus Christi':'Texas A&M Corpus Chris','UAlbany':'Albany','UConn':'Connecticut','UIC':'Illinois Chicago','UL Monroe':'Louisiana Monroe','UT Martin':'Tennessee Martin'};
const seasonOf=d=>{const y=+d.slice(0,4),m=+d.slice(5,7);return m>=8?y+1:y;};
const csv=t=>{const [h,...rows]=t.trim().split(/\r?\n/);const k=h.split(',');return rows.map(r=>{const v=[];let cur='',q=false;for(const ch of r){if(ch==='"')q=!q;else if(ch===','&&!q){v.push(cur);cur='';}else cur+=ch;}v.push(cur);return Object.fromEntries(k.map((x,i)=>[x,v[i]]));});};
const teams=(await get('https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams?limit=1000')).sports[0].leagues[0].teams.map(x=>x.team);
const torvik={};
for(const y of [2024,2025,2026]){const t=await get(`https://barttorvik.com/${y}_team_results.csv`,'text');if(!t)throw new Error('Torvik '+y+' unavailable');torvik[y]=Object.fromEntries(csv(t).map(r=>[norm(r.team),{margin:+r.adjoe-+r.adjde,tempo:+r.adjt}]));}
const nameOf={};for(const t of teams){const c=[ALIAS[t.location],t.location,t.shortDisplayName,t.displayName].filter(Boolean).map(norm).find(c=>torvik[2026][c]||torvik[2025][c]);if(c)nameOf[t.id]=c;}
// minutes by season -> team -> athlete
const dates={};for(const f of ['games-cbb-2024.json']){for(const g of JSON.parse(fs.readFileSync(`${BOX}/${f}`)).games)dates[g.id]=g.date;}
for(const g of JSON.parse(fs.readFileSync('data/totals/history-cbb.json')).games)dates[g.id]=g.date;
const mins={};
for(const f of ['box-cbb-2024.json','box-cbb.json']){const box=JSON.parse(fs.readFileSync(`${BOX}/${f}`));for(const [gid,tm] of Object.entries(box)){const d=dates[gid];if(!d)continue;const s=seasonOf(d);for(const [tid,rows] of Object.entries(tm))for(const [aid,m] of rows){if(!(m>0))continue;((mins[s]??={})[tid]??={})[aid]=(mins[s][tid][aid]??0)+m;}}}
const rosters={2025:{},2026:{}};for(const s of [2025,2026])for(const [tid,ps] of Object.entries(mins[s]||{}))rosters[s][tid]=new Set(Object.keys(ps));
rosters[2027]={};
await Promise.all(teams.map(async t=>{const d=await get(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams/${t.id}/roster`);if(d?.athletes)rosters[2027][t.id]=new Set(d.athletes.map(a=>String(a.id)));}));
const features={};
for(const S of [2025,2026,2027]){
 const prev=mins[S-1]||{},tv=torvik[S-1],where={};
 for(const [tid,ps] of Object.entries(prev)){const tot=Object.values(ps).reduce((a,b)=>a+b,0);for(const [aid,m] of Object.entries(ps))if(!where[aid]||where[aid].share<m/tot)where[aid]={tid,share:m/tot};}
 features[S]={};
 for(const t of teams){const n=nameOf[t.id],p=n&&tv[n];if(!p)continue;const roster=rosters[S][t.id];let ret=null,trIn=null;
  if(roster&&prev[t.id]){ret=0;trIn=0;for(const aid of roster){const w=where[aid];if(!w)continue;if(w.tid===t.id)ret+=w.share;else{const o=nameOf[w.tid]&&tv[nameOf[w.tid]];if(o)trIn+=w.share*o.margin;}}}
  features[S][t.id]={margin:+p.margin.toFixed(2),tempo:+p.tempo.toFixed(2),returning:ret===null?null:+ret.toFixed(3),transferIn:trIn===null?null:+trIn.toFixed(2),target:torvik[S]?.[n]?+torvik[S][n].margin.toFixed(2):null};}
}
// least squares fit on 2025 rows
const ols=(X,y)=>{const k=X[0].length,A=Array.from({length:k},()=>Array(k+1).fill(0));X.forEach((x,r)=>{for(let i=0;i<k;i++){for(let j=0;j<k;j++)A[i][j]+=x[i]*x[j];A[i][k]+=x[i]*y[r];}});for(let i=0;i<k;i++){const p=A[i][i];for(let j=i;j<=k;j++)A[i][j]/=p;for(let r=0;r<k;r++)if(r!==i){const f=A[r][i];for(let j=i;j<=k;j++)A[r][j]-=f*A[i][j];}}return A.map(r=>r[k]);};
const rowsFor=S=>Object.values(features[S]).filter(f=>f.target!==null&&f.returning!==null);
const fx=f=>[1,f.margin,f.margin*f.returning,f.transferIn,f.returning],fm=f=>[1,f.margin];
const fitRows=rowsFor(2025),roster=ols(fitRows.map(fx),fitRows.map(f=>f.target)),marginOnly=ols(fitRows.map(fm),fitRows.map(f=>f.target));
const r2=(S,X,c)=>{const r=rowsFor(S);const m=r.reduce((a,f)=>a+f.target,0)/r.length;let se=0,st=0;for(const f of r){const p=X(f).reduce((a,x,i)=>a+x*c[i],0);se+=(f.target-p)**2;st+=(f.target-m)**2;}return {teams:r.length,r2:+(1-se/st).toFixed(3),rmse:+Math.sqrt(se/r.length).toFixed(2)};};
const out={builtAt:new Date().toISOString(),sources:['https://barttorvik.com/{year}_team_results.csv','ESPN box scores and team rosters'],
 coefficients:{roster:roster.map(x=>+x.toFixed(4)),rosterTerms:['intercept','priorMargin','priorMargin×returningShare','transferInValue','returningShare'],marginOnly:marginOnly.map(x=>+x.toFixed(4))},
 fit:{season2025:{roster:r2(2025,fx,roster),marginOnly:r2(2025,fm,marginOnly)},holdout2026:{roster:r2(2026,fx,roster),marginOnly:r2(2026,fm,marginOnly)}},
 avgTempo:Object.fromEntries([2025,2026,2027].map(S=>{const v=Object.values(features[S]).map(f=>f.tempo);return [S,+(v.reduce((a,b)=>a+b,0)/v.length).toFixed(2)];})),
 seasons:features};
fs.writeFileSync('site/lib/cbb-priors.json',JSON.stringify(out));
console.log(JSON.stringify({coefficients:out.coefficients,fit:out.fit,avgTempo:out.avgTempo,teams:Object.fromEntries(Object.entries(features).map(([s,f])=>[s,[Object.keys(f).length,Object.values(f).filter(x=>x.returning!==null).length]]))},null,1));
