"""Match an official salary game to the NFL schedule by team pair and date."""
import pandas as pd
TOLERANCE=pd.Timedelta(minutes=60)
def match_game(t,team,opp,start):
 """Return (schedule row, discrepancy or None). Raises on team, date or >60 min mismatch."""
 start=pd.Timestamp(start)
 if start.tzinfo is None:start=start.tz_localize('UTC')
 day=start.tz_convert('America/New_York').date()
 g=t[(t.team==team)&(t.opp==opp)]
 g=g[g.kick.dt.tz_convert('America/New_York').dt.date==day]
 if len(g)!=1:raise RuntimeError('Official salary game does not match NFL schedule')
 row=g.iloc[0].to_dict();gap=abs(row['kick']-start)
 if gap>TOLERANCE:raise RuntimeError('Official salary game does not match NFL schedule')
 if gap==pd.Timedelta(0):return row,None
 return row,{'game_id':row['game_id'],'schedule_kick':row['kick'].isoformat(),'salary_kick':start.isoformat(),'minutes':int(gap.total_seconds()//60),'note':f"{row['game_id']}: NFL schedule file lists kickoff {row['kick'].tz_convert('America/New_York'):%I:%M %p} ET; DraftKings lists {start.tz_convert('America/New_York'):%I:%M %p} ET. DraftKings time used."}
