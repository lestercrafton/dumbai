// Fingerprint of the code that shapes cached API bodies. The Worker build and
// the read-cache renderer compute it the same way, so a cached body made by
// older code is never served after a deploy (see cloudflare/edge.mjs).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const CODE=/\.(mjs|js|ts|tsx|json)$/;
function walk(dir,out){
 for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:1)){
  const p=path.join(dir,e.name);
  if(e.isDirectory())walk(p,out);else if(CODE.test(e.name)&&!/\.test\./.test(e.name))out.push(p);
 }
 return out;
}
export function computeBuildId(site){
 const h=crypto.createHash('sha256');
 for(const dir of ['lib','app/api'])for(const f of walk(path.join(site,dir),[]))h.update(path.relative(site,f)+'\0').update(fs.readFileSync(f)).update('\0');
 return h.digest('hex').slice(0,16);
}
