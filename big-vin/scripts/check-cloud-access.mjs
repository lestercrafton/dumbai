import {collectorConfig,verifyCollectorAccess} from '../lib/collector-access.mjs';
const config=collectorConfig();
// Idempotent initialization verifies protected access without changing any
// existing forecasts, priors, prices or outcomes.
await verifyCollectorAccess(config);
console.log(JSON.stringify({authorized:true,repository:process.env.GITHUB_REPOSITORY,workflow:process.env.GITHUB_WORKFLOW}));
