"""Contest discovery and release identity shared by the weekly planner and the model run.
Standard library only, so the scheduling job can use it without installing the model runtime.
"""
from __future__ import annotations
import datetime as dt,json,pathlib,re,urllib.request,zoneinfo
LOBBY_URL='https://www.draftkings.com/lobby/getcontests?sport=1'
# DraftKings' edge rejects the bare token "Milly-research/1.0"; an identifying
# agent with a contact URL is accepted on the same public endpoints.
USER_AGENT='Milly-research/1.0 (+https://github.com/lestercrafton/dumbai)'
HEADERS={'User-Agent':USER_AGENT,'Accept':'application/json, text/csv;q=0.9, */*;q=0.8'}
EASTERN=zoneinfo.ZoneInfo('America/New_York')
EXCLUDED=('satellite','supersat','qualifier','showdown','madden')

class PoolNotPosted(RuntimeError):
 """A qualifying contest is listed but DraftKings has not published its player pool."""
 def __init__(self,contest,message):super().__init__(message);self.contest=contest

def fetch_json(url,timeout=55):
 with urllib.request.urlopen(urllib.request.Request(url,headers=HEADERS),timeout=timeout) as r:return json.loads(r.read())

def start_time(c):
 m=re.search(r'\d+',str(c.get('sd','')))
 return dt.datetime.fromtimestamp(int(m[0])/1000,dt.timezone.utc) if m else None

def millionaire_options(lobby,now):
 """Future Sunday Classic Millionaire contests within nine days, cheapest and largest first."""
 options=[]
 for c in lobby.get('Contests',[]):
  name=c.get('n','').lower()
  if 'millionaire' not in name or c.get('gameType')!='Classic' or any(w in name for w in EXCLUDED):continue
  at=start_time(c)
  if at is not None and (not now<at<now+dt.timedelta(days=9) or at.astimezone(EASTERN).weekday()!=6):continue
  options.append(c)
 return sorted(options,key=lambda x:(float(x.get('a',999)),-int(x.get('m',0))))

def summary(c):
 at=start_time(c)
 return {'id':c.get('id'),'name':c.get('n'),'draft_group':c.get('dg'),'listed_start':at.isoformat() if at else None}

def releases(pub):
 """Every published release in this pipeline: the current one plus the immutable archive."""
 pub=pathlib.Path(pub);found=[]
 for path in [pub/'latest.json',*sorted((pub/'archive').glob('*.json'))]:
  try:found.append(json.loads(path.read_text()))
  except (OSError,ValueError):continue
 return found

def release_for(pub,options):
 """The existing release for one of these contests' draft groups, if any."""
 groups={str(c.get('dg')) for c in options}
 for r in releases(pub):
  if str((r.get('contest') or {}).get('draft_group')) in groups:return r
 return None

def previous_release(pub):
 """Explicitly dated description of the last successful release; never presented as refreshed."""
 path=pathlib.Path(pub)/'latest.json'
 try:r=json.loads(path.read_text())
 except (OSError,ValueError):
  return {'release_id':None,'note':'No earlier release from this pipeline has been published.'}
 c=r.get('contest') or {}
 return {'release_id':r.get('release_id'),'generated_at':r.get('generated_at'),'contest':c.get('name'),'kickoff':c.get('kickoff'),'is_current':False,
  'note':f"Last successful release was generated {r.get('generated_at')} for the slate starting {c.get('kickoff')}. This run did not refresh it."}
