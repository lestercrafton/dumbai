"""Release checks are software tests, not evidence of a betting edge."""
import numpy as np,pandas as pd
from core import legal,points,SLOTS,slots

def verify(d,w):
 checks=[]
 def check(name,ok):
  if not bool(ok):raise AssertionError(name)
  checks.append(name)
 ps=d['players'];ls=d['lineups'];check('Twenty complete lineups',len(ls)==20);check('All twenty unique',len({tuple(sorted(x['ids'])) for x in ls})==20)
 for l in ls:
  check('Roster legality '+str(l['rank']),legal(l['ids'],ps));check('Salary arithmetic '+str(l['rank']),sum(ps[i]['salary'] for i in l['ids'])==l['salary']);check('Slot assignment '+str(l['rank']),all(slot=='FLEX' and ps[i]['position'] in ['RB','WR','TE'] or slot==ps[i]['position'] for slot,i in zip(SLOTS,l['ids'])));a=l['witness'];check('Same-world score arithmetic '+str(l['rank']),abs(sum(a['player_points'])-a['lineup_points'])<.1);check('Honest witness label '+str(l['rank']),a['won']==bool(a['lineup_points']>a['reference_best']+.005))
 check('Future kickoff at publication',pd.Timestamp(d['generated_at'])<pd.Timestamp(d['contest']['kickoff']));check('World and baseline version match',d['release_id']==w['release_id']);check('No imported expert point predictions',not d['validation']['analyst_projections_used']);check('No user beliefs in baseline',not d['validation']['user_beliefs_used']);check('Salary only constrains lineups',not d['validation']['salary_used_as_forecast_feature']);check('FLEX search effort equal',len(set(d['diagnostics']['solver_effort'].values()))==1)
 check('No known unavailable players',all(p['status'].upper() not in ['O','OUT','IR','INACTIVE','D','DOUBTFUL','SUSPENDED'] for p in ps));teams={g['home'] for g in d['games']}|{g['away'] for g in d['games']};check('Every team has one supported starting QB',all(sum(p['team']==t and p['position']=='QB' for p in ps)==1 for t in teams));check('All team defenses present',all(sum(p['team']==t and p['position']=='DST' for p in ps)==1 for t in teams));check('All candidate rosters legal',all(legal(ids,ps) for ids in w['candidates']));check('Duplicate players rejected',not legal([0]*9,ps))
 check('Passing scoring and bonus',points(pd.DataFrame([{'passing_yards':300,'passing_tds':3,'passing_interceptions':1}])).iloc[0]==26);check('PPR and receiving bonus',points(pd.DataFrame([{'receptions':8,'receiving_yards':100,'receiving_tds':1}])).iloc[0]==27);check('Lost fumble negative',points(pd.DataFrame([{'rushing_fumbles_lost':2}])).iloc[0]==-2)
 a=pd.Series([3.,9.,15.]);b=a.copy();b.iloc[2]=9000;lag=lambda x:x.shift().ewm(span=4,adjust=False).mean();check('Current outcome cannot change its own lag feature',lag(a).iloc[2]==lag(b).iloc[2]);check('Selection/evaluation arrays separate',w['selection']['points'] is not w['evaluation']['points']);check('Model input allowlist excludes outcomes',not set(d['validation']['features'])&{'points','salary','total_line','expert_projection','user_belief','ownership'});check('Real historical hypothesis sample',d['hypothesis']['slates']>=80)
 for pos in ['QB','RB','WR','TE']:
  report=d['validation'][pos];check(pos+' chronological validation precedes tests',all(int(y)>report['validation_season'] for y in report['tests']));check(pos+' nontrivial training sample',report['training_rows']>1000);check(pos+' finite learned forecasts',all(np.isfinite(p['mu']) and p['scale']>0 for p in ps if p['position']==pos))
 return {'passed':True,'count':len(checks),'checks':checks,'scope':'Executable data/model/roster invariants. No claim of live-browser verification or betting profitability.'}
