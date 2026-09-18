import {collectorConfig,collectorAuthorization} from '../lib/collector-access.mjs';
const config=collectorConfig();
// Idempotent initialization verifies protected access without changing any
// existing forecasts, priors, prices or outcomes.
const response=await fetch(config.url+'/api/collector',{method:'POST',headers:{'Content-Type':'application/json',Authorization:await collectorAuthorization(config)},body:JSON.stringify({action:'initialize'}),signal:AbortSignal.timeout(120000)});
if(!response.ok)throw new Error(`Big Vin rejected this workflow identity (${response.status}).`);
console.log(JSON.stringify({authorized:true,repository:process.env.GITHUB_REPOSITORY,workflow:process.env.GITHUB_WORKFLOW}));
