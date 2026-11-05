/** Straight-up winner pick for a CBB game with no book line anywhere. Graded on the final
 * score only, never staked, no price assumed. */
const finite=x=>typeof x==='number'&&Number.isFinite(x);
export function noLineWinnerPick(g,projection,f){
 const m=projection?.predictedHomeMargin;
 let side=null,reason;
 if(finite(m)&&m!==0){side=m>0?'home':'away';reason='No book line posted · straight-up winner pick from the model';}
 else if(g?.homeConference&&!g?.awayConference){side='home';reason='No book line · non-D1 opponent has no rating · D1 team pick';}
 else if(g?.awayConference&&!g?.homeConference){side='away';reason='No book line · non-D1 opponent has no rating · D1 team pick';}
 if(!side)return null;
 const hs=g.homeScore??f?.result?.homeScore,as=g.awayScore??f?.result?.awayScore;
 const done=(g.completed||g.status==='completed')&&finite(hs)&&finite(as);
 const outcome=!done?'pending':hs===as?'push':(hs>as)===(side==='home')?'win':'loss';
 const lh=g.liveHomeScore,la=g.liveAwayScore;
 const leading=!done&&finite(lh)&&finite(la)&&lh!==la?((lh>la)===(side==='home')):null;
 return {side,basis:finite(m)&&m!==0?'model-margin':'d1-vs-non-d1',reason,outcome,leading,staked:false};
}
