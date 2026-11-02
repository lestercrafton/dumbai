import json,sys,urllib.request,datetime,concurrent.futures as cf,os
sport=sys.argv[1];lg={'nba':'nba','cbb':'mens-college-basketball'}[sport]
SEAS={'nba':[('2022-10-18','2023-06-20'),('2023-10-24','2024-06-20'),('2024-10-22','2025-06-25'),('2025-10-21','2026-06-25'),('2026-10-20','2026-11-01')],
 'cbb':[('2022-11-07','2023-04-04'),('2023-11-06','2024-04-09'),('2024-11-04','2025-04-08'),('2025-11-03','2026-04-07'),('2026-11-01','2026-11-01')]}[sport]
def get(u):
  for i in range(4):
    try:return json.load(urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0 research'}),timeout=25))
    except Exception:pass
days=[]
for a,b in SEAS:
  d=datetime.date.fromisoformat(a)
  while d<=datetime.date.fromisoformat(b):days.append(d.strftime('%Y%m%d'));d+=datetime.timedelta(1)
def sb(day):
  u=f'https://site.api.espn.com/apis/site/v2/sports/basketball/{lg}/scoreboard?dates={day}&limit=500'+('&groups=50' if sport=='cbb' else '')
  d=get(u) or {};out=[]
  for e in d.get('events',[]):
    c=e['competitions'][0]
    if not c.get('status',{}).get('type',{}).get('completed'):continue
    t={x['homeAway']:x for x in c['competitors']}
    out.append(dict(id=e['id'],start=e['date'],seasonType=e.get('season',{}).get('type'),homeId=t['home']['team']['id'],awayId=t['away']['team']['id'],hs=int(t['home']['score']),as_=int(t['away']['score']),neutral=bool(c.get('neutralSite')),conf=bool(c.get('conferenceCompetition')),venue=(c.get('venue') or {}).get('id'),city=((c.get('venue') or {}).get('address') or {}).get('city'),state=((c.get('venue') or {}).get('address') or {}).get('state')))
  return out
out=f'/workspace/ml/games-{sport}.json'
if os.path.exists(out):games=json.load(open(out))
else:
  with cf.ThreadPoolExecutor(16) as ex:games=[g for r in ex.map(sb,days) for g in r]
  games={g['id']:g for g in games};json.dump(games,open(out,'w'))
print('games',len(games),flush=True)
def stat(t):
  return {s['name']:s.get('displayValue') for s in t.get('statistics',[])}
def num(x):
  try:return float(x)
  except:return 0.0
def summ(gid):
  d=get(f'https://site.api.espn.com/apis/site/v2/sports/basketball/{lg}/summary?event={gid}')
  if not d:return None
  teams={str(t['team']['id']):stat(t) for t in d.get('boxscore',{}).get('teams',[])}
  players={}
  for t in d.get('boxscore',{}).get('players',[]):
    st=t['statistics'][0];L=st['labels'];rows=[]
    for a in st['athletes']:
      s=a.get('stats') or []
      if a.get('didNotPlay') or not s:continue
      r=dict(zip(L,s));rows.append([str((a.get('athlete') or {}).get('id')),num(r.get('MIN')),num(r.get('PTS')),r.get('FG'),r.get('FT'),num(r.get('OREB')),num(r.get('DREB')),num(r.get('AST')),num(r.get('STL')),num(r.get('BLK')),num(r.get('TO')),num(r.get('PF')),num(r.get('+/-')),bool(a.get('starter'))])
    players[str(t['team']['id'])]=rows
  gi=d.get('gameInfo',{});lines={}
  for c in d['header']['competitions'][0]['competitors']:lines[c['homeAway']]=[num(x.get('displayValue')) for x in c.get('linescores',[])]
  return dict(teams=teams,players=players,officials=[o.get('displayName') for o in gi.get('officials',[])],att=gi.get('attendance'),lines=lines)
def am(x):
  try:return float(str(x).replace('+',''))
  except:return None
def odds(gid):
  d=get(f'https://sports.core.api.espn.com/v2/sports/basketball/leagues/{lg}/events/{gid}/competitions/{gid}/odds')
  if not d or not d.get('items'):return None
  out=[]
  for it in d['items']:
    g=lambda *k:am(__import__('functools').reduce(lambda a,b:(a or {}).get(b) if isinstance(a,dict) else None,k,it))
    out.append(dict(p=it['provider'].get('name'),pid=it['provider'].get('id'),oS=g('homeTeamOdds','open','pointSpread','american'),cS=g('homeTeamOdds','close','pointSpread','american'),oT=g('open','total','american'),cT=g('close','total','american'),spread=am(it.get('spread')),ou=am(it.get('overUnder')),oHP=g('homeTeamOdds','open','spread','american'),cHP=g('homeTeamOdds','close','spread','american')))
  return out
rf=f'/workspace/ml/raw-{sport}.json';raw=json.load(open(rf)) if os.path.exists(rf) else {}
def one(gid):
  try:return gid,dict(s=summ(gid),o=odds(gid))
  except Exception as e:return gid,None
todo=[k for k in games if k not in raw or raw[k] is None or raw[k].get('s') is None]
n=0
with cf.ThreadPoolExecutor(40) as ex:
  for k,v in ex.map(one,todo):
    raw[k]=v;n+=1
    if n%3000==0:json.dump(raw,open(rf,'w'));print(n,flush=True)
json.dump(raw,open(rf,'w'));print('done',sum(1 for v in raw.values() if v and v.get('s')),len(games),flush=True)
