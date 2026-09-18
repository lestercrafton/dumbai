"""Optional appearance-level enrichment; actual starters are retrospective, never pregame claims."""
from collections import defaultdict
from datetime import date,timedelta
import argparse,json
from pathlib import Path
from collect import Cache,atomic_json,jsonl,now,numeric,read_rows,source,url,write_games
KEEP=('gamesStarted','outs','inningsPitched','numberOfPitches','pitchesThrown','battersFaced','runs','earnedRuns','hits','homeRuns','baseOnBalls','strikeOuts','hitBatsmen','inheritedRunners','inheritedRunnersScored','strikes','balls')
def record(pk,tid,pid,name,stat,meta,origin):
 r={'gamePk':pk,'teamId':tid,'playerId':pid,'name':name,'role':'starter' if stat.get('gamesStarted')==1 else 'reliever' if stat.get('gamesStarted')==0 else None,'historicalKnownPregame':False,'observationType':'retrospective-final-appearance','origin':origin,**source(meta)}
 for key in KEEP:r[key]=stat.get(key) if key=='inningsPitched' else numeric(stat.get(key))
 return r

def collect_pitchers(cache,data,rows,seasons,start=None,end=None,max_fallback=200):
 allrows={r['gamePk']:r for r in rows};targets={k:r for k,r in allrows.items() if r['season'] in seasons and (not start or r['date']>=start) and (not end or r['date']<=end)}
 appearances={(r['gamePk'],r['teamId'],r['playerId']):r for r in read_rows(data/'pitcher-appearances.jsonl')};conflicts=[]
 for season in seasons:
  tids=sorted({r[s+'Id'] for r in targets.values() if r['season']==season for s in ('home','away')})
  for tid in tids:
   hydrate=f'person(stats(type=gameLog,group=pitching,season={season},gameType=R'+(f',startDate={start},endDate={end}' if start and end else '')+'))'
   roster,meta=cache.get(url(f'/teams/{tid}/roster',rosterType='fullSeason',season=season,hydrate=hydrate))
   for member in roster.get('roster',[]):
    person=member['person']
    for block in person.get('stats',[]):
     if block.get('group',{}).get('displayName')!='pitching':continue
     for split in block.get('splits',[]):
      pk=split.get('game',{}).get('gamePk');team=split.get('team',{}).get('id')
      if pk not in targets or team not in (targets[pk]['homeId'],targets[pk]['awayId']):continue
      if split.get('sport',{}).get('id',1)!=1:continue
      r=record(pk,team,person['id'],person['fullName'],split['stat'],meta,'full-season-roster-person-gameLog');key=(pk,team,person['id'])
      old=appearances.get(key)
      if old and any(old.get(k)!=r.get(k) for k in KEEP if k not in ('pitchesThrown','balls')):conflicts.append({'key':key,'note':'New current historical response differs; all raw snapshots retained.'})
      appearances[key]=r
   jsonl(data/'pitcher-appearances.jsonl',sorted(appearances.values(),key=lambda r:(r['gamePk'],r['teamId'],r['playerId'])))
  print(f'PITCHER LOGS season {season}: {len(appearances)} cumulative appearances',flush=True)
 def by_team():
  groups=defaultdict(list)
  for r in appearances.values():groups[(r['gamePk'],r['teamId'])].append(r)
  return groups
 grouped=by_team();fallback=[]
 for pk,g in targets.items():
  for side in ('home','away'):
   team=grouped[(pk,g[side+'Id'])];outs=[x.get('outs') for x in team];starters=[x for x in team if x['gamesStarted']==1]
   if not team or len(starters)!=1 or any(x is None for x in outs) or sum(outs)!=g.get(side+'_pitching_outs'):fallback.append(pk);break
 fallback=sorted(set(fallback));attempted=[]
 for pk in fallback[:max_fallback]:
  box,meta=cache.get(url(f'/game/{pk}/boxscore'));attempted.append(pk)
  # A complete official box score supersedes only normalized appearance rows for this game.
  parsed=[]
  for side,t in box.get('teams',{}).items():
   tid=t['team']['id']
   for pid in t.get('pitchers',[]):
    player=t['players'].get('ID'+str(pid),{});stat=player.get('stats',{}).get('pitching',{})
    if stat:parsed.append(record(pk,tid,pid,player['person']['fullName'],stat,meta,'official-final-boxscore'))
  if parsed:
   for key in [key for key in appearances if key[0]==pk]:del appearances[key]
   for r in parsed:appearances[(r['gamePk'],r['teamId'],r['playerId'])]=r
 grouped=by_team();incomplete=[]
 for pk,g in targets.items():
  for side in ('home','away'):
   team=grouped[(pk,g[side+'Id'])];starters=[r for r in team if r['gamesStarted']==1];relief=[r for r in team if r['gamesStarted']==0]
   complete=bool(team) and len(starters)==1 and all(r['outs'] is not None and r['gamesStarted'] in (0,1) for r in team) and sum(r['outs'] for r in team)==g.get(side+'_pitching_outs')
   g[side+'_pitcher_appearances_complete']=complete;g[side+'_actual_starter_known_pregame']=False
   g[side+'_actual_starter_id']=starters[0]['playerId'] if len(starters)==1 else None
   g[side+'_actual_starter_name']=starters[0]['name'] if len(starters)==1 else None
   g[side+'_starter_outs']=starters[0]['outs'] if complete else None
   g[side+'_starter_pitches']=starters[0]['numberOfPitches'] if complete else None
   g[side+'_bullpen_outs']=sum(r['outs'] for r in relief) if complete else None
   g[side+'_bullpen_pitches']=sum(r['numberOfPitches'] for r in relief) if complete and all(r['numberOfPitches'] is not None for r in relief) else None
   g[side+'_reliever_count']=len(relief) if complete else None
   g[side+'_pitcher_sources']=sorted({r['sourceSha256'] for r in team})
   if not complete:incomplete.append({'gamePk':pk,'side':side,'appearances':len(team),'starters':len(starters)})
 jsonl(data/'pitcher-appearances.jsonl',sorted(appearances.values(),key=lambda r:(r['gamePk'],r['teamId'],r['playerId'])))
 write_games(data,allrows)
 audit={'completedAt':now(),'targetGames':len(targets),'pitcherAppearances':len(appearances),'completeTeamGames':2*len(targets)-len(incomplete),'incompleteTeamGames':incomplete,'fallbackBoxscoresRequested':len(attempted),'fallbackLimit':max_fallback,'fallbackNeeded':len(fallback),'revisedAppearanceWarnings':conflicts,'leakagePolicy':'Actual starters and workload are final observed game outcomes. Use only for completed past-game features, not the target-game starter unless separate dated pregame snapshot exists.'}
 atomic_json(data/'pitcher-validation.json',audit);return audit

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--data-dir',type=Path,default=Path(__file__).resolve().parent/'data');ap.add_argument('--seasons',default='2024,2025,2026');ap.add_argument('--start');ap.add_argument('--end');ap.add_argument('--interval',type=float,default=.5);ap.add_argument('--max-fallback',type=int,default=200);a=ap.parse_args();cache=Cache(a.data_dir/'cache',a.interval);audit=collect_pitchers(cache,a.data_dir,read_rows(a.data_dir/'games.jsonl'),list(map(int,a.seasons.split(','))),a.start,a.end,a.max_fallback);atomic_json(a.data_dir/'pitcher-manifest.json',{'completedAt':now(),'sources':cache.used,'audit':audit});print(json.dumps({k:v for k,v in audit.items() if k not in ('incompleteTeamGames','revisedAppearanceWarnings')}));return 0 if not audit['incompleteTeamGames'] else 2
if __name__=='__main__':raise SystemExit(main())
