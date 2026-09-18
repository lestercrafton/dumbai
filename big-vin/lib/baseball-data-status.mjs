const integer=value=>Number.isSafeInteger(value)&&value>=0;
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value));
export function baseballDataStatus(value,now=Date.now()) {
 if(value?.schemaVersion!==1||!Number.isFinite(Date.parse(value.collectedAt))||Date.parse(value.collectedAt)>now+60000||!date(value.completedThrough))throw new Error('A dated collection summary is required.');
 const counts=['games','teamGames','pitcherGames','statcastPitches','probablePitchers','rosterPlayers','playerSeasonStats','sourceResponses','sourceDisagreements'];
 if(counts.some(key=>!integer(value[key])))throw new Error('Collection counts must be nonnegative integers.');
 if(!Array.isArray(value.seasons)||value.seasons.some(year=>!Number.isInteger(year)||year<1900||year>2100))throw new Error('Valid source seasons are required.');
 const warnings=Array.isArray(value.warnings)?value.warnings.filter(w=>typeof w==='string'&&w.length<=1000).slice(0,20):[];
 return {schemaVersion:1,collectedAt:new Date(value.collectedAt).toISOString(),completedThrough:value.completedThrough,seasons:[...new Set(value.seasons)].sort(),...Object.fromEntries(counts.map(key=>[key,value[key]])),warnings};
}
