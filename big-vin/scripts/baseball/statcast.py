"""Bounded daily official Savant CSV collection with conservative, explicit normalized fields."""
import csv,hashlib,io,json
from collections import defaultdict
from datetime import timedelta
from urllib.parse import urlencode
from collect import atomic_json,jsonl,numeric,source
SAFE_FIELDS=('game_pk','game_date','game_type','game_year','pitcher','batter','player_name','home_team','away_team','stand','p_throws','pitch_type','pitch_name','release_speed','release_spin_rate','release_extension','pfx_x','pfx_z','api_break_z_with_gravity','api_break_x_arm','arm_angle','events','description','type','inning','inning_topbot','at_bat_number','pitch_number','outs_when_up','balls','strikes','bb_type','launch_speed','launch_angle','hit_distance_sc','estimated_ba_using_speedangle','estimated_woba_using_speedangle','estimated_slg_using_speedangle','woba_value','woba_denom','bat_speed','swing_length','attack_angle')
def collect_statcast(cache,data,asof,days):
 if days>7:raise ValueError('Savant collection is bounded to7daily requests per run')
 reports=[]
 for n in reversed(range(1,days+1)):
  d=(asof-timedelta(days=n)).isoformat();u='https://baseballsavant.mlb.com/statcast_search/csv?'+urlencode({'all':'true','type':'details','game_date_gt':d,'game_date_lt':d,'hfGT':'R|'})
  text,meta=cache.get(u,format='csv');reader=csv.DictReader(io.StringIO(text))
  if not reader.fieldnames or 'game_pk' not in reader.fieldnames:raise RuntimeError('Savant returned unexpected CSV schema for '+d)
  rows=[];grouped=defaultdict(list)
  for raw in reader:
   if raw.get('game_date')!=d:raise RuntimeError('Savant date mismatch')
   r={k:numeric(raw.get(k)) for k in SAFE_FIELDS if k in raw};r.update({'sourceSha256':meta['sha256'],'sourceFetchedAt':meta['fetchedAt'],'historicalPregameSafe':False});rows.append(r)
   grouped[(r['game_pk'],r['home_team'] if r['inning_topbot']=='Bot' else r['away_team'])].append(r)
  agg=[]
  for (pk,team),rs in grouped.items():
   terminal=[r for r in rs if r.get('events')];x=[r['estimated_woba_using_speedangle'] for r in terminal if isinstance(r.get('estimated_woba_using_speedangle'),(int,float))];contact=[r['launch_speed'] for r in terminal if isinstance(r.get('launch_speed'),(int,float))]
   agg.append({'gamePk':pk,'date':d,'battingTeamAbbreviation':team,'pitchRows':len(rs),'terminalPlateAppearances':len(terminal),'xwobaSupportedTerminalPA':len(x),'xwobaSumOnSupportedTerminalPA':sum(x),'meanXwobaOnSupportedTerminalPA':sum(x)/len(x) if x else None,'trackedBattedBalls':len(contact),'hardHitCount95mph':sum(v>=95 for v in contact),'launchSpeedSum':sum(contact),'meanLaunchSpeed':sum(contact)/len(contact) if contact else None,'missingXwobaTerminalPA':len(terminal)-len(x),'historicalPregameSafe':False,**source(meta)})
  folder=data/'statcast'/d;jsonl(folder/'pitches.jsonl',rows);jsonl(folder/'team-game-contact.jsonl',agg)
  report={'date':d,'gameCount':len({r['game_pk'] for r in rows}),'pitchRows':len(rows),'terminalPA':sum(a['terminalPlateAppearances'] for a in agg),'xwobaSupportedTerminalPA':sum(a['xwobaSupportedTerminalPA'] for a in agg),'sourceUrl':u,'sourceFetchedAt':meta['fetchedAt'],'sourceSha256':meta['sha256'],'dataDirectory':str(folder),'gameTypes':'regular season only','excludedFutureFields':[f for f in reader.fieldnames if f.endswith('_days_until_next_game')],'excludedCoordinateFields':['plate_x','plate_z','sz_top','sz_bot'],'coordinateCaveat':'2026 plate and strike-zone definitions changed; raw values retained but omitted from normalized research fields.','publicationCaveat':'Current historical download does not prove these values were available before a historical forecast. Use prior-game lag and freeze future observations.'}
  atomic_json(folder/'manifest.json',report);reports.append(report)
 return reports
