"""Executed historical hypothesis tests, explicitly distinct from contest backtests."""
import numpy as np,pandas as pd
from sklearn.linear_model import LinearRegression
from model import POS,metrics

def corr(a,b):
    a=np.asarray(a,float);b=np.asarray(b,float);ok=np.isfinite(a)&np.isfinite(b)
    return float(np.corrcoef(a[ok],b[ok])[0,1]) if ok.sum()>3 else None

def run_research(stats,calendar,season,oof):
    games=calendar[(calendar.season>=season-6)&(calendar.weekday=='Sunday')&(calendar.gametime>='13:00')&(calendar.gametime<='16:30')&calendar.home_score.notna()&calendar.total_line.notna()].copy()
    fp=stats[stats.position.isin(POS)].groupby('game_id').fpts.sum();games['fpts']=games.game_id.map(fp);games=games.dropna(subset=['fpts']);rows=[]
    for (y,w),g in games.groupby(['season','week']):
        if len(g)<3:continue
        rows.append({'season':int(y),'week':int(w),'games':len(g),'sum_ou':float(g.total_line.sum()),'mean_ou':float(g.total_line.mean()),'dispersion_ou':float(g.total_line.std()),'sum_fpts':float(g.fpts.sum()),'mean_fpts':float(g.fpts.mean()),'nfl_points':float((g.home_score+g.away_score).sum()),'normalized_top2':float(g.fpts.nlargest(2).sum()/g.fpts.sum()*len(g)/2)})
    r=pd.DataFrame(rows);train=r[r.season<season-2];test=r[r.season>=season-2]
    fit=LinearRegression().fit(train[['mean_ou']],train.mean_fpts);pred=fit.predict(test[['mean_ou']]);constant=np.repeat(train.mean_fpts.mean(),len(test))
    controls=pd.concat([r[['games']],pd.get_dummies(r.season,prefix='season',dtype=float)],axis=1)
    ra=r.sum_ou-LinearRegression().fit(controls,r.sum_ou).predict(controls);rb=r.sum_fpts-LinearRegression().fit(controls,r.sum_fpts).predict(controls)
    threshold=float(train.mean_ou.quantile(.25));low=test[test.mean_ou<=threshold];high=test[test.mean_ou>threshold]
    delta=float(low.normalized_top2.mean()-high.normalized_top2.mean());rg=np.random.default_rng(78503);dist=[]
    if len(low)>2 and len(high)>2:
        for _ in range(2000):dist.append(float(rg.choice(low.normalized_top2,len(low)).mean()-rg.choice(high.normalized_top2,len(high)).mean()))
    subgroup={}
    for p in POS:
        a=oof[oof.pos==p];subgroup[p]={}
        for label,q in [('all_active',a),('depth_one',a[a.depth==1]),('week_one',a[a.week==1])]:
            if len(q):subgroup[p][label]={'model':metrics(q.fpts,q.pred),'baseline':metrics(q.fpts,q.baseline)}
    return {'definition':'Sunday regular-season games, 13:00–16:30 Eastern, >=3 games; reconstructed, not authenticated historical DK draft groups.','seasons':sorted(r.season.unique().tolist()),'slates':len(r),'games':len(games),'raw_total_correlation':corr(r.sum_ou,r.sum_fpts),'per_game_correlation':corr(r.mean_ou,r.mean_fpts),'partial_correlation_game_count_and_season':corr(ra,rb),'holdout':{'train_years':sorted(train.season.unique().tolist()),'test_years':sorted(test.season.unique().tolist()),'mean_ou_model':metrics(test.mean_fpts,pred),'constant_baseline':metrics(test.mean_fpts,constant),'low_ou_cutoff':threshold,'low_n':len(low),'other_n':len(high),'low_top2_normalized':low.normalized_top2.mean(),'other_top2_normalized':high.normalized_top2.mean(),'difference':delta,'difference_bootstrap95':np.quantile(dist,[.025,.975]) if dist else None},'forecast_subgroups':subgroup,'limitations':['Odds snapshots are historical totals with unverified pre-lock publication time; not a tradable forecast backtest.','Game concentration measures all core offensive fantasy production, NOT a salary-constrained winning roster.','No complete historical Millionaire contest fields, ownership or salaries in this test.','Bootstrap on slates is descriptive; residual dependence may make uncertainty larger.','Neither the market total nor user beliefs are production player forecast features.'],'rows':rows}
