'use client';
import {usePlaybookVersions,playbookVersionFor,versionLabel} from '@/lib/playbook-client';
/** Shows which model made a pick, e.g. "NBA v2". Cards without a live model label
 * fall back to the playbook version (anything saved before October 19, 2026 is v1). */
const SPORTS:Record<string,string>={nfl:'NFL',cfb:'CFB',nba:'NBA',cbb:'CBB',mlb:'MLB',nhl:'NHL',wnba:'WNBA'};
export function shortModel(sport:string|undefined,label:string|undefined|null){
 if(!label)return null;
 const v=label.match(/^([A-Z]+ v\d+)/);if(v)return v[1];
 const s=SPORTS[sport??'']??(sport??'').toUpperCase();
 const d=label.match(/·\s*(\w{3} \d{1,2})/);if(d)return `${s} · ${d[1]}`;
 const r=label.match(/v(\d+)/i);if(r)return `${s} v${r[1]}`;
 return s||null;
}
export function VersionBadge({record,sport}:{record:Record<string,any>,sport?:string}){
 const {manifest,promotions}=usePlaybookVersions();
 const sp=record.sport??sport;
 const id=playbookVersionFor({...record,sport:sp},{promotions});
 const model=shortModel(sp,record.modelLabel);
 const title=record.modelLabel?`Model: ${record.modelLabel} · Playbook ${versionLabel(id,manifest)}`:`${versionLabel(id,manifest)} made this pick`;
 return <span className="playbook-version-badge" title={title} data-playbook-version={id}>{model??id}</span>;
}
