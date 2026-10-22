/** Weekly check: does Big Vin's line carry information the market line lacks?
 * Fits final margin = a + b*(market line) + c*(our line - market line) on saved,
 * graded live picks. c near 0 means our difference adds nothing. Public API only. */
import fs from 'node:fs';
const site=process.env.BIG_VIN_SITE_URL||'https://big-vin.lestercrafton.workers.dev';
const SPORTS=['nfl','cfb','nba','wnba','cbb'];
const out='data/regression/spread.json';
const once=async path=>{const r=await fetch(site+path,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error(`${path} ${r.status}`);return r.json();};
const get=async path=>{for(let i=0;;i++){try{return await once(path);}catch(error){if(i>=3)throw error;await new Promise(done=>setTimeout(done,3000*(i+1)));}}};
const finite=x=>typeof x==='number'&&Number.isFinite(x);
export function fit(rows){
 const n=rows.length;if(n<30)return {games:n,ready:false};
 const X=rows.map(r=>[1,r.market,r.diff]),y=rows.map(r=>r.actual);
 const xtx=[0,1,2].map(i=>[0,1,2].map(j=>X.reduce((s,x)=>s+x[i]*x[j],0))),xty=[0,1,2].map(i=>X.reduce((s,x,k)=>s+x[i]*y[k],0));
 const inv=invert3(xtx);if(!inv)return {games:n,ready:false};
 const beta=inv.map(row=>row.reduce((s,v,j)=>s+v*xty[j],0));
 const resid=y.map((v,k)=>v-X[k].reduce((s,x,j)=>s+x*beta[j],0)),sigma2=resid.reduce((s,e)=>s+e*e,0)/(n-3);
 const se=Math.sqrt(sigma2*inv[2][2]),t=beta[2]/se;
 return {games:n,ready:true,marketWeight:beta[1],ourExtraWeight:beta[2],standardError:se,t,addsInformation:t>=1.96,hurts:t<=-1.96};
}
function invert3(m){
 const [[a,b,c],[d,e,f],[g,h,i]]=m,A=e*i-f*h,B=-(d*i-f*g),C=d*h-e*g,det=a*A+b*B+c*C;if(Math.abs(det)<1e-9)return null;
 return [[A,-(b*i-c*h),b*f-c*e],[B,a*i-c*g,-(a*f-c*d)],[C,-(a*h-b*g),a*e-b*d]].map(r=>r.map(v=>v/det));
}
async function rowsFor(sport){
 const overview=await get(`/api/results?sport=${sport}&cohort=live`),rows=[];
 for(const week of overview.weeks||[]){
  if(!week.graded)continue;
  const data=await get(`/api/results?sport=${sport}&cohort=live&week=${encodeURIComponent(week.key)}`);
  for(const f of data.records||[]){
   const r=f.result;if(r?.status!=='completed'||!finite(r.actualMargin)||!finite(f.predictedMargin)||!finite(f.marketHomeSpread))continue;
   rows.push({market:-f.marketHomeSpread,diff:f.predictedMargin+f.marketHomeSpread,actual:r.actualMargin});
  }
 }
 return rows;
}
export async function run(){
 const sports={},all=[];
 for(const sport of SPORTS){try{const rows=await rowsFor(sport);all.push(...rows);sports[sport]=fit(rows);}catch(error){console.log(`${sport}: skipped (${error.message})`);}}
 if(!Object.keys(sports).length){console.log('Line check skipped: results unavailable');return;}
 const next={method:'Final margin = a + b × market line + c × (our line − market line), ordinary least squares on saved graded live picks.',all:fit(all),sports};
 const previous=fs.existsSync(out)?JSON.parse(fs.readFileSync(out,'utf8')):null;
 if(previous&&JSON.stringify({...previous,updatedAt:null})===JSON.stringify({...next,updatedAt:null})){console.log('Line check unchanged');return;}
 fs.writeFileSync(out,JSON.stringify({...next,updatedAt:new Date().toISOString()},null,1)+'\n');
 console.log('Line check',JSON.stringify(next.all));
}
if(import.meta.url===`file://${process.argv[1]}`)await run().catch(error=>console.log('Line check skipped:',error.message));
