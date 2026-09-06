"""Run a complete Milly cycle; retain pre-outcome releases and score them later."""
from __future__ import annotations
import pathlib,json,datetime as dt,traceback
ROOT=pathlib.Path(__file__).resolve().parent
# These idempotent source migrations also apply when installing the initial bundle.
p=ROOT/'core.py';s=p.read_text();s=s.replace('from site import render','from publication import render')
s=s.replace("'points':W[:take]","'points':np.rint(W[:take]*100).astype(np.int32)")
s=s.replace("'points':H[:take]","'points':np.rint(H[:take]*100).astype(np.int32)")
s=s if "world['point_scale']=100" in s else s.replace("save(STAGE/'latest.json',release);save(STAGE/'worlds.json',world)","world['point_scale']=100\n  save(STAGE/'latest.json',release);save(STAGE/'worlds.json',world)")
p.write_text(s)
p=ROOT/'publication.py';s=p.read_text();s=s.replace("bank=await r.json();}if(bank.release_id", "bank=await r.json();if(bank.point_scale===100){for(const part of ['selection','evaluation'])bank[part].points=bank[part].points.map(row=>row.map(x=>x/100));bank.point_scale=1;}}if(bank.release_id")
p.write_text(s)
import core

def grade_archives():
 import pandas as pd,numpy as np
 cache=ROOT/'cache';pub=ROOT/'public';files=list(cache.glob('stats_*.csv.gz'))
 if not files or not (cache/'schedule.csv.gz').exists():return
 st=pd.concat([pd.read_csv(p,low_memory=False) for p in files],ignore_index=True);st=st[st.season_type=='REG'].copy();st['team']=st.team.replace(core.ALIASES);st['fp']=core.points(st);g=core.schedules(pd.read_csv(cache/'schedule.csv.gz',low_memory=False));now=pd.Timestamp.now(tz='UTC');done=g[g.home_score.notna()&g.away_score.notna()&(g.kick<now-pd.Timedelta(hours=36))];available=set(done.game_id)&set(st.game_id);actual=st.groupby(['game_id','team','player_id']).fp.sum().to_dict();receipts=[]
 for path in sorted((pub/'archive').glob('*.json')):
  d=json.loads(path.read_text());gameids={x['game_id'] for x in d['games']}
  if not gameids<=available:continue
  values={}
  for p in d['players']:
   if p['position']!='DST':values[p['i']]=float(actual.get((p['game_id'],p['team'],p['gsis_id']),0));continue
   a=st[(st.game_id==p['game_id'])&(st.team==p['team'])];ga=done[done.game_id==p['game_id']].iloc[0];pa=ga.away_score if ga.home_team==p['team'] else ga.home_score;tier=10 if pa==0 else 7 if pa<=6 else 4 if pa<=13 else 1 if pa<=20 else 0 if pa<=27 else -1 if pa<=34 else -4
   total=lambda k:float(core.n(a,k).sum())
   values[p['i']]=total('def_sacks')+2*(total('def_interceptions')+total('fumble_recovery_opp'))+6*(total('def_tds')+total('special_teams_tds'))+2*(total('def_safeties')+total('def_punt_blocks')+total('def_fg_blocks')+total('def_pat_blocks'))+tier
  skill=[p for p in d['players'] if p['position']!='DST'];err=np.array([values[p['i']]-p['mu'] for p in skill]);receipt={'release_id':d['release_id'],'prediction_published_at':d['generated_at'],'graded_at':now.isoformat(),'label':'Paper forecasts and unentered lineup scores; DST proxy. Not actual contest ranks or profit.','player_count':len(skill),'player_mae':float(np.mean(abs(err))),'player_rmse':float(np.sqrt(np.mean(err*err))),'lineups':[{'rank':l['rank'],'points':round(sum(values[i] for i in l['ids']),2)} for l in d['lineups']],'actual_contest_ranks':None,'actual_payouts':None,'corrections':'Outcome receipts may change with official stat corrections; forecast archives remain unchanged.'};receipts.append(receipt)
 core.save(pub/'scorecard.json',{'updated_at':now.isoformat(),'releases_scored':len(receipts),'receipts':receipts,'no_results_means':'No archived slate has complete eligible outcomes yet; no simulated profits are substituted.'})

if __name__=='__main__':
 try:core.run()
 finally:
  try:grade_archives()
  except Exception as e:
   core.save(ROOT/'public'/'grading-health.json',{'status':'failed','error':str(e),'at':dt.datetime.now(dt.timezone.utc).isoformat()});traceback.print_exc()
