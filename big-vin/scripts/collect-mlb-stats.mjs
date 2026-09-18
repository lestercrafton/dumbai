import {verifyBaseball} from './cloud-state.mjs';
import {collectorConfig,collectorAuthorization} from '../lib/collector-access.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {baseballDataStatus} from '../lib/baseball-data-status.mjs';
const exec=promisify(execFile);
const dataDir=process.env.BIG_VIN_MLB_DATA_DIR||path.join(os.homedir(),'.local/share/big-vin/baseball-stats');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
if(!process.argv.includes('--publish-only')){
 const asOf=new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'});
 const script=fileURLToPath(new URL('./baseball/collect.py',import.meta.url));
 await exec(process.env.BIG_VIN_PYTHON||'python3',[script,'--mode','daily','--as-of',asOf,'--lookback-days','7','--future-days','7','--pitchers','--statcast-days','1','--data-dir',dataDir],{maxBuffer:2*1024*1024,timeout:600000});
}
const manifest=read(path.join(dataDir,'latest-manifest.json'));
if(manifest.validation?.status!=='pass')throw new Error('Baseball source validation did not pass; status was not published.');
const summary=manifest.summary;
const statcastRoot=path.join(dataDir,'statcast');
const statcastPitches=fs.existsSync(statcastRoot)?fs.readdirSync(statcastRoot).reduce((total,date)=>{const p=path.join(statcastRoot,date,'manifest.json');return total+(fs.existsSync(p)?read(p).pitchRows||0:0);},0):0;
const status=baseballDataStatus({schemaVersion:1,collectedAt:manifest.completedAt,completedThrough:summary.dateMax,seasons:Object.keys(summary.seasons).map(Number),games:summary.cumulativeGames,teamGames:summary.cumulativeGames*2,pitcherGames:manifest.pitcherAudit?.pitcherAppearances||0,statcastPitches,probablePitchers:manifest.currentSnapshots?.pregameProbableRows||0,rosterPlayers:manifest.currentSnapshots?.rosterRows||0,playerSeasonStats:manifest.currentSnapshots?.playerSeasonRows||0,sourceResponses:Object.keys(read(path.join(dataDir,'cache/index.json'))).length,sourceDisagreements:summary.sourceDisagreementWarningCount,warnings:summary.sourceDisagreementWarningCount?[`${summary.sourceDisagreementWarningCount} fielding-error discrepancies retained; these fields are excluded from the current experiment.`]:[]});
if(!process.argv.includes('--no-publish')){
 await verifyBaseball({dataDir,siteUrl:process.env.BIG_VIN_SITE_URL});
 const config=collectorConfig();
 const response=await fetch((process.env.BIG_VIN_SITE_URL||config.url)+'/api/baseball-data',{method:'POST',headers:{'Content-Type':'application/json',Authorization:await collectorAuthorization(config)},body:JSON.stringify(status),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error(`Baseball status publication failed: HTTP ${response.status}`);
}
console.log(JSON.stringify(status));
