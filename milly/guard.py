"""Preflight: required fresh source receipts and completed-game coverage."""
import datetime as dt,json,pathlib
import pandas as pd
ROOT=pathlib.Path(__file__).resolve().parent

def run():
 audit=json.loads((ROOT/'public/source-audit.json').read_text());now=dt.datetime.now(dt.timezone.utc);year=int(audit['season']);sources={s['name']:s for s in audit['sources']}
 for name in ['schedule','roster_current','dk_lobby','depth_'+str(year),'stats_'+str(year-1),'rosters_'+str(year-1)]:
  s=sources.get(name,{})
  if not s.get('ok'):raise ValueError('Required source failed: '+name)
  if (now-dt.datetime.fromisoformat(s['retrieved_at'])).total_seconds()>6*3600:raise ValueError('Stale receipt: '+name)
 g=pd.read_csv(ROOT/'cache/schedule.csv.gz');cut=str((now-dt.timedelta(days=2)).date());expected=set(g[(g.game_type=='REG')&(g.season>=year-1)&(g.gameday<cut)&g.home_score.notna()].game_id)
 observed=set()
 for y in [year-1,year]:
  p=ROOT/f'cache/stats_{y}.csv.gz'
  if p.exists():observed.update(pd.read_csv(p,usecols=['game_id']).game_id)
 missing=expected-observed
 if missing:raise ValueError('Completed games missing from training input: '+', '.join(sorted(missing)[:10]))
 print('Required source freshness and completed-game coverage verified.')
if __name__=='__main__':run()
