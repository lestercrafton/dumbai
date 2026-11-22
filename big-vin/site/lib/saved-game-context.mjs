/** Pregame game context for replaying stars from saved records.
 * Neutral site: a forecast saves `neutralSite` from the ESPN schedule since Nov 22, 2026.
 * Older forecasts never saved the flag, but the model removes home advantage at a
 * neutral site, so the saved projection shows it: projection.homeAdvantage is 0
 * while the model's own home advantage (saved on the record) is not. Nothing is
 * looked up after the fact; a record with neither stays not neutral. */
const finite=x=>typeof x==='number'&&Number.isFinite(x);
export function savedNeutralSite(r){
 if(typeof r?.neutralSite==='boolean')return r.neutralSite;
 const p=r?.projection;
 if(typeof p?.neutral==='boolean')return p.neutral;
 if(finite(p?.homeAdvantage)&&finite(r?.homeAdvantage)&&r.homeAdvantage!==0)return p.homeAdvantage===0;
 return false;
}
/** The over/under pick the board used: the totals table keeps each game's last pick
 * captured before kickoff. Anything captured at or after kickoff is ignored. */
export function pregameTotal(totals,r){
 const t=totals?.games?.[r?.gameId];
 if(!t||!finite(t.edge))return null;
 const at=Date.parse(t.capturedAt??''),start=Date.parse(r?.startTime??'');
 return Number.isFinite(at)&&Number.isFinite(start)&&at<start?t:null;
}
