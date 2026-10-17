/** ESPN's scoreboard date is a US Eastern sports day; start times stay UTC. */
export function sportsDay(iso:string|number=new Date().toISOString()):string{
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(iso));
 const get=(key:string)=>parts.find(p=>p.type===key)?.value;
 return `${get('year')}-${get('month')}-${get('day')}`;
}
