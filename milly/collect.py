"""Milly source collector. Public data only; no account automation or access circumvention."""
from __future__ import annotations
import concurrent.futures as cf, csv, datetime as dt, gzip, hashlib, io, json, os, pathlib, time, urllib.request
ROOT=pathlib.Path(__file__).resolve().parent
CACHE=ROOT/'cache'; PUBLIC=ROOT/'public'
CACHE.mkdir(exist_ok=True); PUBLIC.mkdir(exist_ok=True)
BASE='https://github.com/nflverse/nflverse-data/releases/download/'
NOW=dt.datetime.now(dt.timezone.utc)
SEASON=NOW.year if NOW.month>=3 else NOW.year-1

def fetch(name,url,required=False):
    out=CACHE/(name+('.json' if name.startswith('dk_') else '.csv.gz'))
    rec={'name':name,'url':url,'retrieved_at':NOW.isoformat(),'required':required}
    try:
        req=urllib.request.Request(url,headers={'User-Agent':'MillyResearch/0.4 public-data contact via repository'})
        with urllib.request.urlopen(req,timeout=35) as r: data=r.read(); rec['last_modified']=r.headers.get('Last-Modified')
        text=data.decode('utf-8-sig')
        if name.startswith('dk_'):
            obj=json.loads(text); out.write_text(text);rec['keys']=list(obj)[:20] if isinstance(obj,dict) else ['array']
        else:
            if ',' not in text.splitlines()[0] or text.lstrip().startswith('<'): raise ValueError('Not CSV')
            with gzip.open(out,'wt',encoding='utf-8') as f:f.write(text)
            rows=list(csv.DictReader(io.StringIO(text)))
            rec.update(rows=len(rows),columns=list(rows[0]) if rows else [],sample=rows[:1])
        rec.update(ok=True,bytes=len(data),sha256=hashlib.sha256(data).hexdigest(),path=str(out.relative_to(ROOT)))
    except Exception as e:rec.update(ok=False,error=str(e))
    return rec

def run():
    sources=[('schedule','https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv',True)]
    for y in range(SEASON-7,SEASON+1):
        for prefix,tag,filename in [('stats','stats_player',f'stats_player_week_{y}.csv'),('rosters','weekly_rosters',f'roster_weekly_{y}.csv'),('depth','depth_charts',f'depth_charts_{y}.csv')]:
            sources.append((f'{prefix}_{y}',BASE+tag+'/'+filename,y<SEASON and prefix=='stats'))
    sources.extend([('roster_current',BASE+f'rosters/roster_{SEASON}.csv',False),('injuries_current',BASE+f'injuries/injuries_{SEASON}.csv',False),('players',BASE+'players/players.csv',False),('dk_groups','https://api.draftkings.com/draftgroups/v1/',False),('dk_lobby','https://www.draftkings.com/lobby/getcontests?sport=NFL',False)])
    with cf.ThreadPoolExecutor(max_workers=6) as pool:records=list(pool.map(lambda x:fetch(*x),sources))
    # Discover only real NFL Sunday classic groups, never Madden/single-game or past slates.
    try:
        obj=json.loads((CACHE/'dk_lobby.json').read_text()); contests=obj.get('Contests',obj.get('contests',[]))
        choices=[c for c in contests if any(s in str(c.get('n',c.get('name',''))).lower() for s in ['millionaire','milly']) and not any(s in str(c).lower() for s in ['madden','showdown'])]
        for cid in sorted({str(c.get('dg',c.get('draftGroupId',''))) for c in choices})[:8]:
            if cid.isdigit():records.append(fetch('dk_pool_'+cid,f'https://api.draftkings.com/draftgroups/v1/draftgroups/{cid}/draftables'))
        (PUBLIC/'contest-discovery.json').write_text(json.dumps({'found':len(choices),'contests':choices[:20]},indent=2))
    except Exception as e:(PUBLIC/'contest-discovery.json').write_text(json.dumps({'found':0,'error':str(e)}))
    # A dated development snapshot is never silently carried into another week.
    records.append(fetch('salary_2026_09_13','https://raw.githubusercontent.com/relomy/learn-dfs-lessons/95aec847b996d288029bb791625020d60c63f964/data/raw/draftkings/2026-09-13-main-slate.csv'))
    summary={'retrieved_at':NOW.isoformat(),'season':SEASON,'sources':records}
    (PUBLIC/'source-audit.json').write_text(json.dumps(summary,indent=2))
    print(json.dumps({'successes':sum(r['ok'] for r in records),'failures':[{'name':r['name'],'error':r['error']} for r in records if not r['ok']]},indent=2))
    if not any(r['name']=='schedule' and r['ok'] for r in records):raise RuntimeError('Schedule unavailable')
    if sum(r['ok'] and r['name'].startswith('stats_') for r in records)<5:raise RuntimeError('Insufficient real historical stats')
if __name__=='__main__':run()
