import json,csv,re,random,collections
random.seed(7)
R='/workspace/research-nba/'
def windows(sport):
  return {'nba':{'select':('2024-12-01','2025-10-01'),'holdout':('2025-10-21','2026-10-01')},'cbb':{'select':('2024-11-04','2025-05-01'),'holdout':('2025-10-01','2026-05-01')}}[sport]
def payout(price):
  if price is None:price=-110
  return 100/abs(price) if price<0 else price/100
def bets(rows,line='open',prices=None):
  out=[]
  for r in rows:
    L=r[line];e=r['p']+L
    if e==0:continue
    s=1 if e>0 else -1;c=(r['y']+L)*s
    if c==0:res=0
    else:
      pr=None
      if prices:o=prices.get(r['id']) or {};pr=o.get('openHomePrice' if s>0 else 'openAwayPrice')
      res=payout(pr) if c>0 else -1
    out.append(dict(r,edge=abs(e),side=s,win=c>0,push=c==0,u110=(0 if c==0 else (100/110 if c>0 else -1)),uprice=res,clv=s*(r['open']-r['close'])))
  return out
def summ(b,key='u110',boot=True):
  d=[x for x in b if not x['push']];n=len(d)
  if not n:return None
  w=sum(x['win'] for x in d);u=sum(x[key] for x in d);clv=sum(x['clv'] for x in b)/len(b)
  o=dict(n=n,w=w,l=n-w,hit=w/n,units=u,roi=u/n,clv=clv)
  if boot and n>=20:
    hs=[];rs=[]
    for _ in range(2000):
      s=[d[random.randrange(n)] for _ in range(n)];hs.append(sum(x['win'] for x in s)/n);rs.append(sum(x[key] for x in s)/n)
    hs.sort();rs.sort();o['hitCI']=(hs[50],hs[1949]);o['roiCI']=(rs[50],rs[1949])
  return o
def fmt(o):
  if not o:return '—'
  ci=f" [{o['hitCI'][0]*100:.1f}–{o['hitCI'][1]*100:.1f}]" if 'hitCI' in o else ''
  rci=f" [{o['roiCI'][0]*100:+.1f}–{o['roiCI'][1]*100:+.1f}]" if 'roiCI' in o else ''
  return f"{o['w']}–{o['l']} | {o['hit']*100:.1f}%{ci} | {o['units']:+.1f}u | ROI {o['roi']*100:+.1f}%{rci} | CLV {o['clv']:+.2f}"
REPORT={};LINES=[]
def P(s=''):LINES.append(s);print(s)
def load(sport,ver):
  d=json.load(open(f'/tmp/{sport}dump.json'))[ver];pr=json.load(open(R+f'odds2-{sport}.json'))
  W=windows(sport);seg={k:[r for r in d if a<=r['date']<b] for k,(a,b) in W.items()}
  return seg,pr
# ---- Idea 1
for sport,ver in (('nba','nba-v2'),('cbb','cbb-v2')):
  seg,pr=load(sport,ver);REPORT[sport]={}
  P(f'\n## {sport.upper()} {ver}: bet the ESPN BET opener, by edge threshold (edge = model margin vs opener)')
  for k,rows in seg.items():
    b=bets(rows,'open',pr);P(f'\n### {k} ({rows[0]["date"]} to {rows[-1]["date"]}, {len(rows)} lined games)')
    P('| Edge | W–L | Hit % [95% CI] | Units −110 | ROI [95% CI] | CLV | ROI at listed opener price |');P('|---|---|---|---|---|---|---|')
    for lo,hi in ((1,99),(2,99),(3,99),(4,99),(5,99),(1,2),(2,3),(3,4),(4,5)):
      bb=[x for x in b if lo<=x['edge']<hi];o=summ(bb);o2=summ(bb,'uprice',False)
      lab=f'≥{lo}' if hi==99 else f'{lo}–{hi}'
      REPORT[sport].setdefault(k,{})[lab]=dict(o or {},roiListed=o2['roi'] if o2 else None)
      if o:P(f"| {lab} | {o['w']}–{o['l']} | {o['hit']*100:.1f}% [{o['hitCI'][0]*100:.1f}–{o['hitCI'][1]*100:.1f}] | {o['units']:+.1f} | {o['roi']*100:+.1f}% [{o['roiCI'][0]*100:+.1f}, {o['roiCI'][1]*100:+.1f}] | {o['clv']:+.2f} | {o2['roi']*100:+.1f}% |")
  # priced coverage
  n=sum(1 for v in pr.values() if v.get('openHomePrice'));P(f'\nOpener prices listed for {n} of {len(pr)} {sport.upper()} games; share not at −110: {sum(1 for v in pr.values() if v.get("openHomePrice") not in (None,-110.0))/max(n,1)*100:.0f}%')
# ---- Idea 2 CBB splits
seg,pr=load('cbb','cbb-v2')
UA={'User-Agent':'Mozilla/5.0'}
import urllib.request
def norm(s):s=s.lower().replace('&','and').replace('state','st').replace('saint','st');return re.sub(r'[^a-z0-9]','',s)
ALIAS={'App State':'Appalachian St.','California Baptist':'Cal Baptist','Grambling':'Grambling St.','Kansas City':'UMKC','LSU New Orleans':'New Orleans','Long Island University':'LIU','McNeese':'McNeese St.','Miami':'Miami FL','Nicholls':'Nicholls St.','Ole Miss':'Mississippi','Omaha':'Nebraska Omaha','SE Louisiana':'Southeastern Louisiana','Sam Houston':'Sam Houston St.','San José State':'San Jose St.','Seattle U':'Seattle','South Carolina Upstate':'USC Upstate','Texas A&M-Corpus Christi':'Texas A&M Corpus Chris','UAlbany':'Albany','UConn':'Connecticut','UIC':'Illinois Chicago','UL Monroe':'Louisiana Monroe','UT Martin':'Tennessee Martin'}
T=[x['team'] for x in json.load(open('/tmp/espnteams.json'))['sports'][0]['leagues'][0]['teams']]
conf={}
for y in (2025,2026):
  rows=list(csv.DictReader(open(f'/tmp/t{y}.csv')));m={norm(r['team']):r['conf'] for r in rows}
  conf[y]={}
  for t in T:
    for c in [ALIAS.get(t['location']),t['location'],t.get('shortDisplayName'),t['displayName']]:
      if c and norm(c) in m:conf[y][t['id']]=m[norm(c)];break
HIGH={'ACC','B12','BE','B10','SEC','P12'};MID={'Amer','A10','MWC','WCC','MVC'}
tier=lambda c:None if c is None else 'high' if c in HIGH else 'mid' if c in MID else 'low'
def season(d):y=int(d[:4]);return y+1 if int(d[5:7])>=8 else y
hist={g['id']:g for g in json.load(open('/workspace/dumbai/big-vin/data/totals/history-cbb.json'))['games']}
def gameinfo(r):
  s=season(r['date']);ch,ca=conf.get(s,{}).get(r['homeId']),conf.get(s,{}).get(r['awayId'])
  th,ta=tier(ch),tier(ca);order=['high','mid','low']
  if th is None or ta is None:t='non-D1/unmapped'
  elif th==ta:t=f'both {th}'
  else:t=f"{min(th,ta,key=order.index)} vs {max(th,ta,key=order.index)}"
  m=int(r['date'][5:7]);d=int(r['date'][8:10])
  post=(m==3 and d>=10) or m==4
  typ='postseason (Mar 10+)' if post else 'neutral site' if r['neutral'] else 'conference' if ch and ch==ca else 'non-conference'
  return t,typ
spread=lambda r:abs(r['open'])
P('\n## CBB v2 splits (all games with an opener; bet every edge ≥3, −110)')
cbbsplit={}
for k,rows in seg.items():
  b=[x for x in bets(rows,'open',pr) if x['edge']>=3];
  for x in b:x['tier'],x['type']=gameinfo(x);x['size']='opener ≤4.5' if spread(x)<=4.5 else 'opener 5–10.5' if spread(x)<=10.5 else 'opener 11+'
  for dim in ('tier','type','size'):
    for v in sorted(set(x[dim] for x in b)):
      cbbsplit.setdefault((dim,v),{})[k]=summ([x for x in b if x[dim]==v])
for dim in ('tier','type','size'):
  P(f'\n| {dim} | 2024-25 selection | 2025-26 holdout |');P('|---|---|---|')
  for (d,v),o in cbbsplit.items():
    if d==dim:P(f"| {v} | {fmt(o.get('select'))} | {fmt(o.get('holdout'))} |")
# line availability by tier
P('\n### CBB line availability (ESPN BET opener present) by game tier, all finals')
allg=list(hist.values());lines=json.load(open('/workspace/dumbai/big-vin/data/spreads/history-cbb.json'))['lines']
cov=collections.defaultdict(lambda:[0,0])
for g in allg:
  r=dict(g,neutral=g.get('neutral',False));t,_=gameinfo(r);ok=(lines.get(g['id']) or {}).get('open') is not None
  cov[t][0]+=1;cov[t][1]+=ok
P('| Tier | Finals | With opener | Coverage |');P('|---|---|---|---|')
for t,(n,k) in sorted(cov.items()):P(f'| {t} | {n} | {k} | {k/n*100:.0f}% |')
P('\n### CBB neutral-site games by edge (opener, −110)')
P('| Edge | 2024-25 selection | 2025-26 holdout |');P('|---|---|---|')
neu={}
for k,rows in seg.items():
  b=[x for x in bets(rows,'open',pr) if x['neutral']]
  for x in b:x['type']=gameinfo(x)[1]
  for th in (0,1,2,3,4,5):neu[th]=neu.get(th,{});neu[th][k]=summ([x for x in b if x['edge']>=th and x['type']=='neutral site'])
for th,v in neu.items():P(f"| ≥{th} | {fmt(v.get('select'))} | {fmt(v.get('holdout'))} |")
REPORT['cbbNeutral']=neu
REPORT['cbbSplits']={f'{d}:{v}':o for (d,v),o in cbbsplit.items()}
REPORT['cbbCoverage']=dict(cov)
# ---- NBA fav/dog and totals
seg,pr=load('nba','nba-v2')
P('\n## NBA v2 by side of the pick (edge ≥2, opener, −110)')
P('| Pick | 2024-25 selection | 2025-26 holdout |');P('|---|---|---|')
nsplit={}
for k,rows in seg.items():
  for x in bets(rows,'open',pr):
    if x['edge']<2:continue
    fav=(x['open']<0)==(x['side']>0)
    lab=('favorite' if fav else 'underdog')+(' (home)' if x['side']>0 else ' (away)')
    for l in (('favorite' if fav else 'underdog'),lab):nsplit.setdefault(l,{}).setdefault(k,[]).append(x)
for l,v in nsplit.items():P(f"| {l} | {fmt(summ(v.get('select',[])))} | {fmt(summ(v.get('holdout',[])))} |")
REPORT['nbaSides']={l:{k:summ(b) for k,b in v.items()} for l,v in nsplit.items()}
tot=json.load(open('/tmp/ntot.json'));P('\n## NBA totals (existing totals model, walk-forward daily; ESPN BET opening total, −110)')
P('| Edge | 2024-25 selection | 2025-26 holdout |');P('|---|---|---|')
W=windows('nba');tsplit={}
for t in tot:
  o=pr.get(t['id']) or {};L=o.get('openTotal');C=o.get('closeTotal')
  if L is None:continue
  e=t['model']-L;
  if e==0 or t['actual']==L:continue
  s=1 if e>0 else -1;win=(t['actual']-L)*s>0
  k=next((k for k,(a,b) in W.items() if a<=t['date']<b),None)
  if not k:continue
  x=dict(win=win,push=False,u110=100/110 if win else -1,clv=s*((C or L)-L),edge=abs(e))
  for th in (0,2,4,6,8):
    if abs(e)>=th:tsplit.setdefault(th,{}).setdefault(k,[]).append(x)
for th,v in tsplit.items():P(f"| ≥{th} | {fmt(summ(v.get('select',[])))} | {fmt(summ(v.get('holdout',[])))} |")
REPORT['nbaTotals']={th:{k:summ(b) for k,b in v.items()} for th,v in tsplit.items()}
json.dump(REPORT,open(R+'edges/report.json','w'),indent=1,default=str)
open(R+'edges/tables.md','w').write('\n'.join(LINES))
