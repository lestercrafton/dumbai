import tuning from './tuning-2026-09-14.json';
import tuningOct16 from './tuning-2026-10-16.json';
import {MODEL_VERSION,reportingWeek} from './results.mjs';
export const activeModels:Record<string,any>=Object.fromEntries(Object.entries({...tuning,...tuningOct16}).map(([sport,model])=>[sport,{...model,label:(model as {id?:string}).id?.includes('2026-10-16')?'Weights updated · Oct 16':'Weights selected · Sep 14'}]));
export const baselineModel={id:MODEL_VERSION,label:'Ridge v1 · original benchmark',parameters:null};
/** Keep retired activations available for history; activeModels is board-only. */
type HistoricalModelSpec={id:string;activatedAt:string;startWeekKey:string;startDate:string;parameters:Record<string,number|boolean>};
export function historicalModelSpecs(sport:string):HistoricalModelSpec[]{return [tuning,tuningOct16].map(registry=>(registry as Record<string,HistoricalModelSpec>)[sport]).filter(Boolean);}
export function modelSpec(sport:string,version?:string|null):any {
 const active=activeModels[sport];
 return active&&(!version||version===active.id)?active:sport==='wnba'?{...baselineModel,label:'WNBA v1 · experimental'}:baselineModel;
}
export function modelLabel(sport:string,version:string){if(version===MODEL_VERSION)return modelSpec(sport,MODEL_VERSION).label;if(activeModels[sport]?.id===version)return activeModels[sport].label;const sep14=(tuning as Record<string,{id?:string}>)[sport];if(sep14?.id===version)return 'Weights selected · Sep 14';if((tuningOct16 as Record<string,{id?:string}>)[sport]?.id===version)return 'Weights updated · Oct 16';return version;}
/** Newest-first formula versions that can own a displayed record. */
export function recordVersionChain(sport:string):string[]{return [...new Set([activeModels[sport]?.id,(tuning as Record<string,{id?:string}>)[sport]?.id,MODEL_VERSION].filter(Boolean) as string[])];}
export function eligibleForModel(game:any,spec:any){return spec.id===MODEL_VERSION||String(reportingWeek(game))>=spec.startWeekKey&&Date.parse(game.startTime)>Date.parse(spec.activatedAt);}
