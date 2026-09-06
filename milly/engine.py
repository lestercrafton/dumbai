"""Milly's learned joint-score model and equal-opportunity lineup search.
Empirical residual copula, not a drive simulator. Opponents are a synthetic
benchmark, never a claimed model of actual Millionaire ownership.
"""
from __future__ import annotations
import datetime as dt,json
import numpy as np
import pandas as pd
from scipy.optimize import milp,Bounds,LinearConstraint
from scipy.special import ndtr,ndtri
from scipy.stats import rankdata
from sklearn.covariance import LedoitWolf
from sklearn.linear_model import LinearRegression
from forecast import ROOT,POSITIONS,BLOCKED,read,norm,team,score
ROLE_MAX={'QB':1,'RB':3,'WR':4,'TE':3,'DST':1,'SCORE':1}
ROLES=[p+str(i) for p,k in ROLE_MAX.items() for i in range(1,k+1)]
KEYS=[side+':'+r for side in ['H','A'] for r in ROLES]

def eligibility(pool):
    p=pool.copy();reasons=[]
    dep=read('depth_'+str(pd.Timestamp.now().year),False)
    if dep.empty or 'dt' not in dep:raise ValueError('Timestamped current depth charts unavailable; starting QBs cannot be verified')
    dep['when']=pd.to_datetime(dep.dt,utc=True,errors='coerce');now=pd.Timestamp.now(tz='UTC')
    dep=dep[dep.when<=now].copy();last=dep.groupby('team').when.transform('max');dep=dep[dep.when==last]
    age=(now-dep.when.max()).total_seconds()/3600
    if age>72:raise ValueError('Depth-chart snapshot older than 72 hours')
    starters={(team(r.team),norm(r.player_name)) for r in dep.itertuples() if str(r.pos_abb)=='QB' and int(r.pos_rank)==1}
    depthnames={(team(r.team),norm(r.player_name)) for r in dep.itertuples() if str(r.pos_abb) in ['QB','RB','FB','WR','TE']}
    for r in p.itertuples():
        why=[]
        if pd.isna(r.mu) or pd.isna(r.player_id):why.append('no independently matched forecast')
        if str(r.status).upper() in BLOCKED or r.disabled:why.append('official pool unavailable')
        if r.position!='DST' and str(r.roster_status).upper() not in ['ACT','ACTIVE']:why.append('not active current roster')
        if r.position=='QB' and (r.team,norm(r.name)) not in starters:why.append('not listed starting QB')
        if r.position!='DST' and (r.team,norm(r.name)) not in depthnames:why.append('not on latest offensive depth chart')
        reasons.append('; '.join(why))
    p['exclusion_reason']=reasons
    selected=p[p.exclusion_reason==''].copy().sort_values(['position','team','id']).reset_index(drop=True)
    selected['role_rank']=selected.groupby(['game_id','team','position']).mu.rank(method='first',ascending=False).astype(int)
    for pos,count in {'QB':1,'RB':3,'WR':4,'TE':2,'DST':1}.items():
        if sum(selected.position==pos)<count:raise ValueError('Insufficient eligible '+pos)
    return selected,{'official_pool':len(p),'modeled_eligible':len(selected),'excluded':p[p.exclusion_reason!=''][['name','team','position','exclusion_reason']].to_dict('records'),'depth_snapshot':str(dep.when.max()),'depth_age_hours':round(age,2),'uncertain_statuses':selected[~selected.status.str.upper().isin(['NONE','','ACTIVE'])][['name','status']].to_dict('records')}

def dependence(calibration,teamcal):
    c=calibration.copy();c['side']=np.where(c.home==1,'H','A')
    c['rank']=c.groupby(['game_id','team','position']).mu.rank(method='first',ascending=False).astype(int)
    c=c[c['rank']<=c.position.map(ROLE_MAX)].copy();c['role']=c.position+c['rank'].astype(str)
    s=teamcal.copy();s['side']=np.where(s.home==1,'H','A');s['role']='SCORE1';s['position']='SCORE'
    c=pd.concat([c[['game_id','side','role','position','residual']],s[['game_id','side','role','position','residual']]],ignore_index=True)
    c['z']=c.groupby('role').residual.transform(lambda v:ndtri((rankdata(v,method='average')-.5)/len(v)))
    c['key']=c.side+':'+c.role
    pivot=c.pivot_table(index='game_id',columns='key',values='z',aggfunc='first').reindex(columns=KEYS).fillna(0)
    lw=LedoitWolf().fit(pivot);cov=lw.covariance_;sd=np.sqrt(np.diag(cov));corr=cov/np.outer(sd,sd);corr=np.nan_to_num(corr)
    np.fill_diagonal(corr,1);L=np.linalg.cholesky(corr+np.eye(len(KEYS))*1e-6)
    return L,{'calibration_games':len(pivot),'shrinkage':float(lw.shrinkage_),'minimum_eigenvalue':float(np.linalg.eigvalsh(corr).min()),'roles':KEYS,'correlation':corr.round(4).tolist(),'type':'Empirical residual Gaussian copula, 2024 out-of-sample residuals; not exact football-event conservation'}

def marginal(mu,residual_quantiles,floor):
    q=np.maximum(mu+np.asarray(residual_quantiles),floor);neg=np.minimum(q,0);pos=np.maximum(q,0)
    if pos.mean()>0:pos*=max(0,(mu-neg.mean())/pos.mean())
    return neg+pos

def simulate(p,teams,teamcal,report,L,n,seed):
    rng=np.random.default_rng(seed);scores=np.zeros((n,len(p)),dtype=np.float32);games=[];game_scores=[]
    grid=np.linspace(.001,.999,101);tr=teamcal.residual.to_numpy();tr=tr-tr.mean();tq=np.quantile(tr,grid)
    for gid,a in p.groupby('game_id',sort=True):
        z=rng.normal(size=(n,len(KEYS)))@L.T;u=ndtr(z)
        parts=gid.split('_');away,home=parts[-2:];games.append({'game_id':gid,'away':away,'home':home,'matchup':away+'@'+home});gs=[]
        for side,tm in [('A',away),('H',home)]:
            row=teams[(teams.game_id==gid)&(teams.team==tm)]
            if len(row)!=1:raise ValueError('Missing team score model')
            mu=float(row.iloc[0].mu);v=np.interp(u[:,KEYS.index(side+':SCORE1')],grid,marginal(mu,tq,0));gs.append(np.round(v).astype(int))
        game_scores.append(np.column_stack(gs))
        for idx,r in a.iterrows():
            rank=int(r.role_rank);side='H' if r.team==home else 'A';key=side+':'+r.position+str(rank)
            ui=u[:,KEYS.index(key)] if key in KEYS else rng.random(n)
            q=report['residuals'][r.resid_key]['quantiles'];floor=-4 if r.position=='DST' else -3
            scores[:,idx]=np.interp(ui,grid,marginal(float(r.mu),q,floor))
    return np.round(scores,2),games,np.stack(game_scores,axis=1)

def constraints(p,flex):
    counts={'QB':1,'RB':2,'WR':3,'TE':1,'DST':1};counts[flex]+=1
    A=[(p.position==pos).to_numpy(float) for pos in POSITIONS];lo=[counts[x] for x in POSITIONS];hi=lo.copy()
    A.append(p.salary.to_numpy(float));lo.append(0);hi.append(50000)
    for game in p.game_id.unique():A.append((p.game_id==game).to_numpy(float));lo.append(0);hi.append(8)
    return LinearConstraint(np.asarray(A),np.asarray(lo),np.asarray(hi))

def solve(p,value,flex):
    result=milp(-np.asarray(value,float),integrality=np.ones(len(p)),bounds=Bounds(np.zeros(len(p)),np.ones(len(p))),constraints=constraints(p,flex),options={'time_limit':2.,'mip_rel_gap':.001})
    if result.x is None:return None
    ids=tuple(np.flatnonzero(result.x>.5).tolist())
    if len(ids)!=9 or p.iloc[list(ids)].salary.sum()>50000:return None
    return ids

def search(p,worlds,per_flex=160,seed=71):
    rng=np.random.default_rng(seed);rows=[];types=[];seen=set();mu=p.mu.to_numpy();sd=np.maximum(worlds.std(axis=0),1)
    for flex in ['RB','WR','TE']:
        n=0;attempts=0
        while n<per_flex and attempts<per_flex*8:
            draw=worlds[rng.integers(len(worlds))];blend=rng.uniform(.20,.85)
            value=(1-blend)*mu+blend*draw+rng.normal(0,.18,len(p))*sd
            ids=solve(p,value,flex);attempts+=1
            if ids and ids not in seen:seen.add(ids);rows.append(ids);types.append(flex);n+=1
        if n<per_flex:raise ValueError('Balanced search did not reach quota for '+flex)
    return np.array(rows,dtype=int),types

def lineup_scores(worlds,rows):
    out=np.empty((len(worlds),len(rows)),dtype=np.float32)
    for j,row in enumerate(rows):out[:,j]=worlds[:,row].sum(axis=1)
    return np.round(out,2)

def rank_scores(scores,field_scores):
    best=field_scores.max(axis=1);ties=(field_scores==best[:,None]).sum(axis=1)
    share=(scores>best[:,None]).astype(float)+(scores==best[:,None])/(ties[:,None]+1)
    return share.mean(axis=0),share.std(axis=0)/np.sqrt(len(scores)),best,share

def format_players(p,row,flex):
    slots=[]
    for pos,n in [('QB',1),('RB',2),('WR',3),('TE',1),('DST',1)]:
        ix=[int(j) for j in row if p.iloc[j].position==pos];ix.sort(key=lambda j:p.iloc[j]['start']);base=ix[:n]
        slots.extend([(pos if n==1 else pos+str(k+1),j) for k,j in enumerate(base)])
        if len(ix)>n:slots.append(('FLEX',ix[-1]))
    order=['QB','RB1','RB2','WR1','WR2','WR3','TE','FLEX','DST'];slots.sort(key=lambda x:order.index(x[0]))
    return [{'slot':slot,**{k:(float(r[k]) if k=='mu' else int(r[k]) if k=='salary' else str(r[k])) for k in ['id','player_id','name','position','team','opp','game_id','start','salary','mu','status']}} for slot,j in slots for _,r in p.iloc[[j]].iterrows()]

def generate(pool,teams,calibration,teamcal,report,contest,source):
    p,quality=eligibility(pool);print('Search eligibility',len(p),p.position.value_counts().to_dict(),flush=True)
    L,dep=dependence(calibration,teamcal)
    selection,games,sg=simulate(p,teams,teamcal,report,L,8192,20401);evaluation,_,eg=simulate(p,teams,teamcal,report,L,8192,20402)
    rows,types=search(p,selection,160,301);field,_=search(p,selection,180,907)
    a=lineup_scores(selection,rows);b=lineup_scores(evaluation,rows);fs=lineup_scores(selection,field);fe=lineup_scores(evaluation,field)
    rank,se,_,_=rank_scores(a,fs);hold,hse,best,shares=rank_scores(b,fe);order=np.argsort(-(rank-.20*se),kind='stable')[:20]
    now=dt.datetime.now(dt.timezone.utc);rid=f"{games[0]['game_id'].split('_')[0]}-w{games[0]['game_id'].split('_')[1]}-"+now.strftime('%Y%m%dT%H%M%SZ');lineups=[]
    for k,j in enumerate(order):
        row=rows[j];players=format_players(p,row,types[j]);wins=np.flatnonzero(shares[:,j]>0);witness=None
        if len(wins):
            w=int(wins[np.argsort(b[wins,j])[len(wins)//2]])
            witness={'world_id':w,'lineup_score':float(b[w,j]),'benchmark_best':float(best[w]),'player_scores':[{'name':p.iloc[int(i)]['name'],'points':float(evaluation[w,int(i)])} for i in row],'games':[dict(g,away_score=int(eg[w,z,0]),home_score=int(eg[w,z,1])) for z,g in enumerate(games)],'kind':'Statistical joint-score draw; not a reconciled play-by-play simulation'}
        tm=p.iloc[list(row)].groupby('team').size().sort_values(ascending=False);top=tm.index[0]
        lineups.append({'rank':k+1,'candidate_index':int(j),'salary':int(p.iloc[list(row)].salary.sum()),'flex':types[j],'model_mean':round(float(evaluation[:,row].sum(axis=1).mean()),2),'selection_benchmark_share':round(float(rank[j]),6),'holdout_benchmark_share':round(float(hold[j]),6),'holdout_standard_error':round(float(hse[j]),6),'players':players,'winning_world':witness,'explanation':f"This construction emphasizes {top} ({int(tm.iloc[0])} players). It needs production to reach these specific roles, not merely a correct game winner. The displayed outcome is sampled from successful held-out worlds, not invented after selection.",'failure_modes':['A correct game winner does not guarantee the selected players get the scoring.','Availability, role changes and extreme-tail misspecification can invalidate the forecast.','Beating this synthetic benchmark does not establish the chance of beating the actual Millionaire Maker field.']})
    assert len(lineups)==20 and len({tuple(sorted(x['id'] for x in q['players'])) for q in lineups})==20
    for q in lineups:assert sum(x['salary'] for x in q['players'])==q['salary']<=50000
    flexaudit={f:{'searched':types.count(f),'selected_top_twenty':sum(q['flex']==f for q in lineups),'best_selection_share':float(rank[np.array(types)==f].max()),'same_candidate_holdout_share':float(hold[np.flatnonzero(np.array(types)==f)[np.argmax(rank[np.array(types)==f])]])} for f in ['RB','WR','TE']}
    report_small={k:v for k,v in report.items() if k not in ['residuals','features']}
    release={'release_id':rid,'created_at':now.isoformat(),'expires_at':str(pd.to_datetime(p.start,utc=True).min()),'status':'research_not_entry_ready','summary':'Twenty independently forecast, salary-legal research lineups. No analyst forecast inputs. Real-world tournament edge is not established.','contest':{'id':contest['id'],'name':contest['n'],'draft_group':contest['dg'],'entry_fee':contest.get('a'),'max_entries':contest.get('m')},'salary_source':source,'model':report_small,'quality':quality,'dependence':dep,'experiments':{'selection_worlds':8192,'evaluation_worlds':8192,'candidates':len(rows),'benchmark_entries':len(field),'top20_holdout_overlap':len(set(order)&set(np.argsort(-hold)[:20])),'flex_audit':flexaudit},'lineups':lineups,'limits':['No real historical full-contest standings or ownership calibration.','Weekly roster history is retrospective, not authenticated point-in-time availability.','DST points-allowed scoring is approximate.','Scenario correlation is learned, but play totals are not conserved in this statistical model.','No live payments, contest entry or guaranteed returns.']}
    small=np.concatenate([selection[:1024],evaluation[:1024]]);benchmark=np.concatenate([fs[:1024].max(axis=1),fe[:1024].max(axis=1)])
    world={'release_id':rid,'created_at':now.isoformat(),'expires_at':release['expires_at'],'players':p[['id','player_id','name','position','salary','team','opp','game_id','mu','status','start']].to_dict('records'),'candidates':rows.tolist(),'flex_types':types,'scores_cents':np.rint(small*100).astype(int).tolist(),'benchmark_cents':np.rint(benchmark*100).astype(int).tolist(),'games':games,'game_scores':np.concatenate([sg[:1024],eg[:1024]]).tolist(),'selection_count':1024,'limits':release['limits']}
    (ROOT/'cache'/'eligible_projections.csv').write_text(p.to_csv(index=False))
    return release,world

def over_under(t,stats):
    s=stats[stats.position.isin(POSITIONS[:-1])].copy();s['fp']=score(s);s=s.groupby('game_id').fp.sum()
    g=t[t.home==1].drop_duplicates('game_id').copy();g['fp']=g.game_id.map(s);g['ou']=pd.to_numeric(g.total_line,errors='coerce');g['date']=pd.to_datetime(g.gameday)
    g=g[(g.season>=2020)&(g.season<=2025)&(g.date.dt.dayofweek==6)&(g.gametime>='13:00')&(g.gametime<='16:30')&g.ou.notna()&g.fp.notna()]
    rows=[]
    for (y,w),a in g.groupby(['season','week']):
        if len(a)<3:continue
        total=float(a.fp.sum());two=float(a.fp.nlargest(2).sum());rows.append({'season':int(y),'week':int(w),'games':len(a),'ou':float(a.ou.sum()),'ou_mean':float(a.ou.mean()),'fp':total,'fp_mean':float(a.fp.mean()),'top2_normalized':two/total*len(a)/2,'ou_dispersion':float(a.ou.std())})
    d=pd.DataFrame(rows)
    if len(d)<50:return {'status':'insufficient_data','slates':len(d)}
    a=d[d.season<=2023];b=d[d.season>=2024];m=LinearRegression().fit(a[['ou_mean']],a.fp_mean);yp=m.predict(b[['ou_mean']]);base=np.repeat(a.fp_mean.mean(),len(b));controls=pd.get_dummies(d[['season','games']],columns=['season'],dtype=float)
    residual=lambda key:d[key]-LinearRegression().fit(controls,d[key]).predict(controls)
    cutoff=float(a.ou_mean.quantile(.25));low=b[b.ou_mean<=cutoff];other=b[b.ou_mean>cutoff]
    return {'status':'historical_observational_test_completed','slates':len(d),'games':len(g),'target':'All QB/RB/WR/TE DK scoring, excluding DST; reconstructed Sunday afternoon slates, not authenticated DK pools','raw_sum_correlation':float(d.ou.corr(d.fp)),'per_game_correlation':float(d.ou_mean.corr(d.fp_mean)),'partial_correlation_controlling_count_and_season':float(residual('ou').corr(residual('fp'))),'holdout':{'train':'2020–2023','test':'2024–2025','n':len(b),'linear_mae':float(np.mean(abs(b.fp_mean-yp))),'constant_baseline_mae':float(np.mean(abs(b.fp_mean-base))),'training_low_quartile_threshold':cutoff,'low_n':len(low),'other_n':len(other),'low_top2_normalized':float(low.top2_normalized.mean()),'other_top2_normalized':float(other.top2_normalized.mean())},'pre_registered_followup':'Test concentration of salary-legal optimal and entered lineups when archived salary pools and full fields are available. Do not infer winning roster shape from aggregate game production.','limits':['Market line snapshot times are not authenticated pre-lock.','Game count and season are controlled; observational association is not a causal advantage.','No claim of winning lineup shape or profitable historical performance.'],'slate_rows':rows}
