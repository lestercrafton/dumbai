"""Independent NFL forecasts. No salaries, analyst projections, ownership or beliefs in X.
Historical roster membership is retrospective, not an authenticated pre-lock archive.
"""
from __future__ import annotations
import os
for k in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS'):os.environ.setdefault(k,'2')
import json,re,pathlib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error,mean_squared_error
ROOT=pathlib.Path(__file__).resolve().parent;CACHE=ROOT/'cache';PUBLIC=ROOT/'public';PUBLIC.mkdir(exist_ok=True)
POS=['QB','RB','WR','TE','DST']
STAT=['dk','targets','carries','attempts','receptions','receiving_yards','rushing_yards','passing_yards','receiving_tds','rushing_tds','passing_tds']
def read(name):return pd.read_csv(CACHE/(name+'.csv.gz'),low_memory=False)
def nums(d,k):return pd.to_numeric(d[k],errors='coerce').fillna(0) if k in d else pd.Series(0.,index=d.index)
def normalize(s):
 s=re.sub(r'\b(jr|sr|ii|iii|iv)\b','',str(s).lower().replace('.',''));return re.sub('[^a-z0-9]','',s)
def score(d):
 return (.04*nums(d,'passing_yards')+4*nums(d,'passing_tds')-nums(d,'passing_interceptions')+.1*(nums(d,'rushing_yards')+nums(d,'receiving_yards'))+6*(nums(d,'rushing_tds')+nums(d,'receiving_tds')+nums(d,'special_teams_tds')+nums(d,'fumble_recovery_tds'))+nums(d,'receptions')-nums(d,'sack_fumbles_lost')-nums(d,'rushing_fumbles_lost')-nums(d,'receiving_fumbles_lost')+2*(nums(d,'passing_2pt_conversions')+nums(d,'rushing_2pt_conversions')+nums(d,'receiving_2pt_conversions'))+3*(nums(d,'passing_yards')>=300)+3*(nums(d,'rushing_yards')>=100)+3*(nums(d,'receiving_yards')>=100))
def schedule_long(games):
 out=[]
 for side,other in [('home','away'),('away','home')]:
  t=games[['game_id','season','week','gameday','gametime','roof','weekday','total_line']].copy()
  t['team']=games[side+'_team'];t['opp']=games[other+'_team'];t['home']=float(side=='home');t['team_score']=games[side+'_score'];t['opp_score']=games[other+'_score'];t['rest']=games[side+'_rest'];t['opp_rest']=games[other+'_rest'];out.append(t)
 return pd.concat(out,ignore_index=True).sort_values(['gameday','game_id','team'])
def dataset(target=None):
 games=read('schedule');games=games[games.game_type.eq('REG')].copy();tg=schedule_long(games);allstats=[]
 for f in sorted(CACHE.glob('stats_*.csv.gz')):
  s=pd.read_csv(f,low_memory=False);s=s[s.season_type.eq('REG')].copy();s['dk']=score(s);allstats.append(s)
 stats=pd.concat(allstats,ignore_index=True).drop_duplicates(['game_id','player_id']);rosters=[]
 for f in sorted(CACHE.glob('rosters_*.csv.gz')):
  r=pd.read_csv(f,low_memory=False);r=r[r.game_type.eq('REG')&r.position.isin(POS[:-1])&r.gsis_id.notna()].copy();rosters.append(r)
 r=pd.concat(rosters,ignore_index=True).drop_duplicates(['season','week','team','gsis_id'])
 if target is not None:
  season,week=target;current=read('roster_current');current=current[current.position.isin(POS[:-1])&current.gsis_id.notna()].copy();current['season']=season;current['week']=week
  r=r[(r.season<season)|((r.season==season)&(r.week<week))];r=pd.concat([r,current],ignore_index=True).drop_duplicates(['season','week','team','gsis_id'])
 r=r.rename(columns={'gsis_id':'player_id','full_name':'name'});use=['season','week','team','player_id','name','position','birth_date','height','weight','years_exp','draft_number','status']
 d=r[use].merge(tg,on=['season','week','team'],how='inner',validate='many_to_one')
 missing=stats[stats.position.isin(POS[:-1])][['season','week','team','game_id','player_id','player_display_name','position']].merge(d[['game_id','player_id']],on=['game_id','player_id'],how='left',indicator=True)
 missing=missing[missing._merge.eq('left_only')].drop(columns=['_merge','game_id']).rename(columns={'player_display_name':'name'}).merge(tg,on=['season','week','team'],how='inner')
 for k in ['birth_date','height','weight','years_exp','draft_number']:missing[k]=np.nan
 missing['status']='UNKNOWN';d=pd.concat([d,missing],ignore_index=True)
 d=d.merge(stats[['game_id','player_id']+STAT],on=['game_id','player_id'],how='left',validate='many_to_one');completed=d.team_score.notna()&d.game_id.isin(stats.game_id)
 for k in STAT:d.loc[completed,k]=d.loc[completed,k].fillna(0)
 d=d[completed|d.team_score.isna()].copy()
 # DST target is explicitly a proxy. Total opponent points lack DK defensive-touchdown exclusions.
 defense=stats.groupby(['game_id','team'],as_index=False).agg(sacks=('def_sacks','sum'),ints=('def_interceptions','sum'),frec=('fumble_recovery_opp','sum'),tds=('def_tds','sum'),returns=('special_teams_tds','sum'),safeties=('def_safeties','sum'),blocks=('def_punt_blocks','sum'))
 z=tg.merge(defense,on=['game_id','team'],how='left');pa=z.opp_score;bonus=np.select([pa.eq(0),pa.le(6),pa.le(13),pa.le(20),pa.le(27),pa.le(34)],[10,7,4,1,0,-1],default=-4)
 z['dk']=z.sacks+2*(z.ints+z.frec+z.safeties+z.blocks)+6*(z.tds+z.returns)+bonus;z['player_id']='DST_'+z.team;z['name']=z.team+' defense';z['position']='DST';z['status']='ACT'
 for k in STAT[1:]:z[k]=0.
 d=pd.concat([d,z[d.columns.intersection(z.columns)]],ignore_index=True);d=d.sort_values(['player_id','gameday','game_id']).drop_duplicates(['game_id','player_id']).reset_index(drop=True)
 gd=pd.to_datetime(d.gameday);birth=pd.to_datetime(d.birth_date,errors='coerce');d['age']=(gd-birth).dt.days/365.25;d['dome']=d.roof.isin(['dome','closed']).astype(float)
 d['draft_log']=np.log1p(pd.to_numeric(d.draft_number,errors='coerce').fillna(300));d['years_exp']=pd.to_numeric(d.years_exp,errors='coerce')
 for k in ['height','weight']:d[k]=pd.to_numeric(d[k],errors='coerce')
 features=['week','home','rest','opp_rest','dome','age','years_exp','height','weight','draft_log']
 for pos in POS:d['is_'+pos]=d.position.eq(pos).astype(float);features.append('is_'+pos)
 groups=d.groupby('player_id',sort=False)
 for k in STAT:
  for span in [4,12]:
   col=f'{k}_ewm{span}';d[col]=groups[k].transform(lambda s:s.shift().ewm(span=span,adjust=False,ignore_na=True).mean());features.append(col)
 d['dk_std12']=groups.dk.transform(lambda s:s.shift().rolling(12,min_periods=2).std());features.append('dk_std12');d['prior_rows']=groups.cumcount().clip(upper=100);features.append('prior_rows')
 d['gap_days']=(gd-groups.gameday.shift().pipe(pd.to_datetime)).dt.days;features.append('gap_days');d['new_team']=(d.team!=groups.team.shift()).astype(float);features.append('new_team')
 d['activity']=np.where(d.dk.notna(),(d[['attempts','targets','carries']].fillna(0).sum(axis=1)>0).astype(float),np.nan);d['active_rate']=d.groupby('player_id').activity.transform(lambda s:s.shift().ewm(span=8,adjust=False,ignore_na=True).mean());features.append('active_rate')
 d['prior_opp']=d.targets_ewm4.fillna(0)+d.carries_ewm4.fillna(0)+d.attempts_ewm4.fillna(0);d['role_rank']=d.groupby(['game_id','team','position']).prior_opp.rank(method='min',ascending=False);features.append('role_rank')
 total=d.groupby(['game_id','team','position']).prior_opp.transform('sum');d['role_share']=d.prior_opp/(1+total);features.append('role_share')
 fp=stats[stats.position.isin(POS[:-1])].groupby(['game_id','team']).dk.sum().rename('fp').reset_index();team=tg.merge(fp,on=['game_id','team'],how='left').sort_values(['team','gameday'])
 for k in ['team_score','opp_score','fp']:team['lag_'+k]=team.groupby('team')[k].transform(lambda s:s.shift().ewm(span=8,adjust=False,ignore_na=True).mean())
 d=d.merge(team[['game_id','team','lag_team_score','lag_opp_score','lag_fp']],on=['game_id','team'],how='left');opp=team[['game_id','team','lag_team_score','lag_opp_score','lag_fp']].rename(columns={'team':'opp','lag_team_score':'opp_lag_score','lag_opp_score':'opp_lag_allowed','lag_fp':'opp_lag_fp'})
 d=d.merge(opp,on=['game_id','opp'],how='left');features+=['lag_team_score','lag_opp_score','lag_fp','opp_lag_score','opp_lag_allowed','opp_lag_fp'];d=d.sort_values(['gameday','game_id','player_id']).reset_index(drop=True);d['baseline']=d.dk_ewm4.fillna(0)
 return d,features,games,stats,team

def model(loss='squared_error',quantile=None):return HistGradientBoostingRegressor(loss=loss,quantile=quantile,max_iter=160,max_leaf_nodes=15,min_samples_leaf=80,l2_regularization=5,learning_rate=.055,early_stopping=False,random_state=4811)
def metrics(y,p,b):return {'n':len(y),'model_mae':float(mean_absolute_error(y,p)),'baseline_mae':float(mean_absolute_error(y,b)),'model_rmse':float(np.sqrt(mean_squared_error(y,p))),'baseline_rmse':float(np.sqrt(mean_squared_error(y,b)))}
def fit_forecasts(d,features):
 finite=d.dk.notna();last=int(d.loc[finite,'season'].max());evaluations=[];oof=[]
 for yr in [last-1,last]:
  train=finite&d.season.lt(yr)&d.season.ge(yr-5);test=finite&d.season.eq(yr)
  if train.sum()<5000 or test.sum()<1000:continue
  print('FIT',yr,int(train.sum()),int(test.sum()),flush=True);m=model();m.fit(d.loc[train,features],d.loc[train,'dk']);p=m.predict(d.loc[test,features]);y=d.loc[test,'dk'].to_numpy();b=d.loc[test,'baseline'].to_numpy();q=d.loc[test].copy();q['prediction']=p;q['residual']=y-p;oof.append(q)
  e={'season':yr,'train_seasons':sorted(d.loc[train,'season'].unique().astype(int).tolist()),**metrics(y,p,b),'positions':{}}
  for pos in POS:k=q.position.eq(pos).to_numpy();e['positions'][pos]=metrics(y[k],p[k],b[k])
  starter=(q.prior_opp>=5).to_numpy();e['prior_opportunity_5plus']=metrics(y[starter],p[starter],b[starter]);evaluations.append(e)
 oof=pd.concat(oof,ignore_index=True);chosen={pos:('gradient_boosting' if evaluations[0]['positions'][pos]['model_rmse']<evaluations[0]['positions'][pos]['baseline_rmse'] else 'lagged_baseline') for pos in POS}
 train=finite&d.season.ge(last-5);m=model();m.fit(d.loc[train,features],d.loc[train,'dk']);d['mean']=m.predict(d[features])
 for pos in POS:
  if chosen[pos]=='lagged_baseline':
   d.loc[d.position.eq(pos),'mean']=d.loc[d.position.eq(pos),'baseline'];k=oof.position.eq(pos);oof.loc[k,'prediction']=oof.loc[k,'baseline'];oof.loc[k,'residual']=oof.loc[k,'dk']-oof.loc[k,'prediction']
 report={'version':'0.5.0','target':'offensive DK score; DST score proxy','training_rows':int(train.sum()),'features':features,'selection':str(evaluations[0]['season'])+' per-position RMSE selects gradient boosting vs lagged baseline; later seasons are diagnostics','chosen':chosen,'evaluations':evaluations,'independent_of':['analyst projections','salary','ownership','user beliefs','same-game box score features','bookmaker lines'],'caveats':['Historical roster membership is not a timestamp-authenticated pre-lock eligibility archive.','Current depth and availability are hard eligibility checks, not fitted player projections.','All rostered zero-output games are retained; forecasting returning starters and rookies remains uncertain.','DST target is a proxy using total opponent points, not exact official contest settlement.']}
 import pickle
 with open(CACHE/'fitted_model.pkl','wb') as f:pickle.dump({'model':m,'features':features,'chosen':chosen,'trained_through':str(d.loc[train,'gameday'].max()),'version':'0.5.0'},f)
 return d,oof,report,team_score_model(d,train)
def team_score_model(d,train):
 tf=['home','rest','opp_rest','dome','lag_team_score','lag_opp_score','opp_lag_score','opp_lag_allowed'];t=d.drop_duplicates(['game_id','team']).copy();tr=t.team_score.notna();last=int(t.loc[tr,'season'].max());tr=tr&t.season.ge(last-6)
 def estimator():return HistGradientBoostingRegressor(max_iter=100,max_leaf_nodes=7,min_samples_leaf=70,l2_regularization=10,early_stopping=False,random_state=4811)
 m=estimator();m.fit(t.loc[tr,tf],t.loc[tr,'team_score']);t['score_mean']=m.predict(t[tf]);t['score_oof']=np.nan
 for yr in [last-1,last]:
  fitmask=tr&t.season.lt(yr);test=t.season.eq(yr)&t.team_score.notna();mm=estimator();mm.fit(t.loc[fitmask,tf],t.loc[fitmask,'team_score']);t.loc[test,'score_oof']=mm.predict(t.loc[test,tf])
 return t[['game_id','team','score_mean','score_oof','team_score','home','season','gameday','lag_team_score','opp_lag_allowed']]
