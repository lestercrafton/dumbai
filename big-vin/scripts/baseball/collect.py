#!/usr/bin/env python3
"""Public MLB statistics collector. Python stdlib + curl; no keys or paid services."""
import argparse,csv,hashlib,json,os,subprocess,sys,tempfile,time
from datetime import date,datetime,timedelta,timezone
from pathlib import Path
from urllib.parse import urlencode
BASE='https://statsapi.mlb.com/api/v1'
GROUPS=('hitting','pitching','fielding')
GAME_TYPES=('R','F','D','L','W')
def now():return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
def atomic_json(p,obj):
 p.parent.mkdir(parents=True,exist_ok=True);tmp=p.with_suffix(p.suffix+'.tmp');tmp.write_text(json.dumps(obj,separators=(',',':'))+'\n');tmp.replace(p)
def jsonl(p,rows):
 p.parent.mkdir(parents=True,exist_ok=True);tmp=p.with_suffix(p.suffix+'.tmp')
 with tmp.open('w') as f:
  for r in rows:f.write(json.dumps(r,separators=(',',':'))+'\n')
 tmp.replace(p)
def read_rows(p):return [json.loads(x) for x in p.read_text().splitlines() if x] if p.exists() else []
def url(path,**params):return BASE+path+'?'+urlencode({k:v for k,v in params.items() if v is not None},safe=',()[]')
def numeric(x):
 if not isinstance(x,str):return x
 if x in ('','--','-.--','.---','---','N/A'):return None
 try:return int(x)
 except ValueError:
  try:return float(x)
  except ValueError:return x
class Cache:
 def __init__(self,root,interval,refresh=False):
  self.root=root;root.mkdir(parents=True,exist_ok=True);self.path=root/'index.json';self.index=json.loads(self.path.read_text()) if self.path.exists() else {};self.interval=interval;self.last=0;self.refresh=refresh;self.used=[]
 def get(self,u,force=False,max_age_seconds=None,format="json"):
  old=self.index.get(u)
  if old and max_age_seconds is not None:
   force=force or (datetime.now(timezone.utc)-datetime.fromisoformat(old['fetchedAt'].replace('Z','+00:00'))).total_seconds()>max_age_seconds
  if old and not force and not self.refresh and (self.root/old['file']).exists():
   body=(self.root/old['file']).read_bytes()
   if hashlib.sha256(body).hexdigest()!=old['sha256']:raise ValueError('Cache hash mismatch: '+u)
   self.used.append({**old,'cacheHit':True});return (json.loads(body) if format=="json" else body.decode("utf-8-sig")),old
  for attempt in range(4):
   time.sleep(max(0,self.interval-(time.monotonic()-self.last)));self.last=time.monotonic()
   fd,name=tempfile.mkstemp(dir=self.root,suffix='.download');os.close(fd)
   p=subprocess.run(['curl','--silent','--show-error','--location','--max-time','180','--connect-timeout','20','--user-agent','BigVin-public-data-research/1.0','--output',name,'--write-out','%{http_code}',u],capture_output=True,text=True)
   status=int(p.stdout[-3:]) if p.stdout[-3:].isdigit() else 0;body=Path(name).read_bytes();Path(name).unlink()
   if p.returncode==0 and status==200:
    data=json.loads(body) if format=='json' else body.decode('utf-8-sig');digest=hashlib.sha256(body).hexdigest();file='raw/'+digest+('.json' if format=='json' else '.csv');path=self.root/file;path.parent.mkdir(exist_ok=True)
    if not path.exists():path.write_bytes(body)
    meta={'url':u,'fetchedAt':now(),'sha256':digest,'bytes':len(body),'httpStatus':status,'file':file,'format':format}
    self.index[u]=meta;atomic_json(self.path,self.index);self.used.append({**meta,'cacheHit':False});print(f'GET {status} {len(body)} {u}',flush=True);return data,meta
   if status not in (0,408,429,500,502,503,504) or attempt==3:raise RuntimeError(f'HTTP {status}, curl {p.returncode}: {u}; {p.stderr[:150]}')
   time.sleep(2**attempt*2)
  raise RuntimeError('Unreachable')
def source(meta):return {'sourceUrl':meta['url'],'sourceFetchedAt':meta['fetchedAt'],'sourceSha256':meta['sha256']}
def gather_logs(cache,season,start,end,game_type):
 out={};offset=0;count=0
 while True:
  data,meta=cache.get(url('/teams/stats',stats='gameLog',group=','.join(GROUPS),season=season,sportIds=1,gameType=game_type,startDate=start,endDate=end,limit=10000,offset=offset))
  remaining=False
  for block in data.get('stats',[]):
   group=block.get('group',{}).get('displayName');splits=block.get('splits',[]);total=block.get('totalSplits',len(splits))
   if total>offset+len(splits):remaining=True
   for s in splits:
    if not s.get('game',{}).get('gamePk') or not s.get('team',{}).get('id'):continue
    key=(s['game']['gamePk'],s['team']['id']);out.setdefault(key,{})[group]={'stat':s['stat'],**source(meta)};count+=1
  if not remaining:break
  if not any(b.get('splits') for b in data.get('stats',[])):raise RuntimeError('Truncated empty stats page')
  offset+=10000
 return out

def schedule(cache,start,end,current=False):
 data,meta=cache.get(url('/schedule',sportId=1,startDate=start,endDate=end,gameTypes=','.join(GAME_TYPES),hydrate='team,probablePitcher,linescore,decisions,gameInfo,venue,weather'),max_age_seconds=1800 if current else None)
 return [g for d in data.get('dates',[]) for g in d.get('games',[])],meta

def normalize(g,meta,stats):
 if g.get('gameType') not in GAME_TYPES or g.get('status',{}).get('abstractGameState')!='Final' or 'cancel' in g.get('status',{}).get('detailedState','').lower():return None
 teams=g['teams'];home=teams['home'];away=teams['away']
 if not isinstance(home.get('score'),(int,float)) or not isinstance(away.get('score'),(int,float)):return None
 resume={k:v for k,v in g.items() if k.lower().startswith(('resume','resched'))}
 row={'schemaVersion':1,'gamePk':g['gamePk'],'season':int(g['season']),'gameType':g['gameType'],'date':g.get('officialDate',g['gameDate'][:10]),'officialDate':g.get('officialDate'),'startTime':g['gameDate'],'status':g['status']['detailedState'],'gameNumber':g.get('gameNumber'),'doubleHeader':g.get('doubleHeader'),'dayNight':g.get('dayNight'),'scheduledInnings':g.get('scheduledInnings'),'venueId':g.get('venue',{}).get('id'),'venueName':g.get('venue',{}).get('name'),'homeId':home['team']['id'],'awayId':away['team']['id'],'home':home['team']['name'],'away':away['team']['name'],'homeRuns':home['score'],'awayRuns':away['score'],'homeMargin':home['score']-away['score'],'resumeRescheduleFields':resume,'hasResumeOrRescheduleFlag':bool(resume),'weatherCondition':g.get('weather',{}).get('condition'),'weatherTempF':numeric(g.get('weather',{}).get('temp')),'weatherWind':g.get('weather',{}).get('wind'),'attendance':g.get('gameInfo',{}).get('attendance'),'actualFirstPitch':g.get('gameInfo',{}).get('firstPitch'),'gameDurationMinutes':g.get('gameInfo',{}).get('gameDurationMinutes'),'observationType':'retrospectively-fetched-final','historicalPregameSnapshot':False,'completionTimestampKnown':False,'featureTimingPolicy':'Use only prior completed games with full-day embargo; exclude resumed/suspended ambiguity. Target stats, final weather and final-response starters are not pregame predictors.','scheduleSourceUrl':meta['url'],'scheduleSourceFetchedAt':meta['fetchedAt'],'scheduleSourceSha256':meta['sha256']}
 for side in ('home','away'):
  t=teams[side];groups=stats.get((g['gamePk'],t['team']['id']),{})
  row[side+'_abbreviation']=t['team'].get('abbreviation');row[side+'_reported_probable_pitcher_id']=t.get('probablePitcher',{}).get('id');row[side+'_reported_probable_known_pregame']=False
  row[side+'_reported_probable_label']='Historical final response; not evidence of pregame announcement'
  for group in GROUPS:
   prefix=side+'_'+('batting' if group=='hitting' else group);item=groups.get(group)
   row[prefix+'_present']=item is not None
   if item:
    for k,v in item['stat'].items():row[prefix+'_'+k]=v if k in ('inningsPitched','innings') else numeric(v)
    for k in ('sourceUrl','sourceFetchedAt','sourceSha256'):row[prefix+'_'+k]=item[k]
  for k in ('hits','errors'):
   row[side+'_linescore_'+k]=g.get('linescore',{}).get('teams',{}).get(side,{}).get(k)
   if k=='errors':row[side+'Errors']=row[side+'_linescore_errors']
 return row

def write_games(path,rows):
 rows=sorted(rows.values(),key=lambda r:(r['startTime'],r['gamePk']));jsonl(path/'games.jsonl',rows)
 cols=sorted({k for r in rows for k in r});tmp=path/'games.csv.tmp'
 with tmp.open('w',newline='') as f:
  writer=csv.DictWriter(f,fieldnames=cols);writer.writeheader()
  for row in rows:writer.writerow({k:json.dumps(v,separators=(',',':')) if isinstance(v,(dict,list)) else v for k,v in row.items()})
 tmp.replace(path/'games.csv')
 return rows

def validate(rows):
 failures=[];missing=[];warnings=[];seen=set()
 for r in rows:
  if r['gamePk'] in seen:failures.append({'gamePk':r['gamePk'],'error':'duplicate gamePk'})
  seen.add(r['gamePk'])
  for side,opposite in [('home','away'),('away','home')]:
   for group in ('batting','pitching','fielding'):
    if not r[side+'_'+group+'_present']:missing.append({'gamePk':r['gamePk'],'side':side,'group':group})
   for field,expected in [(side+'_batting_runs',r[side+'Runs']),(side+'_pitching_runs',r[opposite+'Runs'])]:
    if field in r and r[field]!=expected:failures.append({'gamePk':r['gamePk'],'field':field,'value':r[field],'expected':expected})
   for field,expected in [(side+'_batting_hits',r.get(side+'_linescore_hits')),(side+'_fielding_errors',r.get(side+'_linescore_errors'))]:
    if expected is not None and field in r and r[field]!=expected:
     (warnings if 'fielding_errors' in field else failures).append({'gamePk':r['gamePk'],'field':field,'value':r[field],'expected':expected,'note':'Retain both source values; canonical game error count is schedule linescore. Do not silently reconcile.'})
 return {'games':len(rows),'dateMin':min((r['date'] for r in rows),default=None),'dateMax':max((r['date'] for r in rows),default=None),'bySeason':{str(y):sum(r['season']==y for r in rows) for y in sorted({r['season'] for r in rows})},'byGameType':{t:sum(r['gameType']==t for r in rows) for t in GAME_TYPES},'resumedOrRescheduled':sum(r['hasResumeOrRescheduleFlag'] for r in rows),'missingStatGroups':missing,'sourceDisagreementWarnings':warnings,'failures':failures,'status':'pass' if not failures and not missing else 'incomplete' if not failures else 'fail'}

def snapshot_current(cache,data,asof,future_days,team_ids,rosters=True):
 games,meta=schedule(cache,asof.isoformat(),(asof+timedelta(days=future_days)).isoformat(),current=True);rows=[]
 for g in games:
  for side in ('home','away'):
   p=g['teams'][side].get('probablePitcher',{});pregame=g['status']['abstractGameState']=='Preview' and datetime.fromisoformat(g['gameDate'].replace('Z','+00:00'))>datetime.fromisoformat(meta['fetchedAt'].replace('Z','+00:00'))
   rows.append({'gamePk':g['gamePk'],'gameDate':g['gameDate'],'officialDate':g.get('officialDate'),'side':side,'teamId':g['teams'][side]['team']['id'],'pitcherId':p.get('id'),'pitcherName':p.get('fullName'),'snapshotKnownPregame':pregame,'availabilityLabel':'probable, not confirmed starter' if pregame else 'not a pregame observation',**source(meta)})
 stamp=meta['fetchedAt'].replace(':','-');folder=data/'snapshots'/stamp;jsonl(folder/'probable-starters.jsonl',rows);counts={'probableRows':len(rows),'pregameProbableRows':sum(bool(r['pitcherId']) and r['snapshotKnownPregame'] for r in rows),'rosterRows':0,'playerSeasonRows':0}
 if rosters:
  rr=[]
  for tid in team_ids:
   roster,rm=cache.get(url(f'/teams/{tid}/roster',rosterType='active',date=asof.isoformat(),hydrate='person'))
   for r in roster.get('roster',[]):
    p=r['person'];rr.append({'teamId':tid,'playerId':p['id'],'name':p['fullName'],'position':r.get('position',{}).get('abbreviation'),'rosterStatus':r.get('status',{}).get('description'),'batSide':p.get('batSide',{}).get('code'),'pitchHand':p.get('pitchHand',{}).get('code'),'rosterType':'active','asOfRequested':asof.isoformat(),'currentSnapshotOnly':True,**source(rm)})
  jsonl(folder/'rosters.jsonl',rr);counts['rosterRows']=len(rr)
  season,sm=cache.get(url('/stats',stats='season',group='hitting,pitching,fielding',season=asof.year,sportIds=1,playerPool='ALL',limit=10000),max_age_seconds=21600)
  sr=[]
  for block in season.get('stats',[]):
   if block.get('totalSplits',len(block.get('splits',[])))>len(block.get('splits',[])):raise RuntimeError('Current player season stats truncated')
   for r in block.get('splits',[]):sr.append({'playerId':r.get('player',{}).get('id'),'name':r.get('player',{}).get('fullName'),'teamId':r.get('team',{}).get('id'),'group':block['group']['displayName'],'season':r.get('season'),'stats':r['stat'],'currentSnapshotOnly':True,'historicalPregameSafe':False,**source(sm)})
  jsonl(folder/'player-season-stats.jsonl',sr);counts['playerSeasonRows']=len(sr)
 atomic_json(folder/'counts.json',counts);return {'directory':str(folder),**counts}

def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--mode',choices=['history','daily'],default='daily');ap.add_argument('--seasons',default='2024,2025,2026');ap.add_argument('--as-of',default=date.today().isoformat());ap.add_argument('--lookback-days',type=int,default=7);ap.add_argument('--future-days',type=int,default=7);ap.add_argument('--data-dir',type=Path,default=Path(__file__).resolve().parent/'data');ap.add_argument('--interval',type=float,default=0.5);ap.add_argument('--refresh',action='store_true');ap.add_argument('--skip-current',action='store_true');ap.add_argument('--skip-rosters',action='store_true');ap.add_argument('--pitchers',action='store_true');ap.add_argument('--statcast-days',type=int,default=0);args=ap.parse_args()
 if not 0<=args.statcast_days<=7:ap.error('--statcast-days must be0..7 (bounded daily downloads)')
 data=args.data_dir;data.mkdir(parents=True,exist_ok=True);asof=date.fromisoformat(args.as_of);cache=Cache(data/'cache',args.interval,args.refresh);rows={r['gamePk']:r for r in read_rows(data/'games.jsonl')};team_ids=set();started=now()
 windows=[(year,date(year,1,1),min(date(year,12,31),asof-timedelta(days=1))) for year in map(int,args.seasons.split(','))] if args.mode=='history' else [(year,max(date(year,1,1),asof-timedelta(days=args.lookback_days)),min(date(year,12,31),asof-timedelta(days=1))) for year in sorted({(asof-timedelta(days=args.lookback_days)).year,(asof-timedelta(days=1)).year})]
 for year,start,end in windows:
  if end<start:continue
  games,meta=schedule(cache,start.isoformat(),end.isoformat());logs={}
  types={g['gameType'] for g in games if g.get('status',{}).get('abstractGameState')=='Final'}
  for gt in GAME_TYPES:
   if gt not in types:continue
   for key,groups in gather_logs(cache,year,start.isoformat(),end.isoformat(),gt).items():logs.setdefault(key,{}).update(groups)
  for g in games:
   for t in g['teams'].values():team_ids.add(t['team']['id'])
   row=normalize(g,meta,logs)
   if row:rows[row['gamePk']]={**rows.get(row['gamePk'],{}),**row}
  current=write_games(data,rows);atomic_json(data/'validation.json',validate(current));print(f'NORMALIZED {year}: {len(current)} cumulative games',flush=True)
 pitcher_audit=None
 if args.pitchers:
  from pitchers import collect_pitchers
  pitcher_audit=collect_pitchers(cache,data,list(rows.values()),[w[0] for w in windows],windows[0][1].isoformat() if args.mode=='daily' else None,windows[-1][2].isoformat() if args.mode=='daily' else None)
  rows={r['gamePk']:r for r in read_rows(data/'games.jsonl')}
 statcast=[]
 if args.statcast_days:
  from statcast import collect_statcast
  statcast=collect_statcast(cache,data,asof,args.statcast_days)
 snapshot=None
 if not args.skip_current:
  if len(team_ids)!=30:
   teams,_=cache.get(url('/teams',sportId=1,season=asof.year));team_ids={t['id'] for t in teams['teams']}
  snapshot=snapshot_current(cache,data,asof,args.future_days,sorted(team_ids),not args.skip_rosters)
 current=write_games(data,rows);validation=validate(current);atomic_json(data/'validation.json',validation)
 manifest={'schemaVersion':1,'startedAt':started,'completedAt':now(),'mode':args.mode,'asOf':args.as_of,'sources':cache.used,'validation':validation,'currentSnapshots':snapshot,'currentSnapshotDirectory':snapshot['directory'] if snapshot else None,'statcastDaily':statcast,'pitcherAudit':pitcher_audit,'summary':{'cumulativeGames':len(current),'dateMin':validation['dateMin'],'dateMax':validation['dateMax'],'seasons':validation['bySeason'],'sourceDisagreementWarningCount':len(validation['sourceDisagreementWarnings']),'currentSnapshots':snapshot,'pitcherGames':sum(bool(r.get('home_pitcher_appearances_complete')) and bool(r.get('away_pitcher_appearances_complete')) for r in current),'statcastDaily':statcast},'outputs':{p.name:{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in [data/'games.jsonl',data/'games.csv']},'leakagePolicy':'Historical final-response data are retrospective; use lagged past-game stats only. Current season aggregates/rosters/probables are snapshot-time observations for future use. No historical bookmaker prices collected.'}
 atomic_json(data/'manifests'/(started.replace(':','-')+'.json'),manifest);atomic_json(data/'latest-manifest.json',manifest);print(json.dumps({'status':validation['status'],'games':len(current),'missingGroups':len(validation['missingStatGroups']),'failures':len(validation['failures']),'manifest':str(data/'latest-manifest.json')}))
 return 0 if validation['status']=='pass' else 2
if __name__=='__main__':sys.exit(main())
