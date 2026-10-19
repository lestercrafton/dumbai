// One formatter for every call: building an Intl.DateTimeFormat per call was
// most of the CPU a slate request used. Results are memoized per input value.
const EASTERN_DAY=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const days=new Map<string|number,string>();
/** ESPN's scoreboard date is a US Eastern sports day; start times stay UTC. */
export function sportsDay(iso:string|number=new Date().toISOString()):string{
 const known=days.get(iso);if(known!==undefined)return known;
 const parts=EASTERN_DAY.formatToParts(new Date(iso));
 const get=(key:string)=>parts.find(p=>p.type===key)?.value;
 const day=`${get('year')}-${get('month')}-${get('day')}`;
 if(days.size>=8192)days.clear();days.set(iso,day);
 return day;
}
