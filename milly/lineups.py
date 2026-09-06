"""Historical game-block residual worlds and position-neutral salary optimization.
Statistical scenarios, not exact play-by-play. Reference entries are not observed MM ownership.
"""
from collections import Counter
import numpy as np
import pandas as pd
from scipy.optimize import milp,LinearConstraint,Bounds
from model import POS,SEED,estimator,metrics
SLOTS=['QB','RB','RB','WR','WR','WR','TE','FLEX','DST']

def team_models(t,season):
    h=t[t.score.notna()].copy();future=t[t.score.isna()].copy();val=season-3;hold=season-2
    cols=['score_e4','score_e12','opp_score_e12_x','opp_opp_score_e12','dst_fp_e4','dst_fp_e12','opp_team_fp_e12','home','week']
    h[cols]=h[cols].fillna(0);future[cols]=future[cols].fillna(0);evaluation=h[h.season>=hold].copy();report={}
    for target,base in [('score',.5*(h.score_e12+h.opp_opp_score_e12)),('dst_fp',h.dst_fp_e12)]:
        h['base']=base.fillna(0);tr=h[h.season<val];va=h[h.season==val]
        fitted=estimator().fit(tr[cols],tr[target]);vp=fitted.predict(va[cols]);use=metrics(va[target],vp)['rmse']<metrics(va[target],va.base)['rmse']
        if use:
            m=estimator().fit(h[h.season<hold][cols],h[h.season<hold][target]);ep=m.predict(evaluation[cols]);prod=estimator().fit(h[cols],h[target]);cp=prod.predict(future[cols])
        else:
            ep=h.loc[evaluation.index,'base'].values;cp=.5*(future.score_e12+future.opp_opp_score_e12) if target=='score' else future.dst_fp_e12
        evaluation[target+'_pred']=np.maximum(0,ep);future[target+'_pred']=np.maximum(0,cp)
        report[target]={'selected':'learned_context' if use else 'historical_baseline','validation_season':val,'holdout':metrics(evaluation[target],ep),'baseline':metrics(evaluation[target],h.loc[evaluation.index,'base'])}
    return future,evaluation,report

def game_templates(oof,te):
    role=oof.copy();role['rank']=role.groupby(['game_id','team','pos']).pred.rank(method='first',ascending=False).astype(int)
    role['z']=(role.fpts-role.pred)/np.sqrt(role.pred.clip(lower=0)+3)
    lookup={(x.game_id,x.team,x.pos,x.rank):float(x.z) for x in role.itertuples()}
    fallback={p:role[role.pos==p].z.to_numpy() for p in POS};templates=[]
    for game,q in te.groupby('game_id',sort=True):
        if len(q)!=2:continue
        sides=[]
        for home in [0,1]:
            x=q[q.home==home].iloc[0]
            sides.append({'score_residual':float(x.score-x.score_pred),'dst_z':float((x.dst_fp-x.dst_fp_pred)/np.sqrt(max(0,x.dst_fp_pred)+3)),'z':{f'{p}{k}':lookup.get((game,x.team,p,k)) for p in POS for k in range(1,10)}})
        templates.append({'id':game,'sides':sides,'total':float(q.score_pred.sum())})
    if len(templates)<100:raise ValueError('Insufficient paired historical game templates')
    return templates,fallback

def simulate(f,games,templates,fallback,n,seed):
    rng=np.random.default_rng(seed);points=np.zeros((n,len(f)),dtype=np.float32);scores=np.zeros((n,len(games),2),dtype=np.int16)
    rank=f.groupby(['team','pos'])['mean'].rank(method='first',ascending=False).astype(int)
    for gi,g in enumerate(games):
        chosen=rng.integers(0,len(templates),n)
        for side,team in enumerate([g['away'],g['home']]):
            sr=np.array([templates[j]['sides'][side]['score_residual'] for j in chosen])
            scores[:,gi,side]=np.maximum(0,np.rint(g['means'][side]+sr)).astype(np.int16)
            for i in f.index[f.team==team]:
                p=f.loc[i];key=f'{p.pos}{rank[i]}'
                if p.pos=='DST':z=np.array([templates[j]['sides'][side]['dst_z'] for j in chosen])
                else:
                    z=np.array([templates[j]['sides'][side]['z'].get(key,np.nan) for j in chosen],dtype=float)
                    missing=~np.isfinite(z);z[missing]=rng.choice(fallback[p.pos],int(missing.sum()))
                lo=-4 if p.pos=='DST' else -3 if p.pos=='QB' else 0
                raw=np.maximum(lo,p['mean']+np.sqrt(p['mean']+3)*z);denom=float(raw.mean()-lo)
                points[:,i]=lo+(raw-lo)*(p['mean']-lo)/denom if denom>1e-8 else p['mean']
    return np.round(points,2),scores

def validate(ids,f):
    if len(ids)!=9 or len(set(ids))!=9:return False
    q=f.loc[list(ids)];c=Counter(q.pos)
    return bool(q.salary.sum()<=50000 and q.game.nunique()>=2 and c['QB']==1 and c['DST']==1 and 2<=c['RB']<=3 and 3<=c['WR']<=4 and 1<=c['TE']<=2 and c['RB']+c['WR']+c['TE']==7)

def assign_slots(ids,f):
    rest=list(ids);counts=Counter(f.loc[rest].pos)
    options=[i for i in rest if f.loc[i,'pos'] in POS[1:] and counts[f.loc[i,'pos']]>{'RB':2,'WR':3,'TE':1}[f.loc[i,'pos']]]
    flex=max(options,key=lambda i:(f.loc[i,'start'],f.loc[i,'id']));rest.remove(flex);out=[]
    for slot in SLOTS:
        if slot=='FLEX':out.append(flex);continue
        i=next(i for i in rest if f.loc[i,'pos']==slot);rest.remove(i);out.append(i)
    return out

def solve(f,values,flex=None):
    values=np.asarray(values,float)
    if values.shape!=(len(f),) or not np.isfinite(values).all():raise ValueError('Invalid optimization objective')
    n=len(f);rows=[np.ones(n),f.salary.values/100];lo=[9,0];hi=[9,500]
    for p,a,b in [('QB',1,1),('DST',1,1),('RB',2,3),('WR',3,4),('TE',1,2)]:
        if flex and p in ['RB','WR','TE']:a=b={'RB':2,'WR':3,'TE':1}[p]+int(flex==p)
        rows.append((f.pos==p).astype(float).values);lo.append(a);hi.append(b)
    for game in f.game.unique():rows.append((f.game==game).astype(float).values);lo.append(0);hi.append(8)
    result=milp(-values,integrality=np.ones(n),bounds=Bounds(np.zeros(n),np.ones(n)),constraints=LinearConstraint(np.array(rows),lo,hi),options={'time_limit':5.,'mip_rel_gap':.001})
    if result.x is None:raise ValueError('Salary/position constraints have no feasible lineup')
    ids=tuple(np.flatnonzero(result.x>.5))
    if not validate(ids,f):raise ValueError('Solver returned invalid roster')
    return ids,{'optimal':result.status==0,'gap':float(getattr(result,'mip_gap',0))}

def candidates(f,worlds,per_flex=140,seed=SEED):
    rng=np.random.default_rng(seed);out=[];info=[];counts={}
    for flex in ['RB','WR','TE']:
        seen=set();attempts=0
        while len(seen)<per_flex and attempts<per_flex*8:
            v=f['mean'].values if attempts==0 else .25*f['mean'].values+.75*worlds[rng.integers(0,len(worlds),rng.integers(1,7))].mean(axis=0)
            ids,receipt=solve(f,v,flex);attempts+=1
            if ids not in seen:seen.add(ids);out.append(ids);info.append(receipt)
        counts[flex]={'unique':len(seen),'attempts':attempts}
    return np.array(out,dtype=int),{'by_flex':counts,'solver_calls':sum(x['attempts'] for x in counts.values()),'max_reported_gap':max(x['gap'] for x in info),'all_feasible':True}

def lineup_scores(points,lineups):return np.stack([points[:,ids].sum(axis=1) for ids in lineups],axis=1)

def summary(f,ids,points,scores,games,refmax,rank,selection=None):
    order=assign_slots(ids,f);x=points[:,order].sum(axis=1);win=x>refmax+.005;ties=np.abs(x-refmax)<=.005;chosen=np.flatnonzero(win);example=None
    if len(chosen):
        margins=x[chosen]-refmax[chosen];j=int(chosen[np.argmin(np.abs(margins-np.median(margins)))])
        example={'world':j,'lineup_points':float(x[j]),'reference_best':float(refmax[j]),'players':[{**{k:f.loc[i,k] for k in ['id','name','pos','team']},'slot':slot,'points':float(points[j,i])} for i,slot in zip(order,SLOTS)],'games':[{'game':g['id'],'away':int(scores[j,k,0]),'home':int(scores[j,k,1])} for k,g in enumerate(games)]}
    primary=Counter(f.loc[list(ids)].game).most_common(2)
    return {'rank':rank,'ids':[f.loc[i,'id'] for i in order],'indices':order,'salary':int(f.loc[order].salary.sum()),'mean':float(f.loc[order,'mean'].sum()),'p90':float(np.quantile(x,.90)),'reference_win_rate':float(win.mean()),'reference_tie_rate':float(ties.mean()),'worlds_evaluated':len(x),'selection_reference_win_rate':selection,'flex':f.loc[order[7],'pos'],'game_concentration':dict(primary),'questionable':[f.loc[i,'name'] for i in order if f.loc[i,'status']=='Q'],'newcomers':[f.loc[i,'name'] for i in order if f.loc[i,'history_n']==0],'explanation':f"Its largest game commitments are {primary[0][0]} ({primary[0][1]} roster spots) and {primary[1][0]} ({primary[1][1]}). The example below is one held-out statistical world, not a forecast of that score. Correct game winners alone do not guarantee the fantasy production reaches these players.",'winning_world':example}

def build_lineups(f,oof,t,season,per_flex=140,n=8192):
    ft,te,team_report=team_models(t,season);ft=ft.set_index('team');f=f.copy()
    for i,p in f[f.pos=='DST'].iterrows():f.loc[i,'mean']=round(float(ft.loc[p.team,'dst_fp_pred']),3)
    games=[]
    for game in sorted(f.game.unique()):
        away,home=game.split('@');games.append({'id':game,'away':away,'home':home,'means':[float(ft.loc[away,'score_pred']),float(ft.loc[home,'score_pred'])]})
    templates,fallback=game_templates(oof,te)
    train,ts=simulate(f,games,templates,fallback,n,SEED);test,vs=simulate(f,games,templates,fallback,n,SEED+1)
    bank,search=candidates(f,train,per_flex);print('CANDIDATES',len(bank),flush=True)
    refpoints,_=simulate(f,games,templates,fallback,1024,SEED+88);refs,refsearch=candidates(f,refpoints,50,SEED+89)
    tr=lineup_scores(train,refs).max(axis=1);vr=lineup_scores(test,refs).max(axis=1)
    train_scores=lineup_scores(train,bank);test_scores=lineup_scores(test,bank)
    rate=(train_scores>tr[:,None]+.005).mean(axis=0);se=np.sqrt(rate*(1-rate)/n)
    order=np.lexsort((-train_scores.mean(axis=0),-(rate-.35*se)))[:20]
    vrate=(test_scores>vr[:,None]+.005).mean(axis=0);vorder=np.argsort(-vrate)[:20]
    selected=[summary(f,bank[j],test,vs,games,vr,k+1,float(rate[j])) for k,j in enumerate(order)];flexaudit={}
    for pos in ['RB','WR','TE']:
        ix=np.array([j for j,ids in enumerate(bank) if Counter(f.loc[list(ids)].pos)[pos]=={'RB':3,'WR':4,'TE':2}[pos]])
        best=ix[np.argmax(rate[ix])]
        flexaudit[pos]={'candidates':len(ix),'selected_in_twenty':sum(x['flex']==pos for x in selected),'highest_mean':float(max(f.loc[list(bank[j]),'mean'].sum() for j in ix)),'selection_best_holdout_reference_win_rate':float(vrate[best])}
    audit={'candidate_count':len(bank),'reference_entries':len(refs),'selection_worlds':n,'evaluation_worlds':n,'historical_game_blocks':len(templates),'top_twenty_holdout_overlap':len(set(order)&set(vorder)),'flex':flexaudit,'search':search,'reference_search':refsearch,'team_models':team_report,'forecast_mean_alignment_max_error':float(np.max(np.abs(test.mean(axis=0)-f['mean'].values))),'reference_model':'independently sampled strong-model benchmark; not real field ownership or actual contest win probability'}
    web={'players':f.to_dict('records'),'games':games,'candidates':bank.tolist(),'selection':{'points':np.rint(train[:1024]*10).astype(int).tolist(),'scores':ts[:1024].tolist(),'reference':np.rint(tr[:1024]*10).astype(int).tolist()},'evaluation':{'points':np.rint(test[:1024]*10).astype(int).tolist(),'scores':vs[:1024].tolist(),'reference':np.rint(vr[:1024]*10).astype(int).tolist()},'point_scale':10,'model':'historical-game-residual-v1'}
    return selected,audit,web,f
