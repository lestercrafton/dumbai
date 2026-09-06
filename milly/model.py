"""Independent chronological NFL forecasts. No salary, analyst forecast or ownership input.
Milly research v1.0. Box-score targets include active players with zero opportunity.
Historical depth feeds before 2025 lack authenticated publication timestamps.
"""
from __future__ import annotations
import bisect, datetime as dt, json, math, pathlib, re, unicodedata
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
ROOT=pathlib.Path(__file__).resolve().parent
CACHE=ROOT/'cache'; PUBLIC=ROOT/'public'; PUBLIC.mkdir(exist_ok=True)
POS=['QB','RB','WR','TE']; TEAM_MAP={'LA':'LAR','OAK':'LV','SD':'LAC','STL':'LAR','JAC':'JAX','WSH':'WAS'}
SEED=90417

def norm(s):
    s=unicodedata.normalize('NFKD',str(s)).encode('ascii','ignore').decode().lower()
    return re.sub('[^a-z0-9]','',re.sub(r'\b(jr|sr|ii|iii|iv)\b','',s))

def clean(x):
    if isinstance(x,dict):return {str(k):clean(v) for k,v in x.items()}
    if isinstance(x,(list,tuple,np.ndarray)):return [clean(v) for v in x]
    if isinstance(x,np.integer):return int(x)
    if isinstance(x,(float,np.floating)):return round(float(x),6) if math.isfinite(x) else None
    if isinstance(x,np.bool_):return bool(x)
    if isinstance(x,(dt.datetime,pd.Timestamp)):return x.isoformat()
    return x

def write(name,x):
    p=PUBLIC/name;p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(clean(x),ensure_ascii=False,allow_nan=False,separators=(',',':')))

def read(name):
    p=CACHE/(name+'.csv.gz')
    return pd.read_csv(p,low_memory=False) if p.exists() else pd.DataFrame()

def num(d,k):
    return pd.to_numeric(d[k],errors='coerce').fillna(0) if k in d else pd.Series(0.,index=d.index)

def offense_points(d):
    py,ry,cy=[num(d,k) for k in ['passing_yards','rushing_yards','receiving_yards']]
    lost=num(d,'fumbles_lost_total') if 'fumbles_lost_total' in d else sum(num(d,k) for k in ['sack_fumbles_lost','rushing_fumbles_lost','receiving_fumbles_lost'])
    return .04*py+4*num(d,'passing_tds')-num(d,'passing_interceptions')+.1*(ry+cy)+6*(num(d,'rushing_tds')+num(d,'receiving_tds'))+num(d,'receptions')-lost+2*sum(num(d,k) for k in ['passing_2pt_conversions','rushing_2pt_conversions','receiving_2pt_conversions'])+6*(num(d,'special_teams_tds')+num(d,'fumble_recovery_tds'))+3*((py>=300).astype(int)+(ry>=100).astype(int)+(cy>=100).astype(int))

def pa_points(x):return np.select([x==0,x<=6,x<=13,x<=20,x<=27,x<=34],[10,7,4,1,0,-1],default=-4)

def schedules():
    s=read('schedule');s=s[s.game_type=='REG'].copy()
    for k in ['home_team','away_team']:s[k]=s[k].replace(TEAM_MAP)
    s['kickoff']=pd.to_datetime(s.gameday+' '+s.gametime.fillna('13:00')).dt.tz_localize('America/New_York').dt.tz_convert('UTC')
    return s

def depth_for(games,season,now):
    d=read(f'depth_{season}');out=[]
    if d.empty:return pd.DataFrame(columns=['game_id','player_id','depth'])
    if 'dt' in d:
        d=d[d.pos_abb.isin(POS)].copy();d['stamp']=pd.to_datetime(d.dt,utc=True)
        d=d[d.stamp<=now];d['team']=d.team.replace(TEAM_MAP)
        for team,q in d.groupby('team'):
            snapshots={stamp:a for stamp,a in q.groupby('stamp')};times=sorted(snapshots)
            for g in games[(games.home_team==team)|(games.away_team==team)].itertuples():
                j=bisect.bisect_left(times,min(g.kickoff,now))-1
                if j<0:continue
                for x in snapshots[times[j]].itertuples():
                    rank=float(x.pos_rank)
                    if x.pos_abb=='WR':rank=math.ceil(rank/3)
                    out.append((g.game_id,x.gsis_id,rank))
    else:
        d=d[(d.game_type=='REG')&(d.formation=='Offense')].copy();d['club_code']=d.club_code.replace(TEAM_MAP)
        sides=pd.concat([games[['game_id','week','home_team']].rename(columns={'home_team':'club_code'}),games[['game_id','week','away_team']].rename(columns={'away_team':'club_code'})])
        q=d.merge(sides,on=['week','club_code']);out=list(zip(q.game_id,q.gsis_id,pd.to_numeric(q.depth_team,errors='coerce')))
    a=pd.DataFrame(out,columns=['game_id','player_id','depth']).dropna()
    return a.groupby(['game_id','player_id'],as_index=False).depth.min() if not a.empty else a

def lag_ewm(frame,group,key,span):
    shifted=frame.groupby(group,sort=False)[key].shift()
    return shifted.groupby(frame[group],sort=False).ewm(span=span,adjust=False,min_periods=1).mean().reset_index(level=0,drop=True).reindex(frame.index)

def dataset(now=None):
    now=pd.Timestamp(now or dt.datetime.now(dt.timezone.utc));s=schedules();season=now.year if now.month>=3 else now.year-1
    past=s[(s.season>=season-7)&(s.kickoff<now)&s.home_score.notna()&s.away_score.notna()].copy()
    future=s[(s.kickoff>now)&(s.weekday=='Sunday')&(s.gametime>='13:00')&(s.gametime<='16:30')].copy()
    if future.empty:raise ValueError('No future Sunday daytime NFL slate is published')
    future=future[future.gameday==future.gameday.min()];calendar=pd.concat([past,future],ignore_index=True)
    raw=[];rost=[];dep=[]
    for year in sorted(calendar.season.unique()):
        st=read(f'stats_{year}')
        if not st.empty:
            st=st[st.season_type=='REG'].copy();st['team']=st.team.replace(TEAM_MAP);st['fpts']=offense_points(st);raw.append(st)
        r=read(f'rosters_{year}')
        if not r.empty:
            r=r[(r.game_type=='REG')&r.position.isin(POS)&r.gsis_id.notna()&(r.status=='ACT')].copy();r['team']=r.team.replace(TEAM_MAP);rost.append(r)
        dep.append(depth_for(calendar[calendar.season==year],year,now))
    stats=pd.concat(raw,ignore_index=True);rosters=pd.concat(rost,ignore_index=True);teams=[]
    # A completed game whose stat feed has not arrived is missing, never all-player zero.
    calendar=calendar[(calendar.kickoff>now)|calendar.game_id.isin(stats.game_id)].copy()
    for side,other in [('home','away'),('away','home')]:
        a=calendar[['game_id','season','week','kickoff',side+'_team',other+'_team',side+'_score',other+'_score']].copy()
        a.columns=['game_id','season','week','kickoff','team','opponent','score','opp_score'];a['home']=int(side=='home');teams.append(a)
    t=pd.concat(teams,ignore_index=True).sort_values(['kickoff','team']).reset_index(drop=True)
    offensive=stats[stats.position.isin(POS)].copy()
    fp=offensive.groupby(['game_id','team']).fpts.sum().rename('team_fp').reset_index();t=t.merge(fp,on=['game_id','team'],how='left')
    bypos=offensive.groupby(['game_id','team','position']).fpts.sum().unstack('position').reset_index()
    for p in POS:t=t.merge(bypos[['game_id','team',p]].rename(columns={'team':'opponent',p:'allowed_'+p}),on=['game_id','opponent'],how='left')
    dk=['def_sacks','def_interceptions','def_tds','def_safeties','def_punt_blocks','def_fg_blocks','def_pat_blocks','special_teams_tds','fumble_recovery_opp']
    defs=stats.groupby(['game_id','team'])[dk].sum().reset_index();t=t.merge(defs,on=['game_id','team'],how='left')
    t=t.merge(defs[['game_id','team','def_tds']].rename(columns={'team':'opponent','def_tds':'opp_def_tds'}),on=['game_id','opponent'],how='left')
    allowed=(t.opp_score-6*t.opp_def_tds.fillna(0)).clip(lower=0)
    t['dst_fp']=t.def_sacks+2*(t.def_interceptions+t.fumble_recovery_opp+t.def_safeties+t.def_punt_blocks+t.def_fg_blocks+t.def_pat_blocks)+6*(t.def_tds+t.special_teams_tds)+pa_points(allowed)
    t=t.sort_values(['kickoff','team']).reset_index(drop=True);team_features=[]
    for k in ['score','opp_score','team_fp','dst_fp']+['allowed_'+p for p in POS]:
        for span in [4,12]:
            key=f'{k}_e{span}';team_features.append(key);t[key]=lag_ewm(t,'team',k,span)
    t=t.merge(t[['game_id','team']+team_features].rename(columns={'team':'opponent',**{k:'opp_'+k for k in team_features}}),on=['game_id','opponent'],how='left')
    r=rosters.rename(columns={'gsis_id':'player_id','full_name':'name','position':'pos'})
    r=r.merge(t,on=['season','week','team'],how='inner',suffixes=('','_schedule')).drop_duplicates(['game_id','player_id'])
    metrics=['fpts','targets','carries','attempts','receptions','receiving_yards','rushing_yards','passing_yards','target_share','air_yards_share']
    r=r.merge(offensive[['game_id','player_id']+metrics].drop_duplicates(['game_id','player_id']),on=['game_id','player_id'],how='left')
    r['is_future']=r.kickoff>now
    for k in metrics:r.loc[~r.is_future,k]=r.loc[~r.is_future,k].fillna(0)
    r=r.merge(pd.concat(dep,ignore_index=True),on=['game_id','player_id'],how='left');r['depth']=r.depth.fillna(5).clip(1,6)
    r=r.sort_values(['kickoff','player_id']).reset_index(drop=True);history=[];volume=[]
    for k in metrics:
        for span in [4,12]:
            key=f'{k}_e{span}';r[key]=lag_ewm(r,'player_id',k,span).fillna(0)
            (history if k=='fpts' else volume).append(key)
    r['history_n']=r.groupby('player_id').cumcount().clip(upper=80)
    r['days_since']=(r.kickoff-r.groupby('player_id').kickoff.shift()).dt.total_seconds().div(86400).fillna(365).clip(0,730)
    r['age']=(r.kickoff.dt.tz_localize(None)-pd.to_datetime(r.birth_date,errors='coerce')).dt.days.div(365.25).fillna(25)
    r['years_exp']=pd.to_numeric(r.years_exp,errors='coerce').fillna(0)
    base=history+['history_n','days_since','week','age','years_exp'];role=base+volume+['depth','home']
    contextual=role+['score_e12','opp_opp_score_e12','team_fp_e12','opp_pos_allowed']
    for p in POS:r.loc[r.pos==p,'opp_pos_allowed']=r.loc[r.pos==p,'opp_allowed_'+p+'_e12']
    for k in contextual:r[k]=pd.to_numeric(r[k],errors='coerce').fillna(0)
    r['baseline']=r.fpts_e4;r.attrs['features']={'history':base,'opportunity_role':role,'opponent_context':contextual}
    return r,t,stats,calendar,future

def estimator():
    return HistGradientBoostingRegressor(max_iter=120,max_leaf_nodes=15,min_samples_leaf=45,l2_regularization=10,learning_rate=.055,early_stopping=False,random_state=SEED)

def metrics(y,p):
    y=np.asarray(y);p=np.asarray(p)
    return {'n':len(y),'mae':float(np.abs(y-p).mean()),'rmse':float(np.sqrt(np.mean((y-p)**2))),'bias':float(np.mean(p-y))}

def train(r,season):
    hist=r[~r.is_future].copy();current=r[r.is_future].copy();valyear=season-3;test_start=season-2
    reports={};oof=[];current['mean']=np.nan;feat=r.attrs['features']
    for pos in POS:
        q=hist[hist.pos==pos];tr=q[q.season<valyear];va=q[q.season==valyear];te=q[q.season>=test_start]
        if min(len(tr),len(va),len(te))<50:raise ValueError('Insufficient training partitions for '+pos)
        trials={'recent_history_baseline':metrics(va.fpts,va.baseline)}
        for name,cols in feat.items():
            m=estimator().fit(tr[cols],tr.fpts);trials[name]=metrics(va.fpts,np.maximum(0,m.predict(va[cols])))
        choice=min(trials,key=lambda k:trials[k]['rmse']);tr2=q[q.season<test_start]
        if choice=='recent_history_baseline':tp=te.baseline.to_numpy();prod=None
        else:
            cols=feat[choice];frozen=estimator().fit(tr2[cols],tr2.fpts);tp=np.maximum(0,frozen.predict(te[cols]));prod=estimator().fit(q[cols],q.fpts)
        ix=current.pos==pos;current.loc[ix,'mean']=current.loc[ix,'baseline'] if prod is None else np.maximum(0,prod.predict(current.loc[ix,feat[choice]]))
        te=te.copy();te['pred']=tp;te['residual']=te.fpts-te.pred;oof.append(te)
        rg=np.random.default_rng(SEED);keys=te[['season','week']].astype(str).agg('-'.join,axis=1);blocks=[np.flatnonzero(keys.values==w) for w in keys.unique()];gains=[]
        for _ in range(300):
            idx=np.concatenate([blocks[j] for j in rg.integers(0,len(blocks),len(blocks))]);a=te.fpts.values[idx]
            gains.append(float(np.sqrt(np.mean((a-te.baseline.values[idx])**2))-np.sqrt(np.mean((a-tp[idx])**2))))
        reports[pos]={'selected':choice,'selection_season':valyear,'validation':trials,'training_rows':len(tr2),'untouched_evaluation_seasons':sorted(te.season.unique()),'holdout':metrics(te.fpts,tp),'baseline':metrics(te.fpts,te.baseline),'rmse_gain_week_block_bootstrap95':np.quantile(gains,[.025,.975]),'by_year':{str(y):metrics(te[te.season==y].fpts,te[te.season==y].pred) for y in te.season.unique()},'production_training_rows':len(q)}
        print('TRAINED',pos,choice,reports[pos]['holdout'],flush=True)
    return current,pd.concat(oof,ignore_index=True),reports

def salary_pool(future,now):
    groups=json.loads((CACHE/'dk_groups.json').read_text()).get('draftGroups',[]);lobby=json.loads((CACHE/'dk_lobby.json').read_text()).get('Contests',[]);valid=[]
    for g in groups:
        ct=g.get('contestType',{});games=g.get('games',[])
        if ct.get('sport')!='NFL' or ct.get('contestTypeId')!=21:continue
        starts=[pd.Timestamp(x['startDate']) for x in games]
        if len(starts)<3 or min(starts)<=now:continue
        local=[x.tz_convert('America/New_York') for x in starts]
        if any(x.dayofweek!=6 or not 13<=x.hour<=16 or x.strftime('%Y-%m-%d')!=future.gameday.min() for x in local):continue
        associated=[c for c in lobby if str(c.get('dg'))==str(g['draftGroupId']) and c.get('gameType')=='Classic' and 'millionaire' in c.get('n','').lower() and 'sat' not in c.get('n','').lower()]
        if associated:valid.append((len(games),g,associated))
    if not valid:raise ValueError('No official upcoming Sunday Classic Millionaire draft group')
    _,g,contests=max(valid,key=lambda x:x[0]);gid=g['draftGroupId'];p=CACHE/f'dk_pool_{gid}.json'
    if not p.exists():raise ValueError(f'Official draft group {gid} not downloaded')
    raw=json.loads(p.read_text())['draftables'];by={}
    for x in raw:
        if x.get('rosterSlotId')==70 or x.get('position') not in POS+['DST'] or not x.get('salary'):continue
        uid=str(x['playerId']);comp=x.get('competition') or {};team=TEAM_MAP.get(x['teamAbbreviation'],x['teamAbbreviation'])
        sides=[TEAM_MAP.get(t,t) for t in comp.get('name','').replace(' ','').split('@')];game='@'.join(sides)
        if len(sides)!=2 or team not in sides:continue
        row={'id':str(x['draftableId']),'source_player_id':uid,'name':x['displayName'],'pos':x['position'],'salary':int(x['salary']),'team':team,'opponent':next(t for t in sides if t!=team),'game':game,'start':comp['startTime'],'status':x.get('status','None'),'disabled':bool(x.get('isDisabled'))}
        if uid in by and by[uid]!=row:raise ValueError('Conflicting salary/identity rows')
        by[uid]=row
    pool=pd.DataFrame(by.values())
    if len(pool)<100 or pool.id.duplicated().any():raise ValueError('Invalid official player universe')
    manifest={'draft_group_id':gid,'fetched_at':next((x['retrieved_at'] for x in json.loads((PUBLIC/'source-audit.json').read_text())['sources'] if x['name']==f'dk_pool_{gid}' and x['ok']),now.isoformat()),'source':'DraftKings public draftables API','raw_slot_rows':len(raw),'unique_players':len(pool),'games':pool.game.nunique(),'contests':[{'id':c['id'],'name':c['n'],'entry_fee':c.get('a'),'capacity':c.get('m'),'entries_observed':c.get('nt'),'max_entries_per_person':c.get('mec')} for c in contests]}
    return pool,manifest

def map_forecasts(pool,current,t,future):
    identities={};players=read('players');roster=read('roster_current');depth=read('depth_'+str(int(future.season.iloc[0])))
    for table,col in [(roster,'full_name'),(players,'display_name'),(depth,'player_name')]:
        if table.empty:continue
        for x in table[['gsis_id',col]].dropna().drop_duplicates().itertuples(index=False,name=None):identities.setdefault(norm(x[1]),set()).add(x[0])
    by=current.set_index(['player_id','team']);out=[];excluded=[]
    for p in pool.to_dict('records'):
        if p['disabled'] or p['status'] in ['OUT','IR','O','INACTIVE','SUSP','PUP']:
            excluded.append({'name':p['name'],'reason':'DraftKings status '+p['status']});continue
        if p['pos']=='DST':
            tr=t[(t.team==p['team'])&t.game_id.isin(future.game_id)]
            if tr.empty:continue
            row=tr.iloc[0];p.update(player_id='DST-'+p['team'],mean=float(max(0,row.dst_fp_e12)),depth=1,history_n=50)
        else:
            ids=identities.get(norm(p['name']),set());found=[x for x in ids if (x,p['team']) in by.index]
            if len(found)!=1:excluded.append({'name':p['name'],'reason':'No unique active roster identity for this team'});continue
            row=by.loc[(found[0],p['team'])]
            if isinstance(row,pd.DataFrame):raise ValueError('Duplicate current forecast identity')
            if row['pos']!=p['pos']:excluded.append({'name':p['name'],'reason':'Position disagreement'});continue
            if (p['pos']=='QB' and row.depth!=1) or row.depth>=5:
                excluded.append({'name':p['name'],'reason':'No supported current depth-chart role'});continue
            p.update(player_id=found[0],mean=float(row['mean']),depth=int(row.depth),history_n=int(row.history_n))
        p['mean']=round(p['mean'],3);out.append(p)
    f=pd.DataFrame(out).sort_values(['pos','team','mean'],ascending=[True,True,False]).reset_index(drop=True)
    expected=set(future.home_team)|set(future.away_team)
    counts=f[f.pos=='QB'].groupby('team').size().to_dict()
    if any(counts.get(team,0)!=1 for team in expected):raise ValueError('Exactly one supported starting QB per slate team is required')
    if len(f[f.pos=='DST'])!=len(expected):raise ValueError('Incomplete defense universe')
    return f,excluded
