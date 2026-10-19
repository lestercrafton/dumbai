/** Kickoff-hour weather for outdoor venues from Open-Meteo (free, keyless public API).
 * Venue city/state and the indoor flag come from the ESPN scoreboard event. Every input records its URL and time.
 */
const UA={'User-Agent':'big-vin-research/1.0 (+https://github.com/lestercrafton/dumbai)',Accept:'application/json'};
const STATES={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'};
export const geocodeUrl=city=>`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=10`;
export function forecastUrl({latitude,longitude},kickoff){
 const hour=new Date(Math.floor(Date.parse(kickoff)/3600000)*3600000).toISOString().slice(0,13)+':00';
 return `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,precipitation,wind_speed_10m,wind_gusts_10m&wind_speed_unit=mph&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=UTC&start_hour=${hour}&end_hour=${hour}`;
}
export function venueOf(rawEvent){
 const v=rawEvent?.competitions?.[0]?.venue;if(!v)return null;
 return {id:v.id??null,name:v.fullName??null,city:v.address?.city??null,state:v.address?.state??null,country:v.address?.country??(v.address?.state?'USA':null),indoor:v.indoor===true};
}
export function pickPlace(results,venue){
 const list=results||[];
 const stateName=STATES[String(venue.state||'').toUpperCase()]||venue.state;
 return list.find(r=>stateName&&r.admin1===stateName)||(!venue.state?list.find(r=>!venue.country||r.country===venue.country||r.country_code===venue.country):null)||null;
}
/** Severe-condition flags with thresholds fixed before any results. */
export const THRESHOLDS={windMph:15,gustMph:25,precipInPerHour:0.1,coldF:25};
export function conditions(hourly){
 const v=k=>hourly?.[k]?.[0]??null;
 const c={temperatureF:v('temperature_2m'),precipitationIn:v('precipitation'),windMph:v('wind_speed_10m'),gustMph:v('wind_gusts_10m')};
 const flags=[];
 if(c.windMph!==null&&c.windMph>=THRESHOLDS.windMph)flags.push('wind');
 if(c.gustMph!==null&&c.gustMph>=THRESHOLDS.gustMph)flags.push('gusts');
 if(c.precipitationIn!==null&&c.precipitationIn>=THRESHOLDS.precipInPerHour)flags.push('precipitation');
 if(c.temperatureF!==null&&c.temperatureF<=THRESHOLDS.coldF)flags.push('cold');
 return {...c,flags,severe:flags.length>0};
}
export function weatherContext({fetchImpl=globalThis.fetch,log=()=>{}}={}){
 const cache=new Map(),errors=[];
 const get=async url=>{if(!cache.has(url))cache.set(url,(async()=>{const r=await fetchImpl(url,{headers:UA,signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();})());return cache.get(url);};
 async function forGame(rawEvent,kickoff){
  const venue=venueOf(rawEvent);
  if(!venue)return {status:'unavailable',note:'No venue on the scoreboard event.'};
  if(venue.indoor)return {status:'indoor',venue};
  if(Date.parse(kickoff)-Date.now()>15*86400000)return {status:'too-far-out',venue};
  try{
   const gUrl=geocodeUrl(venue.city);const place=pickPlace((await get(gUrl)).results,venue);
   if(!place)return {status:'unavailable',venue,note:'Venue city not geocoded.',geocodeUrl:gUrl};
   const fUrl=forecastUrl(place,kickoff);const f=await get(fUrl);
   return {status:'ok',venue,place:{name:place.name,admin1:place.admin1,latitude:place.latitude,longitude:place.longitude},forecastFor:f.hourly?.time?.[0]??null,...conditions(f.hourly),
    source:'open-meteo-forecast',url:fUrl,observedAt:new Date().toISOString()};
  }catch(e){errors.push({venue:venue.name,error:e.message});log(`weather ${venue.name}: ${e.message}`);return {status:'unavailable',venue,note:e.message};}
 }
 return {forGame,errors};
}
