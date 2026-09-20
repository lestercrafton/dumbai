import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const DAILY_SCHEDULE='17 7,8 * * *';
export const WEEKLY_SCHEDULE='17 9 * * 2';
export const RESULTS_SCHEDULE='37 * * * *';

/** Score collection and the once-daily frozen journal are separate tasks. */
export function runnerPlan({eventName,task='',schedule=''}={}){
 let selected;
 if(eventName==='push')selected='refresh';
 else if(eventName==='workflow_dispatch')selected=task||'daily';
 else if(eventName==='schedule'){
  selected=schedule===DAILY_SCHEDULE?'daily':schedule===WEEKLY_SCHEDULE?'weekly':schedule===RESULTS_SCHEDULE?'results':null;
 }else throw new Error('Unsupported Big Vin workflow event.');
 if(!['daily','weekly','refresh','results'].includes(selected))throw new Error('Unsupported Big Vin workflow task or schedule.');
 const results=selected==='results',weekly=selected==='weekly';
 return {task:selected,collection:weekly?'none':results?'recent':'full',journal:!results&&!weekly,weekly,baseball:!results&&!weekly,refresh_baseball:selected==='refresh'};
}

const easternDay=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const offsetDay=(date,days)=>new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);

/** Use calendar dates across DST; the full daily training window is unchanged. */
export function collectionWindow(sport,historicalOnly,{recent=false,now=Date.now()}={}){
 const today=easternDay(now);
 const back=recent?3:sport==='cbb'?7:21;
 return historicalOnly?{start:offsetDay(today,-back),end:offsetDay(today,-1)}:{start:today,end:offsetDay(today,recent||sport==='cbb'?0:6)};
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const plan=runnerPlan({eventName:process.env.GITHUB_EVENT_NAME,task:process.env.BIG_VIN_TASK,schedule:process.env.BIG_VIN_SCHEDULE});
 if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,Object.entries(plan).map(([key,value])=>`${key}=${value}\n`).join(''));
 console.log(JSON.stringify(plan));
}
