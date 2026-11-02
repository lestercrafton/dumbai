import pandas as pd,numpy as np,collections
d=pd.read_csv('/workspace/ml/nfl-games.csv');d=d[(d.season>=2012)&d.result.notna()&d.spread_line.notna()].sort_values(['gameday','gametime']).reset_index(drop=True)
ew=collections.defaultdict(dict);lastqb={};A=0.15;ref=collections.defaultdict(lambda:[0.0,0.0,0])
def up(t,k,v,a=A):ew[t][k]=v if k not in ew[t] else ew[t][k]*(1-a)+v*a
rows=[]
for _,g in d.iterrows():
  h,a=g.home_team,g.away_team;r=dict(id=g.game_id,date=g.gameday,season=g.season,month=f"{g.season}-{int(g.week):02d}",y=g.result,tot=g.total,cS=-g.spread_line,oS=np.nan,cT=g.total_line,oT=np.nan,
    neutral=int(g.location=='Neutral'),div=int(g.div_game==1),post=int(g.game_type!='REG'),dome=int(g.roof in('dome','closed')),temp=g.temp,wind=g.wind,h_rest=g.home_rest,a_rest=g.away_rest,restDiff=g.home_rest-g.away_rest,
    h_qbchg=int(lastqb.get(h,g.home_qb_id)!=g.home_qb_id),a_qbchg=int(lastqb.get(a,g.away_qb_id)!=g.away_qb_id),week=g.week)
  for s,t in(('h',h),('a',a)):
    for k in('pf','pa','ats','ou','mar'):r[f'{s}_{k}']=ew[t].get(k,np.nan)
  rf=ref[g.referee];r['ref_m']=rf[0]/rf[2] if rf[2] else np.nan;r['ref_t']=rf[1]/rf[2] if rf[2] else np.nan
  rows.append(r)
  for t,pf,pa,sgn in((h,g.home_score,g.away_score,1),(a,g.away_score,g.home_score,-1)):
    up(t,'pf',pf);up(t,'pa',pa);up(t,'mar',pf-pa);up(t,'ats',sgn*(g.result-g.spread_line));up(t,'ou',g.total-g.total_line)
  lastqb[h]=g.home_qb_id;lastqb[a]=g.away_qb_id
  rf[0]+=g.result-g.spread_line;rf[1]+=g.total-g.total_line;rf[2]+=1
pd.DataFrame(rows).to_parquet('/workspace/ml/feat-nfl.parquet');print(len(rows))
