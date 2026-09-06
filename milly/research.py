"""Registered slate hypotheses and paired week-block forecast diagnostics."""
import numpy as np,pandas as pd

def correlation(a,b):return float(np.corrcoef(a,b)[0,1]) if len(a)>2 and np.std(a)>0 and np.std(b)>0 else None

def slate_hypothesis(games,stats):
 g=games[(games.season.between(2020,2025))&games.game_type.eq('REG')&games.weekday.eq('Sunday')&games.gametime.between('13:00','16:30')&games.total_line.notna()&games.home_score.notna()].copy()
 fp=stats[stats.position.isin(['QB','RB','WR','TE'])].groupby('game_id').dk.sum();g['fp']=g.game_id.map(fp);g=g.dropna(subset=['fp']);rows=[]
 for (year,week),s in g.groupby(['season','week']):
  if len(s)<3:continue
  rows.append({'season':int(year),'week':int(week),'games':len(s),'ou_sum':float(s.total_line.sum()),'ou_mean':float(s.total_line.mean()),'ou_std':float(s.total_line.std()),'fantasy_sum':float(s.fp.sum()),'fantasy_mean':float(s.fp.mean()),'realized_total_mean':float((s.home_score+s.away_score).mean()),'top2_share':float(s.fp.nlargest(2).sum()/s.fp.sum()),'top2_normalized':float(s.fp.nlargest(2).sum()/s.fp.sum()*len(s)/2)})
 d=pd.DataFrame(rows);train=d[d.season<=2023];test=d[d.season>=2024];coef=np.polyfit(train.ou_mean,train.fantasy_mean,1);pred=np.polyval(coef,test.ou_mean);mae=float(np.mean(abs(test.fantasy_mean-pred)));base=float(np.mean(abs(test.fantasy_mean-train.fantasy_mean.mean())))
 X=pd.get_dummies(d.season.astype(str),dtype=float);X['count']=d.games;X=np.array(X,float);residual=lambda y:np.array(y)-X@np.linalg.lstsq(X,y,rcond=None)[0]
 threshold=float(train.ou_mean.quantile(.25));low=test[test.ou_mean<=threshold];high=test[test.ou_mean>threshold];r=correlation(d.ou_mean,d.fantasy_mean);rng=np.random.default_rng(173);boot=[]
 for _ in range(1500):sample=d.iloc[rng.integers(len(d),size=len(d))];boot.append(correlation(sample.ou_mean,sample.fantasy_mean))
 return {'id':'SLATE-001','status':'historical-proxy-test-completed','slates':len(d),'games':len(g),'seasons':sorted(d.season.unique().tolist()),'raw_sum_correlation':correlation(d.ou_sum,d.fantasy_sum),'per_game_correlation':r,'per_game_95_bootstrap':np.quantile(boot,[.025,.975]).tolist(),'partial_game_count_season':correlation(residual(d.ou_sum),residual(d.fantasy_sum)),'holdout':{'train':'2020–2023','test':'2024–2025','n':len(test),'ou_model_mae':mae,'constant_baseline_mae':base,'improvement_percent':100*(base-mae)/base,'low_ou_threshold':threshold,'low_n':len(low),'other_n':len(high),'low_top2_normalized':float(low.top2_normalized.mean()),'other_top2_normalized':float(high.top2_normalized.mean())},'shape_correlations':{'pregame_mean_ou_vs_normalized_top2':correlation(d.ou_mean,d.top2_normalized),'realized_fp_vs_normalized_top2':correlation(d.fantasy_mean,d.top2_normalized),'pregame_total_dispersion_vs_normalized_top2':correlation(d.ou_std,d.top2_normalized)},'interpretation':'Total production and game concentration, not optimal roster shape or profitability. Bookmaker lines do not enter the baseline model.','limitations':['Historical bookmaker-line timestamps are not authenticated pre-lock snapshots.','Sunday time-window reconstruction is not a historical DraftKings draft-group archive.','No historical contest entry fields, salaries or ownership are present.','Bootstrap treats weeks as blocks but does not resolve season dependence.'],'rows':rows}

def forecast_diagnostics(oof,report):
 d=oof[oof.season.eq(oof.season.max())].copy();d['mse']=(d.dk-d.prediction)**2;d['bse']=(d.dk-d.baseline)**2;d['ae']=abs(d.dk-d.prediction);d['bae']=abs(d.dk-d.baseline);weekly=d.groupby('week').agg(mse=('mse','mean'),bse=('bse','mean'),ae=('ae','mean'),bae=('bae','mean'));rng=np.random.default_rng(4823);boots=[]
 for _ in range(2000):r=weekly.iloc[rng.integers(len(weekly),size=len(weekly))];boots.append(100*(np.sqrt(r.bse.mean())-np.sqrt(r.mse.mean()))/np.sqrt(r.bse.mean()))
 w=d[d.week==1];report['last_year_paired_week_bootstrap_rmse_lift_95']=np.quantile(boots,[.025,.975]).tolist();report['week_one_diagnostic']={'n':len(w),'model_mae':float(w.ae.mean()),'baseline_mae':float(w.bae.mean()),'model_rmse':float(np.sqrt(w.mse.mean())),'baseline_rmse':float(np.sqrt(w.bse.mean()))};return report
