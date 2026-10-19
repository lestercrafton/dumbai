// Finish a `vinext build` for the Cloudflare free plan (wrangler.cloudflare.jsonc):
// 1. Put the read-cache entry (cloudflare/edge.mjs) next to the built app.
// 2. Save the server-rendered HTML of every page that does not depend on the
//    date as a static asset, so those page views never start the Worker.
//    The HTML comes from this same build, served locally, byte for byte.
// The home page renders today's date, so it stays in the Worker (cached per day).
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const site=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dist=path.join(site,'dist');
export const STATIC_PAGES=['/baseball-research','/challengers','/college-experiment','/learning-log','/notes/october-19-2026','/paper-ledger','/scoreboard','/tracked-results','/weekly-results'];

function copyEdge(){
 for(const f of ['edge.mjs','read-cache.mjs'])fs.copyFileSync(path.join(site,'cloudflare',f),path.join(dist,'server',f));
}
async function waitFor(url,ms){
 const end=Date.now()+ms;
 while(Date.now()<end){try{await fetch(url);return;}catch{}await new Promise(r=>setTimeout(r,500));}
 throw new Error('Local server did not start');
}
async function renderPages(){
 const port=Number(process.env.BV_RENDER_PORT||18932);
 const state=fs.mkdtempSync('/tmp/bv-pages-');
 const child=spawn(path.join(site,'node_modules/.bin/wrangler'),['dev','--config',path.join(dist,'server/wrangler.json'),'--port',String(port),'--ip','127.0.0.1','--local','--persist-to',state,'--log-level','error'],{cwd:site,stdio:['ignore','inherit','inherit'],env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
 const pages=[];
 try{
  await waitFor(`http://127.0.0.1:${port}/api/ledger`,90000);
  for(const route of STATIC_PAGES){
   const r=await fetch(`http://127.0.0.1:${port}${route}`);
   const html=await r.text();
   if(r.status!==200||!(r.headers.get('content-type')||'').startsWith('text/html'))throw new Error(`${route} returned ${r.status}`);
   pages.push({route,html,link:r.headers.get('link')});
  }
 }finally{child.kill('SIGTERM');}
 return pages;
}
function writePages(pages){
 const headers=[];
 for(const p of pages){
  const file=path.join(dist,'client',p.route.slice(1)+'.html');
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,p.html);
  if(p.link)headers.push(`${p.route}\n  Link: ${p.link}\n`);
 }
 const index=path.join(dist,'client','index.html');if(fs.existsSync(index))fs.rmSync(index);
 const file=path.join(dist,'client','_headers');
 const existing=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
 fs.writeFileSync(file,existing.trimEnd()+'\n\n# Static page preloads (same Link header the Worker sends)\n'+headers.join(''));
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 copyEdge();
 const pages=await renderPages();
 writePages(pages);
 console.log(`Cloudflare build ready: ${pages.length} static pages, read-cache entry in dist/server/edge.mjs`);
}
