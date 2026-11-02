"""Walk-forward pre-game features. State is updated only after a game is processed,
so each row uses information from strictly earlier games (plus pre-game market lines
and the officiating crew, both public before tip-off)."""
import json,sys,math,collections,numpy as np,pandas as pd,datetime as dt
sport=sys.argv[1]
G=json.load(open(f'/workspace/ml/games-{sport}.json'));RAW=json.load(open(f'/workspace/ml/raw-{sport}.json'))
LON={'1':-84.4,'2':-71.1,'17':-74.0,'30':-80.8,'4':-87.6,'5':-81.7,'6':-96.8,'7':-105.0,'8':-83.0,'9':-122.4,'10':-95.4,'11':-86.2,'12':-118.3,'13':-118.3,'29':-90.0,'14':-80.2,'15':-87.9,'16':-93.3,'3':-90.1,'18':-74.0,'25':-97.5,'19':-81.4,'20':-75.2,'21':-112.1,'22':-122.7,'23':-121.5,'24':-98.5,'28':-79.4,'26':-111.9,'27':-77.0}
ALT_STATES={'CO','WY','UT','NM'};ALT_NBA={'7','26'}
def season_of(s):y,m=int(s[:4]),int(s[5:7]);return y if m>=8 else y-1
def mk(s):
  try:a,b=str(s).split('-');return float(a),float(b)
  except:return 0.0,0.0
def f(x):
  try:return float(x)
  except:return 0.0
def box(team):
  fg,fga=mk(team.get('fieldGoalsMade-fieldGoalsAttempted'));tp,tpa=mk(team.get('threePointFieldGoalsMade-threePointFieldGoalsAttempted'));ft,fta=mk(team.get('freeThrowsMade-freeThrowsAttempted'))
  orb,drb,to=f(team.get('offensiveRebounds')),f(team.get('defensiveRebounds')),f(team.get('totalTurnovers') or team.get('turnovers'))
  return dict(fg=fg,fga=fga,tp=tp,tpa=tpa,ft=ft,fta=fta,orb=orb,drb=drb,to=to,poss=fga-orb+to+0.44*fta)
def market(o):
  o=o or [];sp=[(q['oS'],q['cS']) for q in o if q.get('oS') is not None and q.get('cS') is not None];tt=[(q['oT'],q['cT']) for q in o if q.get('oT') is not None and q.get('cT') is not None]
  if not sp:return None
  med=lambda v:float(np.median(v))
  return dict(oS=med([a for a,b in sp]),cS=med([b for a,b in sp]),sdS=float(np.std([b for a,b in sp])),nBooks=len(sp),oT=med([a for a,b in tt]) if tt else np.nan,cT=med([b for a,b in tt]) if tt else np.nan)
games=sorted(G.values(),key=lambda g:g['start'])
# ---------- state
HL=45 if sport=='nba' else 120
class EW:
  def __init__(s,a):s.a=a;s.v={};
  def up(s,k,x):s.v[k]=x if k not in s.v else s.v[k]*(1-s.a)+x*s.a
  def get(s,k,d=np.nan):return s.v.get(k,d)
ew=EW(0.12 if sport=='nba' else 0.15);ews=EW(0.35)
last={};hist=collections.defaultdict(list)  # team -> list of (date)
pval=EW(0.2);pmin=EW(0.2);lastplayed={};roster=collections.defaultdict(lambda:collections.deque(maxlen=10))
refm=EW(0.1);reft=EW(0.1);refn=collections.Counter()
rated=[]  # past games for ridge: (day, h, a, margin, hpts, apts, neutral)
def ridge(day):
  if not rated:return {},{},{},0,0,0
  R=[r for r in rated if 0<day-r[0]<=730]
  teams=sorted({r[1] for r in R}|{r[2] for r in R});ix={t:i for i,t in enumerate(teams)};n=len(teams)
  w=np.array([2**(-(day-r[0])/HL) for r in R]);H=np.array([0 if r[6] else 1 for r in R],float)
  hi=np.array([ix[r[1]] for r in R]);ai=np.array([ix[r[2]] for r in R])
  # margin ridge
  A=np.zeros((n+1,n+1));b=np.zeros(n+1);y=np.array([r[3] for r in R],float)
  np.add.at(A,(hi,hi),w);np.add.at(A,(ai,ai),w);np.add.at(A,(hi,ai),-w);np.add.at(A,(ai,hi),-w)
  np.add.at(A,(hi,n),w*H);np.add.at(A,(n,hi),w*H);np.add.at(A,(ai,n),-w*H);np.add.at(A,(n,ai),-w*H);A[n,n]+=(w*H*H).sum()
  np.add.at(b,hi,w*y);np.add.at(b,ai,-w*y);b[n]+=(w*H*y).sum()
  A[np.arange(n),np.arange(n)]+=2.0;A[n,n]+=30;b[n]+=30*3
  c=np.linalg.solve(A,b);rat={t:c[ix[t]] for t in teams}
  # points off/def ridge: pts_h = mu + o_h - d_a + h ; pts_a = mu + o_a - d_h
  m=2*n+2;A=np.zeros((m,m));b=np.zeros(m)
  def add(cols,vals,yy,ww):
    for i,(ci,vi) in enumerate(zip(cols,vals)):
      for cj,vj in zip(cols,vals):np.add.at(A,(ci,cj),ww*vi*vj)
      np.add.at(b,ci,ww*vi*yy)
  one=np.ones(len(R));mu=np.full(len(R),2*n);hh=np.full(len(R),2*n+1)
  add([mu,hi,n+ai,hh],[one,one,-one,H],np.array([r[4] for r in R],float),w)
  add([mu,ai,n+hi],[one,one,-one],np.array([r[5] for r in R],float),w)
  A[np.arange(2*n),np.arange(2*n)]+=2.0;A[2*n+1,2*n+1]+=30
  c=np.linalg.solve(A,b);off={t:c[ix[t]] for t in teams};de={t:c[n+ix[t]] for t in teams}
  return rat,off,de,c[2*n],c[2*n+1],len(R)
rows=[];curday=None;RT=None
for g in games:
  r=RAW.get(g['id']) or {};s=r.get('s');day=(dt.date.fromisoformat(g['start'][:10])-dt.date(2020,1,1)).days
  if day!=curday:curday=day;RT=ridge(day)
  rat,off,de,mu,hadv,ntrain=RT;h,a=g['homeId'],g['awayId'];mk_=market(r.get('o'))
  row=dict(id=g['id'],date=g['start'][:10],season=season_of(g['start']),home=h,away=a,neutral=int(g['neutral']),conf=int(g.get('conf',False)),post=int(g.get('seasonType')==3),
    y=g['hs']-g['as_'],tot=g['hs']+g['as_'])
  if mk_:row.update(mk_)
  # ratings
  row['r_h']=rat.get(h,np.nan);row['r_a']=rat.get(a,np.nan);row['ridgeMargin']=(rat.get(h,0)-rat.get(a,0)+(0 if g['neutral'] else hadv)) if h in rat and a in rat else np.nan
  row['ridgeTotal']=(2*mu+off.get(h,0)-de.get(a,0)+off.get(a,0)-de.get(h,0)+(0 if g['neutral'] else hadv)) if h in off and a in off else np.nan
  # team form features
  for side,t,o in (('h',h,a),('a',a,h)):
    for k in ('pts','opp','poss','efg','oefg','tov','otov','orb','oorb','ftr','oftr','tpar','ortg','drtg','mar'):
      row[f'{side}_{k}']=ew.get((t,k));row[f'{side}_s_{k}']=ews.get((t,k)) if k in ('ortg','drtg','mar','poss') else row.get(f'{side}_s_{k}',np.nan)
    hs=hist[t];prev=hs[-1] if hs else None
    row[f'{side}_rest']=min(day-prev,10) if prev is not None else 10
    row[f'{side}_g7']=sum(1 for d in hs[-6:] if day-d<=7)
    row[f'{side}_gp']=sum(1 for d in hs if season_of(g['start'])==season_of((dt.date(2020,1,1)+dt.timedelta(d)).isoformat()))
    # availability: rotation value of players who missed the team's last game
    rv=0.0;tot_v=0.0
    if prev is not None:
      for pid in set(x for lst in roster[t] for x in lst):
        v=pval.get(pid,0);mn=pmin.get(pid,0)
        if mn<12:continue
        tot_v+=max(v,0)
        if lastplayed.get(pid)!=(t,prev):rv+=max(v,0)
    row[f'{side}_missV']=rv;row[f'{side}_rotV']=tot_v
  row['b2bDiff']=int(row['h_rest']==1)-int(row['a_rest']==1);row['restDiff']=row['h_rest']-row['a_rest']
  if sport=='nba':
    row['tz']=abs(LON.get(h,-90)-LON.get(a,-90))/15;row['alt']=int(h in ALT_NBA)
  else:row['tz']=np.nan;row['alt']=int((g.get('state') or '') in ALT_STATES and not g['neutral'])
  offs=(s or {}).get('officials') or []
  row['ref_m']=np.nanmean([refm.get(o) for o in offs]) if offs and any(o in refm.v for o in offs) else np.nan
  row['ref_t']=np.nanmean([reft.get(o) for o in offs]) if offs and any(o in reft.v for o in offs) else np.nan
  row['ref_n']=np.mean([refn[o] for o in offs]) if offs else 0
  row['dayOfSeason']=row['h_gp']+row['a_gp']
  rows.append(row)
  # ---------- update state after the game
  rated.append((day,h,a,g['hs']-g['as_'],g['hs'],g['as_'],g['neutral']))
  if s and s.get('teams') and h in s['teams'] and a in s['teams']:
    bh,ba=box(s['teams'][h]),box(s['teams'][a])
    for t,b1,b2,p1,p2 in ((h,bh,ba,g['hs'],g['as_']),(a,ba,bh,g['as_'],g['hs'])):
      poss=max((b1['poss']+b2['poss'])/2,40)
      vals=dict(pts=p1,opp=p2,poss=poss,efg=(b1['fg']+0.5*b1['tp'])/max(b1['fga'],1),oefg=(b2['fg']+0.5*b2['tp'])/max(b2['fga'],1),tov=b1['to']/poss,otov=b2['to']/poss,
        orb=b1['orb']/max(b1['orb']+b2['drb'],1),oorb=b2['orb']/max(b2['orb']+b1['drb'],1),ftr=b1['fta']/max(b1['fga'],1),oftr=b2['fta']/max(b2['fga'],1),tpar=b1['tpa']/max(b1['fga'],1),ortg=100*p1/poss,drtg=100*p2/poss,mar=p1-p2)
      for k,v in vals.items():ew.up((t,k),v);ews.up((t,k),v)
    for t,lst in (s.get('players') or {}).items():
      ids=[]
      for p in lst:
        pid,mn,pts=p[0],p[1],p[2];fg,fga=mk(p[3]);ft,fta=mk(p[4])
        gs=pts+0.4*fg-0.7*fga-0.4*(fta-ft)+0.7*p[5]+0.3*p[6]+p[8]+0.7*p[7]+0.7*p[9]-0.4*p[11]-p[10]
        pval.up(pid,gs-0.3*mn);pmin.up(pid,mn);lastplayed[pid]=(t,day)
        if mn>0:ids.append(pid)
      roster[t].append(ids)
    if mk_:
      for o in s.get('officials') or []:
        refm.up(o,(g['hs']-g['as_'])+mk_['cS']);refn[o]+=1
        if not np.isnan(mk_['cT']):reft.up(o,(g['hs']+g['as_'])-mk_['cT'])
  hist[h].append(day);hist[a].append(day)
df=pd.DataFrame(rows);df.to_parquet(f'/workspace/ml/feat-{sport}.parquet');print(df.shape,df['cS'].notna().sum())
