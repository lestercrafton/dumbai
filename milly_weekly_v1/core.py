"""Milly weekly research: independent player forecasts and auditable scenario lineups.
No expert fantasy projections, ownership, salaries or user beliefs are forecast features.
Experimental: not a real-field profitability backtest or exact drive simulator.
"""
from __future__ import annotations
import os
for k in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS'):os.environ.setdefault(k,'2')
import csv,datetime as dt,hashlib,html,io,json,pathlib,re,time,traceback,urllib.request,unicodedata
from collections import Counter
import numpy as np
import pandas as pd
from scipy.optimize import milp,Bounds,LinearConstraint
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error,mean_squared_error
ROOT=pathlib.Path(__file__).resolve().parent;CACHE=ROOT/'cache';PUB=ROOT/'public';STAGE=ROOT/'staging'
for p in (CACHE,PUB,STAGE):p.mkdir(exist_ok=True)
NOW=pd.Timestamp.now(tz='UTC');YEAR=NOW.year if NOW.month>=3 else NOW.year-1
POS=['QB','RB','WR','TE'];SLOTS=['QB','RB','RB','WR','WR','WR','TE','FLEX','DST']
ALIASES={'LA':'LAR','OAK':'LV','SD':'LAC','STL':'LAR','JAC':'JAX','WSH':'WAS'}
COLS=['points','attempts','passing_yards','passing_tds','passing_interceptions','carries','rushing_yards','rushing_tds','targets','receptions','receiving_yards','receiving_tds']
def norm(x):
 x=unicodedata.normalize('NFKD',str(x)).encode('ascii','ignore').decode().lower();x=re.sub(r'\b(jr|sr|ii|iii|iv)\b','',x);return re.sub('[^a-z0-9]','',x)
def clean(x):
 if isinstance(x,dict):return {str(k):clean(v) for k,v in x.items()}
 if isinstance(x,(tuple,list,np.ndarray)):return [clean(v) for v in x]
 if isinstance(x,(np.integer,)):return int(x)
 if isinstance(x,(float,np.floating)):return float(x) if np.isfinite(x) else None
 if isinstance(x,(pd.Timestamp,dt.datetime)):return x.isoformat()
 if isinstance(x,np.bool_):return bool(x)
 return x
def save(path,obj):path=pathlib.Path(path);path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(clean(obj),ensure_ascii=False,separators=(',',':'),allow_nan=False))
def get(name,url,kind='csv',required=True):
 receipt={'name':name,'url':url,'retrieved_at':pd.Timestamp.now(tz='UTC').isoformat()}
 try:
  req=urllib.request.Request(url,headers={'User-Agent':'Milly-research/1.0'})
  with urllib.request.urlopen(req,timeout=55) as r:raw=r.read()
  receipt.update(ok=True,bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())
  if kind=='json':value=json.loads(raw);(CACHE/(name+'.json')).write_bytes(raw)
  else:value=pd.read_csv(io.BytesIO(raw),low_memory=False);value.to_csv(CACHE/(name+'.csv.gz'),index=False,compression='gzip');receipt['rows']=len(value)
 except Exception as e:
  receipt.update(ok=False,error=str(e));value=None
  if required:raise RuntimeError('Required source failed '+name+': '+str(e))
 finally:
  with (CACHE/'source-receipts.jsonl').open('a') as f:f.write(json.dumps(receipt)+'\n')
 return value

def n(d,c):return pd.to_numeric(d[c],errors='coerce').fillna(0) if c in d else pd.Series(0.,index=d.index)
def points(d):
 py,ry,cy=n(d,'passing_yards'),n(d,'rushing_yards'),n(d,'receiving_yards')
 return .04*py+4*n(d,'passing_tds')-n(d,'passing_interceptions')+.1*(ry+cy)+6*(n(d,'rushing_tds')+n(d,'receiving_tds'))+n(d,'receptions')+3*(py>=300)+3*(ry>=100)+3*(cy>=100)-n(d,'sack_fumbles_lost')-n(d,'rushing_fumbles_lost')-n(d,'receiving_fumbles_lost')+2*(n(d,'passing_2pt_conversions')+n(d,'rushing_2pt_conversions')+n(d,'receiving_2pt_conversions'))+6*(n(d,'special_teams_tds')+n(d,'fumble_recovery_tds'))
def model():return HistGradientBoostingRegressor(max_iter=110,max_leaf_nodes=15,min_samples_leaf=50,l2_regularization=12,learning_rate=.065,early_stopping=False,random_state=81017)
def metrics(y,p,b):return {'n':len(y),'mae':mean_absolute_error(y,p),'baseline_mae':mean_absolute_error(y,b),'rmse':np.sqrt(mean_squared_error(y,p)),'baseline_rmse':np.sqrt(mean_squared_error(y,b))}
def schedules(s):
 s=s[s.game_type=='REG'].copy()
 for c in ('home_team','away_team'):s[c]=s[c].replace(ALIASES)
 s['kick']=pd.to_datetime(s.gameday+' '+s.gametime.fillna('13:00'),errors='coerce').dt.tz_localize('America/New_York',ambiguous='NaT',nonexistent='shift_forward').dt.tz_convert('UTC');return s

def slate(lobby):
 options=[]
 for c in lobby.get('Contests',[]):
  name=c.get('n','').lower()
  if 'millionaire' not in name or c.get('gameType')!='Classic' or any(w in name for w in ('satellite','supersat','qualifier','showdown','madden')):continue
  m=re.search(r'\d+',str(c.get('sd','')))
  if m:
   at=pd.to_datetime(int(m[0]),unit='ms',utc=True)
   if not NOW<at<NOW+pd.Timedelta(days=9) or at.tz_convert('America/New_York').dayofweek!=6:continue
  options.append(c)
 for c in sorted(options,key=lambda x:(float(x.get('a',999)), -int(x.get('m',0)))):
  raw=get('draftables_'+str(c['dg']),f'https://api.draftkings.com/draftgroups/v1/draftgroups/{c["dg"]}/draftables?format=json','json',False)
  if not raw:continue
  ps={}
  for q in sorted(raw.get('draftables',[]),key=lambda q:int(q.get('draftableId',0))):
   if q.get('position') not in POS+['DST'] or not q.get('salary') or q.get('rosterSlotId')==70:continue
   co=q.get('competition') or {};at=pd.to_datetime(co.get('startTime'),utc=True,errors='coerce');game=co.get('name','').replace(' ','');game='@'.join(ALIASES.get(x,x) for x in game.split('@'));team=ALIASES.get(q.get('teamAbbreviation'),q.get('teamAbbreviation'))
   if pd.isna(at) or '@' not in game or team not in game.split('@'):continue
   ps.setdefault(str(q['playerId']),{'id':str(q['draftableId']),'athlete_id':str(q['playerId']),'name':q['displayName'],'position':q['position'],'salary':int(q['salary']),'team':team,'opp':next(x for x in game.split('@') if x!=team),'game':game,'start':at.isoformat(),'status':str(q.get('status','')),'disabled':bool(q.get('isDisabled',False))})
  p=pd.DataFrame(ps.values())
  if p.empty:continue
  et=pd.to_datetime(p.start,utc=True).dt.tz_convert('America/New_York')
  if p.game.nunique()<5 or not (et.dt.weekday==6).all() or not et.dt.hour.between(13,16).all() or pd.to_datetime(p.start,utc=True).min()<=NOW:continue
  return p,{'id':c['id'],'name':c['n'],'draft_group':c['dg'],'entry_fee':c['a'],'capacity':c['m'],'kickoff':p.start.min(),'pool_records':len(p),'games':p.game.nunique()}
 raise RuntimeError('No verified future Sunday NFL Classic Millionaire slate. No stale-slate fallback.')

def collect():
 (CACHE/'source-receipts.jsonl').write_text('')
 schedule=schedules(get('schedule','https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'))
 stats=[];rosters=[]
 for y in range(YEAR-7,YEAR+1):
  st=get('stats_'+str(y),f'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{y}.csv',required=y<YEAR)
  ro=get('rosters_'+str(y),f'https://github.com/nflverse/nflverse-data/releases/download/rosters_weekly/roster_weekly_{y}.csv',required=y<YEAR)
  if st is not None and len(st):stats.append(st)
  if ro is not None and len(ro):rosters.append(ro)
 current=get('current_roster',f'https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_{YEAR}.csv')
 depth=get('current_depth',f'https://github.com/nflverse/nflverse-data/releases/download/depth_charts/depth_charts_{YEAR}.csv')
 lobby=get('dk_lobby','https://www.draftkings.com/lobby/getcontests?sport=1','json')
 pool,contest=slate(lobby)
 return schedule,pd.concat(stats,ignore_index=True),pd.concat(rosters,ignore_index=True),current,depth,pool,contest

def prepare(s,st,ro,current,dep,pool):
 st=st[st.season_type=='REG'].copy();st['team']=st.team.replace(ALIASES);st['position']=st.position.replace({'FB':'RB'});st['points']=points(st)
 side=[]
 for a,b in [('away','home'),('home','away')]:
  z=s[['season','week','game_id','kick','gameday','gametime','weekday','total_line',a+'_team',b+'_team',a+'_score',b+'_score']].copy();z.columns=['season','week','game_id','kick','gameday','gametime','weekday','total_line','team','opp','nfl_points','allowed'];z['home']=int(a=='home');side.append(z)
 t=pd.concat(side,ignore_index=True).sort_values('kick');skill=st[st.position.isin(POS)].copy()
 for c in COLS:
  if c not in skill:skill[c]=0
 ro=ro[ro.game_type=='REG'].copy();ro['team']=ro.team.replace(ALIASES);ro['position']=ro.position.replace({'FB':'RB'})
 ro=ro[ro.position.isin(POS)&ro.gsis_id.notna()].drop_duplicates(['season','week','team','gsis_id'])
 h=ro.merge(t,on=['season','week','team'],how='inner',validate='m:1');h=h[h.game_id.isin(st.game_id)&h.nfl_points.notna()&(h.kick<NOW-pd.Timedelta(hours=8))]
 h=h.merge(skill[['game_id','team','player_id']+COLS],left_on=['game_id','team','gsis_id'],right_on=['game_id','team','player_id'],how='left',validate='1:1');h[COLS]=h[COLS].fillna(0);h['future']=False
 current=current.copy();current['team']=current.team.replace(ALIASES);current['position']=current.position.replace({'FB':'RB'});current['norm']=current.full_name.map(norm)
 dep=dep.copy()
 if 'dt' in dep:
  dep['stamp']=pd.to_datetime(dep.dt,utc=True);dep=dep[dep.stamp<=NOW];last=dep.stamp.max()
  if pd.isna(last) or NOW-last>pd.Timedelta(days=4):raise RuntimeError('Current depth chart too stale')
  dep=dep.sort_values('stamp').drop_duplicates(['team','gsis_id'],keep='last').copy();dep['team']=dep.team.replace(ALIASES);dep['depth_rank']=pd.to_numeric(dep.pos_rank,errors='coerce')
 else:raise RuntimeError('Timestamped current depth information required')
 deps=dep.dropna(subset=['gsis_id']).groupby(['team','gsis_id']).depth_rank.min().to_dict()
 aliases={'hollywoodbrown':'marquisebrown','kennygainwell':'kennethgainwell'};rows=[];rejected=[]
 for p in pool.to_dict('records'):
  if p['position']=='DST':continue
  match=current[(current.team==p['team'])&current.norm.eq(aliases.get(norm(p['name']),norm(p['name'])))&current.position.eq(p['position'])]
  if len(match)!=1 or pd.isna(match.iloc[0].get('gsis_id')):rejected.append({'name':p['name'],'reason':'Unresolved current roster identity'});continue
  r=match.iloc[0].to_dict();status=str(r.get('status',''));rank=deps.get((p['team'],r['gsis_id']))
  if status!='ACT' or p['disabled'] or p['status'].upper() in ['O','OUT','IR','INACTIVE','D','DOUBTFUL','SUSPENDED'] or (p['position']=='QB' and rank!=1):rejected.append({'name':p['name'],'reason':'Roster/status/depth eligibility'});continue
  g=t[(t.team==p['team'])&(t.opp==p['opp'])&(t.kick==pd.Timestamp(p['start']))]
  if len(g)!=1:raise RuntimeError('Official salary game does not match NFL schedule')
  r.update(g.iloc[0].to_dict());r.update(p);r['future']=True;r['depth_rank']=rank;r.update({c:np.nan for c in COLS});rows.append(r)
 if not rows:raise RuntimeError('No eligible matched players')
 d=pd.concat([h,pd.DataFrame(rows)],ignore_index=True).sort_values(['gsis_id','kick']).reset_index(drop=True);features=[]
 for c in COLS:
  for w in [4,12]:
   k='lag'+str(w)+'_'+c;d[k]=d.groupby('gsis_id')[c].transform(lambda x:x.shift().ewm(span=w,adjust=False,ignore_na=True).mean()).fillna(0);features.append(k)
 d['history_n']=d.groupby('gsis_id').cumcount();d['gap_days']=(d.kick-d.groupby('gsis_id').kick.shift()).dt.total_seconds().div(86400).fillna(365).clip(0,365);d['team_changed']=(d.groupby('gsis_id').team.shift().fillna(d.team)!=d.team).astype(int)
 d['age']=(d.kick.dt.tz_localize(None)-pd.to_datetime(d.birth_date,errors='coerce')).dt.days.div(365.25).fillna(26)
 d['draft_log']=np.log1p(pd.to_numeric(d.draft_number,errors='coerce').fillna(300));features+=['history_n','gap_days','team_changed','age','draft_log','home','week']
 for c in ['nfl_points','allowed']:
  k='team_lag_'+c;t[k]=t.groupby('team')[c].transform(lambda x:x.shift().ewm(span=8,adjust=False).mean()).fillna(22)
  d=d.merge(t[['game_id','team',k]],on=['game_id','team'],how='left',validate='m:1');features.append(k)
  d=d.merge(t[['game_id','team',k]].rename(columns={'team':'opp',k:'opp_'+k}),on=['game_id','opp'],how='left',validate='m:1');features.append('opp_'+k)
 return d,t,st,features,rejected

def fit_players(d,features):
 validation=YEAR-3;report={};out=[];cal=[]
 for pos in POS:
  h=d[(d.position==pos)&~d.future].copy();a=h[h.season<validation];v=h[h.season==validation].copy();f=d[(d.position==pos)&d.future].copy();m=model().fit(a[features],a.points)
  vp=np.maximum(0,m.predict(v[features]));vb=.5*(v.lag4_points+v.lag12_points).to_numpy();alpha=min([0,.25,.5,.75,1],key=lambda x:mean_squared_error(v.points,x*vp+(1-x)*vb));v['mu']=alpha*vp+(1-alpha)*vb;v['resid']=v.points-v.mu
  bins=np.array([0,3,6,10,15,20,100]);scales=[]
  for lo,hi in zip(bins[:-1],bins[1:]):
   r=v[(v.mu>=lo)&(v.mu<hi)].resid
   if len(r)<30:r=v.resid
   scales.append(max(.5,float(np.sqrt(np.mean(r*r)))))
  sigma=lambda mu:np.array([scales[min(5,max(0,np.searchsorted(bins,x,side='right')-1))] for x in mu])
  v['scale']=sigma(v.mu);v['z']=v.resid/v.scale;cal.append(v)
  tests={}
  for year in [YEAR-2,YEAR-1]:
   a=h[h.season<year];b=h[h.season==year];m=model().fit(a[features],a.points);base=.5*(b.lag4_points+b.lag12_points).to_numpy();pr=alpha*np.maximum(0,m.predict(b[features]))+(1-alpha)*base;tests[str(year)]=metrics(b.points,pr,base)
  final=model().fit(h[features],h.points)
  if len(f):f['mu']=alpha*np.maximum(0,final.predict(f[features]))+(1-alpha)*.5*(f.lag4_points+f.lag12_points);f['scale']=sigma(f.mu);out.append(f)
  report[pos]={'blend_hgb':alpha,'validation_season':validation,'tests':tests,'training_rows':len(h),'variance_bins':bins.tolist(),'variance_scale':scales}
  import pickle
  (ROOT/'models').mkdir(exist_ok=True)
  with (ROOT/'models'/f'{pos}.pkl').open('wb') as stream:pickle.dump({'model':final,'alpha':alpha,'features':features,'scale':scales},stream)
 report['features']=features;report['analyst_projections_used']=False;report['user_beliefs_used']=False;report['salary_used_as_forecast_feature']=False
 return pd.concat(out,ignore_index=True),pd.concat(cal,ignore_index=True),report

def team_and_defense(t,st):
 fields=['def_sacks','def_interceptions','fumble_recovery_opp','def_tds','special_teams_tds','def_safeties','def_punt_blocks','def_fg_blocks','def_pat_blocks']
 for c in fields:
  if c not in st:st[c]=0
 a=st.groupby(['game_id','team'])[fields].sum().reset_index();t=t.merge(a,on=['game_id','team'],how='left',validate='1:1');pa=t.allowed
 tiers=np.select([pa==0,pa<=6,pa<=13,pa<=20,pa<=27,pa<=34],[10,7,4,1,0,-1],default=-4)
 t['dst']=t.def_sacks+2*(t.def_interceptions+t.fumble_recovery_opp)+6*(t.def_tds+t.special_teams_tds)+2*(t.def_safeties+t.def_punt_blocks+t.def_fg_blocks+t.def_pat_blocks)+tiers;t.loc[t.nfl_points.isna(),'dst']=np.nan
 t=t.sort_values('kick');t['lag_dst']=t.groupby('team').dst.transform(lambda x:x.shift().ewm(span=8,adjust=False).mean()).fillna(7)
 t=t.merge(t[['game_id','team','team_lag_nfl_points','team_lag_allowed']].rename(columns={'team':'opp','team_lag_nfl_points':'opp_lag_points','team_lag_allowed':'opp_lag_allowed'}),on=['game_id','opp'],how='left',validate='1:1')
 fs=['home','team_lag_nfl_points','team_lag_allowed','opp_lag_points','opp_lag_allowed','lag_dst'];h=t.dropna(subset=['nfl_points','dst']);v=h[h.season==YEAR-3].copy();reports={}
 for target in ['nfl_points','dst']:
  a=h[h.season<YEAR-3];m=model().fit(a[fs],a[target]);v[target+'_resid']=v[target]-m.predict(v[fs]);test=h[h.season>=YEAR-2];m=model().fit(h[h.season<YEAR-2][fs],h[h.season<YEAR-2][target]);base=.5*(test.team_lag_nfl_points+test.opp_lag_allowed) if target=='nfl_points' else test.lag_dst;reports[target]=metrics(test[target],m.predict(test[fs]),base)
  final=model().fit(h[fs],h[target]);t[target+'_mu']=np.maximum(0,final.predict(t[fs]))
 return t,v,reports

def build_worlds(future,cal,t,tc,pool,N=4096,seed=941):
 ps=future[future.mu>=1].copy();keep=['id','name','position','salary','team','opp','game','start','status','gsis_id','mu','scale','history_n','game_id'];players=ps[keep].to_dict('records')
 for p in pool[pool.position=='DST'].to_dict('records'):
  a=t[(t.team==p['team'])&(t.kick==pd.Timestamp(p['start']))]
  if len(a)!=1:raise RuntimeError('DST game identity missing')
  a=a.iloc[0];p.update(mu=float(a.dst_mu),scale=1.,history_n=0,gsis_id='DST:'+p['team'],game_id=a.game_id);players.append({k:p[k] for k in keep})
 for i,p in enumerate(players):p['i']=i
 roles=cal.sort_values(['game_id','team','position','mu'],ascending=[True,True,True,False]).copy();roles['rank']=roles.groupby(['game_id','team','position']).cumcount()+1
 lookup={(r.game_id,r.team,r.position,int(r.rank)):float(r.z) for r in roles.itertuples() if r.rank<=5};blocks=[]
 for gid,a in tc.groupby('game_id'):
  if len(a)!=2:continue
  block=[]
  for side in [0,1]:
   r=a[a.home==side].iloc[0];block.append({'score':float(r.nfl_points_resid),'dst':float(r.dst_resid),'z':{pos+str(k):lookup.get((gid,r.team,pos,k),0) for pos in POS for k in range(1,6)}})
  blocks.append(block)
 if len(blocks)<100:raise RuntimeError('Insufficient paired empirical game blocks')
 for side in [0,1]:
  for key in ['score','dst']:
   mean=np.mean([b[side][key] for b in blocks])
   for b in blocks:b[side][key]-=mean
  for key in blocks[0][side]['z']:
   mean=np.mean([b[side]['z'][key] for b in blocks])
   for b in blocks:b[side]['z'][key]-=mean
 games=[]
 for game in sorted(pool.game.unique()):
  away,home=game.split('@');g=t[(t.team==away)&(t.opp==home)&t.kick.eq(pd.Timestamp(pool.loc[pool.game==game,'start'].iloc[0]))].iloc[0];op=t[(t.game_id==g.game_id)&(t.team==home)].iloc[0];games.append({'game':game,'away':away,'home':home,'mu':[float(g.nfl_points_mu),float(op.nfl_points_mu)],'game_id':g.game_id})
 rng=np.random.default_rng(seed);W=np.zeros((N,len(players)),np.float32);G=np.zeros((N,len(games),2),np.int16)
 for j,g in enumerate(games):
  draws=rng.integers(len(blocks),size=N)
  for side,team in enumerate([g['away'],g['home']]):
   G[:,j,side]=np.maximum(0,np.rint(g['mu'][side]+np.array([blocks[k][side]['score'] for k in draws])))
   for pos in POS+['DST']:
    pp=sorted([p for p in players if p['team']==team and p['position']==pos],key=lambda p:-p['mu'])
    for rank,p in enumerate(pp,1):
     z=np.array([blocks[k][side]['dst'] if pos=='DST' else blocks[k][side]['z'][pos+str(min(5,rank))] for k in draws]);lo=-4 if pos=='DST' else -3;v=np.maximum(lo,p['mu']+p['scale']*z);den=v.mean()-lo;W[:,p['i']]=lo+(v-lo)*(p['mu']-lo)/max(den,.01)
 return players,games,blocks,np.round(W,2),G

def legal(ids,ps):
 if len(ids)!=9 or len(set(ids))!=9:return False
 q=[ps[i] for i in ids];c=Counter(p['position'] for p in q);return c['QB']==1 and c['DST']==1 and 2<=c['RB']<=3 and 3<=c['WR']<=4 and 1<=c['TE']<=2 and sum(p['salary'] for p in q)<=50000 and len({p['game'] for p in q})>=2

def slots(ids,ps):
 rest=list(ids);c=Counter(ps[i]['position'] for i in rest);extra=[i for i in rest if ps[i]['position'] in POS[1:] and c[ps[i]['position']]>{'RB':2,'WR':3,'TE':1}[ps[i]['position']]];flex=max(extra,key=lambda i:ps[i]['start']);rest.remove(flex);out=[]
 for s in SLOTS:
  if s=='FLEX':out.append(flex)
  else:i=next(i for i in rest if ps[i]['position']==s);out.append(i);rest.remove(i)
 return out

def candidates(ps,W,calls=360,seed=1942):
 rng=np.random.default_rng(seed);N=len(ps);sal=np.array([p['salary'] for p in ps]);mean=np.array([p['mu'] for p in ps]);seen=set();out=[];effort=Counter()
 for k in range(calls//3):
  mix=rng.uniform(.15,.85);v=mean if k==0 else (1-mix)*mean+mix*W[rng.integers(len(W),size=int(rng.choice([1,2,4,8])))].mean(0)
  for shape in ['RB','WR','TE']:
   A=[np.ones(N),sal];lo=[9,0];hi=[9,50000]
   for pos,count in [('QB',1),('RB',2),('WR',3),('TE',1),('DST',1)]:A.append(np.array([p['position']==pos for p in ps],float));lo.append(count+int(pos==shape));hi.append(count+int(pos==shape))
   for g in sorted({p['game'] for p in ps}):A.append(np.array([p['game']==g for p in ps],float));lo.append(0);hi.append(8)
   r=milp(-v,integrality=np.ones(N),bounds=Bounds(np.zeros(N),np.ones(N)),constraints=LinearConstraint(np.array(A),lo,hi),options={'time_limit':1.,'mip_rel_gap':.003});effort[shape]+=1
   if r.x is None:continue
   ids=np.flatnonzero(r.x>.5).tolist()
   if not legal(ids,ps):raise RuntimeError('Optimizer failed roster validation')
   key=tuple(sorted(ids))
   if key not in seen:seen.add(key);out.append(slots(ids,ps))
 if len(out)<60:raise RuntimeError('Candidate coverage too low')
 return out,dict(effort)

def scorebank(W,bank):return np.stack([W[:,ids].sum(1) for ids in bank],axis=1)
def twenty(ps,games,train,hold,HG):
 bank,effort=candidates(ps,train,calls=int(os.getenv('MILLY_SOLVES','600')));refs,_=candidates(ps,train,300,42199);A=scorebank(train,bank);B=scorebank(hold,bank);ra=scorebank(train,refs).max(1);rb=scorebank(hold,refs).max(1);p=(A>ra[:,None]+.005).mean(0);rank=np.argsort(-(p-.5*np.sqrt(p*(1-p)/len(train))),kind='stable');q=(B>rb[:,None]+.005).mean(0);out=[]
 for r,j in enumerate(rank[:20],1):
  ids=bank[j];wins=np.flatnonzero(B[:,j]>rb+.005);w=int(wins[np.argsort(B[wins,j])[len(wins)//2]]) if len(wins) else int(np.argmax(B[:,j]-rb));out.append({'rank':r,'ids':ids,'salary':sum(ps[i]['salary'] for i in ids),'forecast_mean':sum(ps[i]['mu'] for i in ids),'p90':np.quantile(B[:,j],.9),'selection_reference_rate':p[j],'evaluation_reference_rate':q[j],'flex':ps[ids[7]]['position'],'witness':{'won':bool(B[w,j]>rb[w]+.005),'lineup_points':B[w,j],'reference_best':rb[w],'player_points':hold[w,ids].tolist(),'games':[{'game':g['game'],'away':HG[w,k,0],'home':HG[w,k,1]} for k,g in enumerate(games)]}})
 diag={'solver_effort':effort,'unique_candidates':len(bank),'reference_entries':len(refs),'selection_worlds':len(train),'evaluation_worlds':len(hold),'selected_flex':dict(Counter(l['flex'] for l in out)),'holdout_top20_overlap':len(set(rank[:20])&set(np.argsort(-q)[:20])),'reference_note':'Independently searched hypothetical strong-model portfolio; not actual ownership or MM win probability'}
 return out,diag,bank,refs,ra,rb

def over_under(s,st):
 production=st[st.position.isin(POS+['FB'])].groupby('game_id').points.sum();g=s[(s.season>=YEAR-6)&(s.season<YEAR)&(s.weekday=='Sunday')&(s.gametime>='13:00')&(s.gametime<='16:30')&s.home_score.notna()].copy();g['fp']=g.game_id.map(production);g=g.dropna(subset=['fp','total_line']);rows=[]
 for (year,week),a in g.groupby(['season','week']):
  if len(a)<3:continue
  fp=a.fp.to_numpy();rows.append({'season':int(year),'week':int(week),'games':len(a),'ou_sum':a.total_line.sum(),'ou_mean':a.total_line.mean(),'fp_sum':fp.sum(),'fp_mean':fp.mean(),'top2_normalized':np.sort(fp)[-2:].sum()/fp.sum()*len(a)/2})
 d=pd.DataFrame(rows);cor=lambda a,b:float(np.corrcoef(a,b)[0,1]);X=np.column_stack([np.ones(len(d)),d.games,pd.get_dummies(d.season,drop_first=True,dtype=float)]);resid=lambda y:y-X@np.linalg.lstsq(X,y,rcond=None)[0];tr=d[d.season<=YEAR-3];te=d[d.season>YEAR-3];coef=np.polyfit(tr.ou_mean,tr.fp_mean,1);cut=float(tr.ou_mean.quantile(.25));low=te[te.ou_mean<=cut];other=te[te.ou_mean>cut]
 return {'slates':len(d),'games':len(g),'raw_correlation':cor(d.ou_sum,d.fp_sum),'per_game_correlation':cor(d.ou_mean,d.fp_mean),'partial_gamecount_season':cor(resid(d.ou_sum.to_numpy()),resid(d.fp_sum.to_numpy())),'holdout_mae':np.abs(te.fp_mean-np.polyval(coef,te.ou_mean)).mean(),'constant_mae':np.abs(te.fp_mean-tr.fp_mean.mean()).mean(),'low_n':len(low),'other_n':len(other),'low_top2':low.top2_normalized.mean(),'other_top2':other.top2_normalized.mean(),'rows':rows,'limits':['Sunday slates reconstructed from kickoff windows, not authenticated DK draft groups.','Historical market timestamps are not authenticated pre-lock snapshots.','Game production concentration is not salary-constrained winning lineup shape. That second hypothesis remains untested.']}

def run():
 start=time.time();save(PUB/'health.json',{'status':'running','at':NOW})
 try:
  s,st,ro,current,dep,pool,contest=collect();d,t,st,fs,rejected=prepare(s,st,ro,current,dep,pool);print('Historical rows',int((~d.future).sum()),flush=True);f,cal,validation=fit_players(d,fs);t,tc,teamreport=team_and_defense(t,st);validation['team_models']=teamreport
  N=int(os.getenv('MILLY_WORLDS','4096'));ps,games,blocks,W,G=build_worlds(f,cal,t,tc,pool,N,811);_,_,_,H,HG=build_worlds(f,cal,t,tc,pool,N,812);lineups,diag,bank,refs,ra,rb=twenty(ps,games,W,H,HG);hyp=over_under(s,st)
  now=pd.Timestamp.now(tz='UTC');rid=f'{YEAR}-w{int(f.week.iloc[0]):02d}-'+now.strftime('%Y%m%dT%H%M%SZ');release={'version':'1.0','release_id':rid,'generated_at':now,'contest':contest,'players':ps,'games':games,'lineups':lineups,'diagnostics':diag,'validation':validation,'hypothesis':hyp,'excluded':rejected,'source_receipts':[json.loads(x) for x in (CACHE/'source-receipts.jsonl').read_text().splitlines()],'code_sha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'entry_ready':False,'independent_baseline':True,'limitations':['Historical rosters are reconstructed, not authenticated pre-lock snapshots.','Joint empirical worlds are statistical, not exact conserved plays or final box scores.','DST uses a learned scoreboard-based scoring proxy, not exact rare-play attribution.','Questionable players are conditional on playing; no guaranteed final-inactive service.','No six-year full-field Millionaire Maker backtest, ownership calibration or demonstrated profitable edge.']}
  assert len(lineups)==20 and all(legal(l['ids'],ps) for l in lineups)
  assert len({tuple(sorted(l['ids'])) for l in lineups})==20
  assert not set(fs)&{'salary','ownership','total_line','points','expert_projection','user_belief'}
  assert now<pd.Timestamp(contest['kickoff'])
  for l in lineups:assert abs(sum(l['witness']['player_points'])-l['witness']['lineup_points'])<.1
  take=min(1024,N);world={'release_id':rid,'generated_at':now,'lock':contest['kickoff'],'players':ps,'games':games,'candidates':bank,'reference_entries':len(refs),'selection':{'points':np.rint(W[:take]*100).astype(np.int32),'scores':G[:take],'reference':ra[:take]},'evaluation':{'points':np.rint(H[:take]*100).astype(np.int32),'scores':HG[:take],'reference':rb[:take]}}
  world['point_scale']=100
  save(STAGE/'latest.json',release);save(STAGE/'worlds.json',world);save(STAGE/'hypothesis.json',hyp);save(STAGE/'validation.json',validation)
  from publication import render
  render(release,world,STAGE)
  from tests import verify
  checks=verify(release,world);save(STAGE/'verification.json',checks)
  archive=PUB/'archive';archive.mkdir(exist_ok=True);raw=json.dumps(clean(release),ensure_ascii=False,separators=(',',':'),allow_nan=False)
  with (archive/(rid+'.json')).open('x') as stream:stream.write(raw)
  for path in STAGE.iterdir():
   if path.is_file():os.replace(path,PUB/path.name)
  receipt={'status':'success','at':pd.Timestamp.now(tz='UTC'),'release_id':rid,'sha256':hashlib.sha256(raw.encode()).hexdigest(),'elapsed_seconds':time.time()-start,'verification':checks}
  save(PUB/'health.json',receipt);print(json.dumps(clean(receipt),indent=2),flush=True)
 except Exception as e:
  save(PUB/'health.json',{'status':'failed','at':pd.Timestamp.now(tz='UTC'),'error':str(e),'previous_release_preserved':True});traceback.print_exc();raise
if __name__=='__main__':run()
