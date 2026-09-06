"""Milly 1.0: independent, chronological NFL forecasts. No analyst/market/ownership inputs.
Roster membership is retrospectively sourced; see model-card limitations.
"""
from __future__ import annotations
import datetime as dt, hashlib, json, pathlib, re, unicodedata
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_squared_error, mean_absolute_error, mean_pinball_loss
ROOT=pathlib.Path(__file__).resolve().parent
POSITIONS=['QB','RB','WR','TE','DST']
MEASURES=['dk','targets','carries','attempts','receiving_yards','rushing_yards','passing_yards','receiving_tds','rushing_tds','passing_tds','receiving_air_yards']
TEAM_MEASURES=['points','allowed','targets','carries','attempts','passing_yards','rushing_yards','passing_tds','rushing_tds','sacks_suffered','passing_interceptions']
BLOCKED={'O','OUT','IR','INACTIVE','SUSPENDED','SUSP','PUP','NFI'}

def num(d,k,default=0):
    if k not in d:return pd.Series(default,index=d.index,dtype=float)
    return pd.to_numeric(d[k],errors='coerce').fillna(default)

def norm(s):
    s=unicodedata.normalize('NFKD',str(s)).encode('ascii','ignore').decode().lower()
    return re.sub(r'(jr|sr|iii|ii|iv)$','',re.sub('[^a-z]','',s))

def team(s):return {'LA':'LAR','JAC':'JAX','WSH':'WAS','OAK':'LV','SD':'LAC','STL':'LAR'}.get(str(s),str(s))

def read(name,required=True):
    p=ROOT/'cache'/(name+'.csv.gz')
    if not p.exists():
        if required:raise FileNotFoundError(p)
        return pd.DataFrame()
    return pd.read_csv(p,low_memory=False)

def score(d):
    g=lambda c:num(d,c)
    return (.04*g('passing_yards')+4*g('passing_tds')-g('passing_interceptions')
        +.1*(g('rushing_yards')+g('receiving_yards'))+g('receptions')
        +6*(g('rushing_tds')+g('receiving_tds')+g('special_teams_tds')+g('fumble_recovery_tds'))
        -g('sack_fumbles_lost')-g('rushing_fumbles_lost')-g('receiving_fumbles_lost')
        +2*(g('passing_2pt_conversions')+g('rushing_2pt_conversions')+g('receiving_2pt_conversions'))
        +3*(g('passing_yards')>=300)+3*(g('rushing_yards')>=100)+3*(g('receiving_yards')>=100))

def normalize_roster(r):
    if r.empty:return r
    r=r.copy(); r=r.rename(columns={'gsis_id':'player_id','full_name':'name'})
    if 'game_type' in r:r=r[r.game_type=='REG'].copy()
    if 'name' not in r:r['name']=r.get('football_name',r.get('player_name',r['player_id']))
    r['team']=r['team'].map(team); r['position']=r['position'].replace({'FB':'RB'})
    return r[r.position.isin(POSITIONS[:-1]) & r.player_id.notna()].copy()

def team_rows(schedule,allstats):
    rows=[]
    for side,opp in [('away','home'),('home','away')]:
        s=schedule.copy();s['team']=s[side+'_team'].map(team);s['opp']=s[opp+'_team'].map(team)
        s['points']=pd.to_numeric(s[side+'_score'],errors='coerce');s['allowed']=pd.to_numeric(s[opp+'_score'],errors='coerce')
        s['home']=int(side=='home');rows.append(s[['game_id','season','week','gameday','gametime','team','opp','points','allowed','home','total_line']])
    t=pd.concat(rows,ignore_index=True);t['date']=pd.to_datetime(t.gameday)
    if allstats.empty:return t
    sums=[c for c in set(TEAM_MEASURES+['def_sacks','def_interceptions','fumble_recovery_opp','def_tds','special_teams_tds','def_safeties','def_punt_blocks','def_fg_blocks','def_pat_blocks','def_2pt_made']) if c in allstats and c not in ['points','allowed']]
    a=allstats.groupby(['game_id','team'])[sums].sum().reset_index();t=t.merge(a,on=['game_id','team'],how='left',validate='1:1')
    pa=t['allowed'];bucket=np.select([pa==0,pa<=6,pa<=13,pa<=20,pa<=27,pa<=34],[10,7,4,1,0,-1],default=-4)
    t['dst']=num(t,'def_sacks')+2*(num(t,'def_interceptions')+num(t,'fumble_recovery_opp'))+6*(num(t,'def_tds')+num(t,'special_teams_tds'))+2*(num(t,'def_safeties')+num(t,'def_punt_blocks')+num(t,'def_fg_blocks')+num(t,'def_pat_blocks')+num(t,'def_2pt_made'))+bucket
    t.loc[t.points.isna(),'dst']=np.nan
    return t

def discover(audit):
    now=pd.Timestamp.now(tz='UTC'); choices=[]
    discovery=json.loads((ROOT/'public'/'contest-discovery.json').read_text())
    for c in discovery.get('contests',[]):
        if str(c.get('gameType','')).lower()!='classic':continue
        gid=str(c.get('dg','')); p=ROOT/'cache'/('dk_pool_'+gid+'.json')
        if not p.exists():continue
        d=json.loads(p.read_text());ds=d.get('draftables',[])
        times=[pd.to_datetime(x.get('competition',{}).get('startTime'),utc=True) for x in ds]
        times=[x for x in times if pd.notna(x)]
        if not times:continue
        start=min(times); comps={x.get('competition',{}).get('competitionId') for x in ds}
        if start<=now or start.tz_convert('America/New_York').dayofweek!=6 or len(comps)<5:continue
        choices.append((start,-len(comps),abs(float(c.get('a',20))-20),c,d))
    if not choices:raise ValueError('No complete upcoming Sunday NFL Classic Millionaire salary pool. No old-slate fallback.')
    _,_,_,contest,d=min(choices,key=lambda x:x[:3]); unique={}
    for p in sorted(d['draftables'],key=lambda x:int(x['draftableId'])):
        if p.get('position') not in POSITIONS:continue
        key=str(p.get('playerId',p['draftableId']));competition=p.get('competition',{})
        game=re.sub(r'\s+','',competition.get('name',''));tm=team(p.get('teamAbbreviation',''))
        gteams=[team(x) for x in game.split('@')]
        if len(gteams)!=2 or tm not in gteams:raise ValueError('Invalid official player/game mapping')
        row={'id':str(p['draftableId']),'identity':key,'dk_id':str(p.get('playerDkId','')),'name':p['displayName'],'position':p['position'],'salary':int(p['salary']),'team':tm,'opp':gteams[1] if tm==gteams[0] else gteams[0],'matchup':'@'.join(gteams),'start':competition['startTime'],'status':str(p.get('status','')),'disabled':bool(p.get('isDisabled',False))}
        if key in unique:
            if unique[key]['salary']!=row['salary']:raise ValueError('Conflicting salaries for same player')
            continue
        unique[key]=row
    pool=pd.DataFrame(unique.values()); source=next((s for s in audit['sources'] if s['name']=='dk_pool_'+str(contest['dg']) and s['ok']),None)
    if not source or (now-pd.Timestamp(source['retrieved_at'])).total_seconds()>6*3600:raise ValueError('Salary source older than six hours')
    return pool,contest,source

def datasets(pool):
    schedule=read('schedule');schedule=schedule[(schedule.game_type=='REG') & (schedule.season>=2019)].copy()
    now=pd.Timestamp.now(tz='UTC');year=int(schedule[schedule.gameday<=str(now.date())].season.max())
    allstats=[];rosters=[]
    for y in range(2019,year+1):
        s=read('stats_'+str(y),False)
        if not s.empty:
            s=s[s.season_type=='REG'].copy();s['team']=s['team'].map(team);allstats.append(s)
        r=read('rosters_'+str(y),False)
        if not r.empty:rosters.append(normalize_roster(r))
    if len(allstats)<6:raise ValueError('At least six historical seasons required')
    stats=pd.concat(allstats,ignore_index=True);stats=stats.drop_duplicates(['game_id','team','player_id'])
    t=team_rows(schedule,stats)
    completed=t[t.points.notna()].copy()
    roster=pd.concat(rosters,ignore_index=True)
    roster['season']=pd.to_numeric(roster.season);roster['week']=pd.to_numeric(roster.week)
    hist=roster.merge(completed[['game_id','season','week','team','opp','date','home']],on=['season','week','team'],how='inner',validate='m:1')
    hist=hist.drop_duplicates(['game_id','team','player_id'])
    skill=stats[stats.position.isin(POSITIONS[:-1])].copy();skill['dk']=score(skill)
    keep=['game_id','team','player_id']+MEASURES
    for c in keep:
        if c not in skill:skill[c]=0
    hist=hist.drop(columns=[c for c in MEASURES if c in hist],errors='ignore').merge(skill[keep],on=['game_id','team','player_id'],how='left',validate='1:1')
    hist[MEASURES]=hist[MEASURES].fillna(0)
    current=normalize_roster(read('roster_current'))
    current=current.drop_duplicates(['team','player_id'],keep='last');current['nname']=current.name.map(norm)
    maps={(r.team,r.nname):r for r in current.itertuples()}
    aliases={'hollywoodbrown':'marquisebrown','kennygainwell':'kennethgainwell','joshpalmer':'joshuapalmer','bamaknight':'zonovanknight'}
    todaygames=t[t.gameday.isin(pool.start.map(lambda x:str(pd.Timestamp(x).date())).unique())].copy()
    futures=[];unmatched=[]
    for i,p in pool.iterrows():
        g=todaygames[(todaygames.team==p.team)&(todaygames.opp==p.opp)]
        if len(g)!=1:raise ValueError('Official salary matchup absent from NFL schedule: '+p.matchup)
        g=g.iloc[0];pool.loc[i,'game_id']=g.game_id
        if p.position=='DST':
            pid='DST:'+p.team;row={'player_id':pid,'name':p['name'],'position':'DST'};pool.loc[i,'roster_status']='ACT'
        else:
            key=norm(p['name']);m=maps.get((p.team,key)) or maps.get((p.team,aliases.get(key,key)))
            if m is None:
                unmatched.append({'name':p['name'],'team':p.team,'reason':'No exact current-roster identity'});continue
            row=m._asdict();pid=row['player_id'];pool.loc[i,'roster_status']=str(row.get('status','UNKNOWN'))
        pool.loc[i,'player_id']=pid
        row.update({k:g[k] for k in ['game_id','season','week','team','opp','date','home']});row['future']=True
        row.update({k:np.nan for k in MEASURES});futures.append(row)
    dst=completed[['game_id','season','week','team','opp','date','home','dst']].rename(columns={'dst':'dk'}).copy()
    dst['player_id']='DST:'+dst.team;dst['position']='DST';dst['name']=dst.team+' DST'
    for c in MEASURES:
        if c not in dst:dst[c]=0
    hist['future']=False;dst['future']=False
    d=pd.concat([hist,dst,pd.DataFrame(futures)],ignore_index=True)
    d=d.drop_duplicates(['game_id','team','player_id'],keep='last').sort_values(['player_id','date']).reset_index(drop=True)
    d['date']=pd.to_datetime(d.date);d['future']=d.future.fillna(False)
    features=[]
    for c in MEASURES:
        for w in [1,3,8]:
            k=f'lag{w}_{c}';d[k]=d.groupby('player_id',sort=False)[c].transform(lambda x:x.shift(1).rolling(w,min_periods=1).mean());features.append(k)
    d['history_n']=d.groupby('player_id').cumcount().clip(upper=100)
    prev=d.groupby('player_id').date.shift(1);d['days_since']=(d.date-prev).dt.days.clip(0,730).fillna(730)
    prevteam=d.groupby('player_id').team.shift(1);d['team_change']=(prevteam.notna() & (prevteam!=d.team)).astype(int)
    birth=pd.to_datetime(d.get('birth_date',pd.Series(pd.NaT,index=d.index)),errors='coerce');d['age']=(d.date-birth).dt.days/365.25
    d['draft_number']=num(d,'draft_number',300);d['week1']=(d.week==1).astype(int)
    d['target_acceleration']=d.lag1_targets-d.lag8_targets;d['carry_acceleration']=d.lag1_carries-d.lag8_carries
    d['role_volume']=d.lag3_targets.fillna(0)+d.lag3_carries.fillna(0)+d.lag3_attempts.fillna(0)/3
    d['role_rank']=d.groupby(['game_id','team','position']).role_volume.rank(method='first',ascending=False)
    denom=d.groupby(['game_id','team']).role_volume.transform('sum');d['opportunity_fraction']=d.role_volume/(denom+1)
    for p in POSITIONS:
        d['pos_'+p]=(d.position==p).astype(int);features.append('pos_'+p)
    basic=features+['history_n','days_since','team_change','age','draft_number','week1','home','role_rank','opportunity_fraction','target_acceleration','carry_acceleration']
    t=t.sort_values(['team','date']).copy();tf=[]
    for c in TEAM_MEASURES:
        if c not in t:t[c]=np.nan
        for w in [3,8]:
            k=f'team_lag{w}_{c}';t[k]=t.groupby('team')[c].transform(lambda x:x.shift().rolling(w,min_periods=1).mean());tf.append(k)
    d=d.merge(t[['game_id','team']+tf],on=['game_id','team'],how='left',validate='m:1')
    other=t[['game_id','team']+tf].rename(columns={'team':'opp',**{k:'opp_'+k for k in tf}})
    d=d.merge(other,on=['game_id','opp'],how='left',validate='m:1')
    t=t.merge(other,on=['game_id','opp'],how='left',validate='m:1')
    features=basic+tf+['opp_'+k for k in tf]
    d[features]=d[features].replace([np.inf,-np.inf],np.nan)
    volume=[k for k in basic if k not in ['target_acceleration','carry_acceleration','role_rank','opportunity_fraction']]
    return d,t,pool,stats,{'unmatched':unmatched,'historical_rows':int((~d.future).sum()),'seasons':sorted(map(int,d[~d.future].season.unique()))},features,volume,tf+['opp_'+k for k in tf]+['home']

def baseline(d):return (.6*d.lag3_dk.fillna(0)+.4*d.lag8_dk.fillna(0)).to_numpy()

def fit_model(d,features,loss='squared_error',quantile=None):
    model=HistGradientBoostingRegressor(loss=loss,quantile=quantile,max_iter=100,max_leaf_nodes=15,min_samples_leaf=60,l2_regularization=20,learning_rate=.07,early_stopping=False,random_state=271828)
    return model.fit(d[features],d.dk)

def metrics(y,p):
    return {'n':len(y),'rmse':float(np.sqrt(mean_squared_error(y,p))),'mae':float(mean_absolute_error(y,p))}

def train(d,features,volume):
    h=d[~d.future & d.dk.notna() & (d.season>=2020)].copy()
    a=h[h.season<=2022];v=h[h.season==2023];cal=h[h.season==2024];test=h[h.season==2025]
    if min(len(a),len(v),len(cal),len(test))<500:raise ValueError('Chronological training/calibration/test partitions incomplete')
    candidates={'baseline':metrics(v.dk,baseline(v))};fs={'volume':volume,'context':features}
    for key,cols in fs.items():
        m=fit_model(a,cols);candidates[key]=metrics(v.dk,m.predict(v[cols]))
    champion=min(candidates,key=lambda k:candidates[k]['rmse']);cols=fs.get(champion,features)
    predictions={};reports={}
    for yr in [2024,2025]:
        tr=h[h.season<yr];te=h[h.season==yr].copy()
        m=None if champion=='baseline' else fit_model(tr,cols)
        te['mu']=baseline(te) if m is None else m.predict(te[cols]);te['residual']=te.dk-te.mu
        qm=fit_model(tr,cols,'quantile',.90);qp=qm.predict(te[cols]);te['q90']=qp
        reports[str(yr)]={'model':metrics(te.dk,te.mu),'baseline':metrics(te.dk,baseline(te)),
            'q90_coverage':float(np.mean(te.dk<=qp)),'q90_pinball':float(mean_pinball_loss(te.dk,qp,alpha=.90)),
            'by_position':{p:metrics(te[te.position==p].dk,te[te.position==p].mu) for p in POSITIONS},
            'known_opportunity':metrics(te[te.lag3_dk.fillna(0)>=5].dk,te[te.lag3_dk.fillna(0)>=5].mu)}
        predictions[yr]=te
    final=None if champion=='baseline' else fit_model(h,cols)
    future=d[d.future].copy();future['mu']=baseline(future) if final is None else final.predict(future[cols]);future['mu']=future.mu.clip(lower=0)
    calibration=predictions[2024]
    residuals={}
    bins=np.array([-np.inf,3,6,10,15,20,np.inf]);qs=np.linspace(.001,.999,101)
    for p in POSITIONS:
        allr=calibration[calibration.position==p].residual.to_numpy()
        for j in range(len(bins)-1):
            r=calibration[(calibration.position==p)&(calibration.mu>=bins[j])&(calibration.mu<bins[j+1])].residual.to_numpy()
            if len(r)<50:r=allr
            residuals[p+':'+str(j)]={'n':len(r),'quantiles':np.quantile(r-np.mean(r),qs).round(5).tolist()}
    audit={'model':'Milly independent chronological GBM v1.0','champion':champion,'selection_year':2023,'candidates':candidates,'calibration_year':2024,'unseen_audit_year':2025,'evaluation':reports,'training_rows':len(h),'training_seasons':sorted(map(int,h.season.unique())),'feature_count':len(cols),'features':cols,'analyst_forecasts_used':False,'market_lines_used_in_forecasts':False,'ownership_used_in_forecasts':False,'target':'DK offensive scoring; DST uses approximate scoreboard points-allowed buckets','residuals':residuals,'bins':[3,6,10,15,20]}
    future['resid_key']=[p+':'+str(int(np.searchsorted(bins[1:-1],mu,side='right'))) for p,mu in zip(future.position,future.mu)]
    return future,calibration,audit,predictions

def fit_team(t,features):
    h=t[(t.season>=2020)&t.points.notna()].copy();h['dk']=h.points
    pred={};reports={}
    for yr in [2024,2025]:
        te=h[h.season==yr].copy();m=fit_model(h[h.season<yr],features);te['mu']=m.predict(te[features]);te['residual']=te.points-te.mu;pred[yr]=te
        base=(te.team_lag8_points.fillna(22)+te.opp_team_lag8_allowed.fillna(22))/2
        reports[str(yr)]={'model':metrics(te.points,te.mu),'baseline':metrics(te.points,base)}
    m=fit_model(h,features);future=t[t.points.isna()].copy();future['mu']=m.predict(future[features]);return future,pred[2024],reports
