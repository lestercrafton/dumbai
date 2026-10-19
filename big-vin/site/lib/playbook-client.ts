'use client';
import {useEffect,useState} from 'react';
import {playbookVersionFor,PLAYBOOK_V1} from './playbook.mjs';
type Versions={playbook:typeof PLAYBOOK_V1,manifest:any,promotions:any[]};
let pending:Promise<Versions>|null=null;
const fallback:Versions={playbook:PLAYBOOK_V1,manifest:null,promotions:[]};
/** One shared read of the versions manifest and promotions per page load. */
export function loadPlaybookVersions(){
 pending??=fetch('/api/playbook?view=versions').then(async r=>{if(!r.ok)throw new Error('unavailable');return await r.json() as Versions;}).catch(()=>{pending=null;return fallback;});
 return pending;
}
export function usePlaybookVersions(){
 const [value,setValue]=useState<Versions>(fallback);
 useEffect(()=>{let live=true;loadPlaybookVersions().then(v=>{if(live)setValue(v);});return()=>{live=false;};},[]);
 return value;
}
export function versionLabel(id:string,manifest:any){return manifest?.versions?.find((v:any)=>v.id===id)?.label??(id===PLAYBOOK_V1.id?PLAYBOOK_V1.label:id);}
export {playbookVersionFor};
