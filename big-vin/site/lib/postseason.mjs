const SUPPORTED=new Set(['mlb','wnba']);
const key=(sport,team)=>sport==='mlb'?`mlb:${({CHW:'CWS',WSN:'WSH',SDP:'SD',KCR:'KC',TBR:'TB',SFG:'SF',AZ:'ARI',OAK:'ATH'})[team?.abbreviation]||team?.abbreviation}`:String(team?.id||'');
const pair=ids=>[...ids].map(String).sort().join(':');
const roundKey=round=>String(round||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const noteOf=event=>[event?.gameNote,...(event?.competitions?.[0]?.notes||[]).map(note=>note.headline)].filter(Boolean).join(' ');
const parseNote=note=>{const match=String(note).match(/^(.+?)\s*-\s*Game\s+(\d+)\b(.*)$/i);return match?{round:match[1].trim(),gameNumber:Number(match[2]),ifNecessary:/if\s+necessary/i.test(match[3])}:null;};
const officialSource=(url,sport)=>{try{const u=new URL(url);return u.protocol==='https:'&&u.hostname==='site.api.espn.com'&&u.pathname.startsWith(`/apis/site/v2/sports/${sport==='mlb'?'baseball/mlb':'basketball/wnba'}/`);}catch{return false;}};

/** Preserve an explicit postseason slot before a provider removes it. */
export function postseasonMetadata(event,sport,{sourceUrl,observedAt}={}){
 if(!SUPPORTED.has(sport)||event?.season?.type!==3||!Number.isInteger(event.season.year)||!/^\d{1,12}$/.test(String(event.id)))return null;
 const parsed=parseNote(noteOf(event));
 if(!parsed||parsed.gameNumber<1||parsed.gameNumber>7)return null;
 return {gameId:String(event.id),season:event.season.year,...parsed,sourceUrl,observedAt};
}

// These exact archived slots predate preservation of the provider's notes.
// MLB Game 3 If Necessary notes survive in the Sep 25 raw collection. The two
// WNBA slot identities are inferred from the archived pair/date and the
// official completed first-round series; no missing archived note is claimed.
const LEGACY_SLOTS=Object.freeze({
 '401918021':{sport:'wnba',season:2026,homeId:'8',awayId:'9',startTime:'2026-10-01T04:00:00Z',round:'First Round',gameNumber:3,ifNecessary:true,basis:'Exact archived opponent/date slot; official first-round series completion'},
 '401918293':{sport:'wnba',season:2026,homeId:'20',awayId:'16',startTime:'2026-10-02T04:00:00Z',round:'First Round',gameNumber:3,ifNecessary:true,basis:'Exact archived opponent/date slot; official first-round series completion'},
 '401907964':{sport:'mlb',season:2026,homeId:'mlb:NYY',awayId:'mlb:BOS',startTime:'2026-10-01T04:00:00Z',round:'ALWC',gameNumber:3,ifNecessary:true,basis:'Archived Sep 25 ESPN note: ALWC - Game 3 If Necessary',sourceUrl:'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=20261001&limit=1000',observedAt:'2026-09-25T13:27:29.007Z'},
 '401907898':{sport:'mlb',season:2026,homeId:'mlb:HOU',awayId:'mlb:CWS',startTime:'2026-10-01T21:00:00Z',round:'ALWC',gameNumber:3,ifNecessary:true,basis:'Archived Sep 25 ESPN note: ALWC - Game 3 If Necessary',sourceUrl:'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=20261001&limit=1000',observedAt:'2026-09-25T13:27:29.007Z'},
 '401907976':{sport:'mlb',season:2026,homeId:'mlb:SD',awayId:'mlb:CHC',startTime:'2026-10-02T02:00:00Z',round:'NLWC',gameNumber:3,ifNecessary:true,basis:'Archived Sep 25 ESPN note: NLWC - Game 3 If Necessary',sourceUrl:'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=20261001&limit=1000',observedAt:'2026-09-25T13:27:29.007Z'},
});

/** Only explicit best-of-three playoff sweeps can release a third-game slot. */
export function completedBestOfThreeSeries(payload,sport,{sourceUrl,observedAt}={}){
 if(!SUPPORTED.has(sport)||!officialSource(sourceUrl,sport)||!Number.isFinite(Date.parse(observedAt)))return [];
 const events=payload?.events|| (payload?.header?[{...payload.header,date:payload.header.competitions?.[0]?.date}]:[]);
 return events.flatMap(event=>{
  const c=event.competitions?.[0],status={...c?.status?.type,...event.status?.type},date=c?.date||event.date;
  if(event.season?.type!==3||status.completed!==true||status.state!=='post'||status.name!=='STATUS_FINAL'||!Number.isFinite(Date.parse(date))||Date.parse(date)>=Date.parse(observedAt))return [];
  const note=parseNote(noteOf(event));
  if(!note||note.gameNumber!==2||note.ifNecessary)return [];
  const teams=c.competitors||[];
  if(teams.length!==2||teams.some(t=>!t.team?.id||Number(t.team.id)<=0||!Number.isFinite(Number(t.score))||Number(t.score)<0)||Number(teams[0].score)===Number(teams[1].score))return [];
  const series=(Array.isArray(c.series)?c.series:[c.series]).find(s=>s?.type==='playoff'&&s.completed===true&&s.totalCompetitions===3);
  if(!series||series.competitors?.length!==2)return [];
  if(pair(series.competitors.map(t=>t.id))!==pair(teams.map(t=>t.team.id)))return [];
  const wins=series.competitors.map(t=>t.wins).sort();
  if(wins[0]!==0||wins[1]!==2||series.competitors.some(t=>(t.ties??0)!==0))return [];
  const winner=teams.find(t=>Number(t.score)>Number(teams.find(other=>other!==t).score));
  if(series.competitors.find(t=>String(t.id)===String(winner.team.id))?.wins!==2)return [];
  return [{sport,season:event.season.year,round:note.round,gameId:String(event.id),startTime:date,teamIds:teams.map(t=>key(sport,t.team)),summary:series.summary,sourceUrl,observedAt,bestOf:3,wins:[2,0]}];
 });
}

/** Absence alone is never a void: require a known slot and verified series end. */
export function postseasonSlotForForecast(f){
 if(!SUPPORTED.has(f?.sport))return null;
 const start=Date.parse(f.startTime);
 const seed=LEGACY_SLOTS[String(f.gameId)];
 const seeded=seed&&seed.sport===f.sport&&seed.season===f.season&&seed.homeId===f.homeId&&seed.awayId===f.awayId&&Date.parse(seed.startTime)===start;
 const slot=seeded?{...seed,gameId:String(f.gameId)}:f.postseason;
 if(!slot||slot.gameId!==String(f.gameId)||slot.season!==f.season||slot.gameNumber!==3||slot.ifNecessary!==true||!roundKey(slot.round))return null;
 if(!seeded&&(!officialSource(slot.sourceUrl,f.sport)||!Number.isFinite(Date.parse(slot.observedAt))||Date.parse(slot.observedAt)>=start))return null;
 return slot;
}

export function seriesLookupCandidates(pending,archived,limit=8){
 const candidates=new Map();
 for(const f of pending){if(!postseasonSlotForForecast(f))continue;
  const previous=archived.filter(other=>other.sport===f.sport&&other.season===f.season&&other.result?.status==='completed'&&pair([other.homeId,other.awayId])===pair([f.homeId,f.awayId])&&Date.parse(other.startTime)<Date.parse(f.startTime)&&Date.parse(f.startTime)-Date.parse(other.startTime)<=7*86400000).sort((a,b)=>Date.parse(b.startTime)-Date.parse(a.startTime))[0];
  if(previous)candidates.set(previous.gameId,previous);
 }
 return [...candidates.values()].slice(0,limit);
}

export function inferUnneededPlayoffGame(forecast,evidence,{observedAt='',summaryMissing=false,currentGame=null}={}){
 const f=forecast,now=Date.parse(observedAt),start=Date.parse(f?.startTime);
 if(!SUPPORTED.has(f?.sport)||!Number.isFinite(now)||!Number.isFinite(start)||start>=now||!summaryMissing||currentGame)return null;
 const slot=postseasonSlotForForecast(f);
 if(!slot)return null;
 const candidates=evidence.filter(e=>e.sport===f.sport&&e.season===f.season&&roundKey(e.round)===roundKey(slot.round)&&pair(e.teamIds)===pair([f.homeId,f.awayId])&&e.bestOf===3&&pair(e.wins)===pair([2,0])&&officialSource(e.sourceUrl,f.sport)&&Number.isFinite(Date.parse(e.observedAt))&&Date.parse(e.observedAt)<=now&&Date.parse(e.startTime)<start&&start-Date.parse(e.startTime)<=7*86400000);
 if(candidates.length!==1)return null;
 const decided=candidates[0];
 return {id:String(f.gameId),sport:f.sport,startTime:f.startTime,status:'cancelled',completed:false,sourceUrl:decided.sourceUrl,voidEvidence:{reason:'If-necessary playoff game not needed; series already decided',slotBasis:slot.basis||'Archived explicit Game 3 If Necessary note',round:slot.round,seriesGameId:decided.gameId,seriesSummary:decided.summary,seriesGameStartTime:decided.startTime,verifiedAt:decided.observedAt,slotSourceUrl:slot.sourceUrl||f.sourceUrl,slotObservedAt:slot.observedAt||f.capturedAt}};
}
