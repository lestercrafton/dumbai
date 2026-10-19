'use client';
import {usePlaybookVersions,playbookVersionFor,versionLabel} from '@/lib/playbook-client';
/** Shows which playbook version made a pick. Anything saved before October 19, 2026 is v1. */
export function VersionBadge({record,sport}:{record:Record<string,any>,sport?:string}){
 const {manifest,promotions}=usePlaybookVersions();
 const id=playbookVersionFor({...record,sport:record.sport??sport},{promotions});
 return <span className="playbook-version-badge" title={`${versionLabel(id,manifest)} made this pick`} data-playbook-version={id}>{id}</span>;
}
