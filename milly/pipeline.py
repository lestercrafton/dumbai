"""Run Milly: independently forecast, challenge, produce twenty, archive and publish."""
from __future__ import annotations
import os,json,hashlib,datetime as dt,pathlib,csv,traceback,sys
import numpy as np
from forecast import ROOT,CACHE,PUBLIC,dataset,fit_forecasts
from lineups import discover,player_pool,analog_library,simulate,candidates,rank_lineups,valid
from research import slate_hypothesis,forecast_diagnostics

def plain(value):
 if isinstance(value,dict):return {str(k):plain(v) for k,v in value.items()}
 if isinstance(value,(list,tuple)):return [plain(v) for v in value]
 if isinstance(value,np.ndarray):return plain(value.tolist())
 if isinstance(value,(np.integer,np.floating)):value=value.item()
 if isinstance(value,float) and not np.isfinite(value):return None
 return value

def write(path,value):
 path=pathlib.Path(path);path.parent.mkdir(parents=True,exist_ok=True);temp=path.with_suffix(path.suffix+'.tmp');temp.write_text(json.dumps(plain(value),indent=2,allow_nan=False));temp.replace(path)

def score_archive(stats):
 actual=stats.set_index(['game_id','player_id']).dk.to_dict();rows=[]
 for f in sorted((PUBLIC/'releases').glob('*.json')) if (PUBLIC/'releases').exists() else []:
  old=json.loads(f.read_text());gs={p['game_id'] for p in old.get('players',[])};available=set(stats.game_id)
  if not gs or not gs.issubset(available):continue
  for lu in old.get('lineups',[]):
   offense=sum(actual.get((p['game_id'],p['gsis_id']),0) for p in lu['players'] if p['pos']!='DST')
   rows.append({'release':old['release_id'],'rank':lu['rank'],'offensive_actual':round(float(offense),2),'full_official_score':None,'contest_rank':None,'note':'Official DST settlement and real contest standings not yet ingested.'})
 write(PUBLIC/'scorecard.json',{'evaluated_at':dt.datetime.now(dt.timezone.utc).isoformat(),'rows':rows,'roi':None,'note':'No invented returns or contest ranks. Unplayed slates remain pending.'})

def fresh_sources(group_id,now=None):
 now=now or dt.datetime.now(dt.timezone.utc);audit=json.loads((PUBLIC/'source-audit.json').read_text())
 if 'season' not in audit:raise ValueError('Source audit has no season')
 sources={r['name']:r for r in audit['sources']}
 for name in ['schedule','roster_current','dk_lobby','dk_pool_'+str(group_id),'depth_'+str(audit['season'])]:
  rec=sources.get(name,{})
  if not rec.get('ok'):raise ValueError('Current source missing or failed: '+name)
  age=(now-dt.datetime.fromisoformat(rec['retrieved_at'])).total_seconds()
  if age< -300 or age>6*3600:raise ValueError('Current source exceeds six-hour freshness limit: '+name)
 return audit

def verify_release(r):
 assert len(r['lineups'])==20,'Twenty complete lineups required'
 assert not r['human_projection_inputs'],'Independent model cannot ingest analyst forecasts'
 assert len({tuple(sorted(lu['indices'])) for lu in r['lineups']})==20,'Repeated lineups'
 for lu in r['lineups']:
  assert valid(r['players'],lu['indices']),'Illegal roster'
  assert lu['salary']==sum(p['salary'] for p in lu['players']),'Salary inconsistency'
  assert abs(sum(p['witness_points'] for p in lu['players'])-lu['world']['lineup_points'])<.08,'Mixed simulation witnesses'
  assert all(p['status'] not in ['OUT','IR','O','D'] for p in lu['players']),'Unavailable player'
 assert r['diagnostics']['max_simulation_mean_error']<.002,'Simulation distorts forecast means'
 assert len(r['analogs'])>=200,'Inadequate historical scenario library'
 for e in r['model']['evaluations']:assert max(e['train_seasons'])<e['season'],'Temporal validation leakage'
 return True

def run():
 timestamp=dt.datetime.now(dt.timezone.utc).isoformat();contest,obj,games,bygame=discover();target=(games[0]['season'],games[0]['week']);print('TARGET',target,contest['id'],contest['dg'],flush=True)
 fresh_sources(contest['dg']);d,features,schedule,stats,team=dataset(target);d,oof,report,tm=fit_forecasts(d,features);report=forecast_diagnostics(oof,report);players,audit=player_pool(obj,bygame,d,oof);library=analog_library(oof,tm)
 for g in games:
  for side in ['away','home']:
   row=tm[(tm.game_id==g['game_id'])&(tm.team==g[side])]
   if len(row)!=1:raise ValueError('Missing team-score forecast')
   g[side+'_mean']=round(float(row.iloc[0].score_mean),3)
 worlds=int(os.getenv('MILLY_WORLDS','32768'))
 selection,gs1,draw1=simulate(players,games,library,worlds,seed=51081);evaluation,gs2,draw2=simulate(players,games,library,worlds,seed=51082)
 cand,coverage=candidates(players,selection,int(os.getenv('MILLY_CANDIDATES','1200')));lineups,diagnostics=rank_lineups(players,games,cand,selection,evaluation,gs2)
 if len(lineups)!=20:raise ValueError('Did not produce twenty legal distinct lineups')
 diagnostics['flex_search_attempts']=coverage;diagnostics['calibration_games']=len(library);diagnostics['max_simulation_mean_error']=float(np.max(abs(selection.mean(axis=0)-np.array([p['mean'] for p in players]))))
 hyp=slate_hypothesis(schedule,stats);score_archive(stats);source=json.loads((PUBLIC/'source-audit.json').read_text());release_id=f"{target[0]}-W{target[1]:02d}-{timestamp.replace(':','').replace('-','').split('.')[0]}";codehash=hashlib.sha256(b''.join(p.read_bytes() for p in sorted(ROOT.glob('*.py')))).hexdigest()
 release={'version':'0.5.0','release_id':release_id,'generated_at':timestamp,'status':'research','entry_ready':False,'season':target[0],'week':target[1],'slate_start':min(g['start'] for g in games),'draft_group_id':contest['dg'],'contest':{'id':contest['id'],'name':contest['n'],'entry_fee':contest.get('a'),'maximum_entries':contest.get('m'),'entered_at_snapshot':contest.get('nt')},'model':report,'coverage':audit,'diagnostics':diagnostics,'games':games,'players':players,'lineups':lineups,'candidate_indices':cand.tolist(),'analogs':library,'research':{k:v for k,v in hyp.items() if k!='rows'},'source_hash':hashlib.sha256(json.dumps(source,sort_keys=True).encode()).hexdigest(),'code_hash':codehash,'human_projection_inputs':False,'warnings':['Experimental independent forecasts; not proven against actual Millionaire Maker fields.','Some players are questionable and official inactives are not final.','Joint residual simulations are not event-conserving play-by-play worlds.','The peer candidate bank is not a learned ownership model.','DST forecasts and final scores are proxies until official scoring integration.']}
 verify_release(release);write(PUBLIC/'latest.json',release);write(PUBLIC/'releases'/f'{release_id}.json',release);write(PUBLIC/'research.json',hyp);write(PUBLIC/'model-report.json',report)
 write(PUBLIC/'owner-report.json',{k:v for k,v in release.items() if k not in ['analogs','candidate_indices']})
 with open(PUBLIC/'twenty.csv','w',newline='') as file:
  w=csv.writer(file);w.writerow(['Rank','QB','RB1','RB2','WR1','WR2','WR3','TE','FLEX','DST','Salary','Projected mean','Status'])
  for r in lineups:w.writerow([r['rank']]+[p['name']+' ('+p['id']+')' for p in r['players']]+[r['salary'],r['projected_mean'],'RESEARCH / RECHECK BEFORE ENTRY'])
 write(PUBLIC/'status.json',{'status':'completed','version':'0.5.0','generated_at':timestamp,'release_id':release_id,'draft_group_id':contest['dg'],'source_audit':'source-audit.json','code_hash':codehash})
 print(json.dumps({'release':release_id,'players':len(players),'lineups':len(lineups),'diagnostics':diagnostics,'hypothesis':release['research']},indent=2),flush=True);return release
if __name__=='__main__':
 try:run()
 except Exception as error:
  write(PUBLIC/'status.json',{'status':'withheld','generated_at':dt.datetime.now(dt.timezone.utc).isoformat(),'reason':str(error),'previous_release_may_be_stale':True});traceback.print_exc();sys.exit(1)
