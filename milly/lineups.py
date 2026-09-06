"""Salary-constrained lineups and historically derived joint residual worlds.
Peer candidate-bank performance is not a learned Millionaire Maker field probability.
"""
from __future__ import annotations
import json,datetime as dt,collections
import numpy as np,pandas as pd
from scipy.optimize import milp,Bounds,LinearConstraint
from forecast import CACHE,POS,normalize,read
SLOTS=[('QB',1),('RB',1),('RB',2),('RB',3),('WR',1),('WR',2),('WR',3),('WR',4),('WR',5),('TE',1),('TE',2),('TE',3),('DST',1)]
def discover():
 g=read('schedule');now=dt.datetime.now(dt.timezone.utc);lobby=json.loads((CACHE/'dk_lobby.json').read_text());found=[]
 for c in lobby.get('Contests',[]):
  name=c.get('n','').lower();gid=c.get('dg');path=CACHE/f'dk_pool_{gid}.json'
  if not ('millionaire' in name and c.get('gameType')=='Classic' and path.exists()):continue
  obj=json.loads(path.read_text());comps=obj.get('competitions',[])
  if len(comps)<3:continue
  starts=[pd.Timestamp(x['startTime']) for x in comps]
  if min(starts)<=now or min(starts)>pd.Timestamp(now)+pd.Timedelta(days=10):continue
  if not all(t.tz_convert('America/New_York').dayofweek==6 and 12<=t.tz_convert('America/New_York').hour<=17 for t in starts):continue
  found.append((min(starts),-int(c.get('m',0)),c,obj))
 if not found:raise ValueError('No unstarted Sunday NFL Classic Millionaire pool within ten days; stale pools cannot be reused.')
 _,_,contest,obj=sorted(found,key=lambda x:(x[0],x[1]))[0];bygame={}
 for x in obj['competitions']:
  a=x['awayTeam']['abbreviation'];h=x['homeTeam']['abbreviation'];a='LA' if a=='LAR' else a;h='LA' if h=='LAR' else h
  day=pd.Timestamp(x['startTime']).tz_convert('America/New_York').strftime('%Y-%m-%d');q=g[g.away_team.eq(a)&g.home_team.eq(h)&g.gameday.eq(day)]
  if len(q)!=1:raise ValueError(f'Pool matchup not found uniquely in schedule: {a}@{h} {day}')
  bygame[x['competitionId']]={'id':a+'@'+h,'away':a,'home':h,'start':x['startTime'],'game_id':q.iloc[0].game_id,'season':int(q.iloc[0].season),'week':int(q.iloc[0].week),'market_total':float(q.iloc[0].total_line) if pd.notna(q.iloc[0].total_line) else None}
 return contest,obj,list(bygame.values()),bygame

def player_pool(obj,bygame,d,oof):
 unique={}
 for a in obj['draftables']:
  if not a.get('salary') or a.get('isDisabled'):continue
  key=str(a['playerId']);p=unique.setdefault(key,dict(a,slot_ids={}));p['slot_ids'][str(a['rosterSlotId'])]=str(a['draftableId'])
  if a['rosterSlotId']!=70:p.update({k:v for k,v in a.items() if k!='slot_ids'})
 current=d[d.game_id.isin([x['game_id'] for x in bygame.values()])].copy();names={}
 for _,r in current.iterrows():names[(normalize(r['name']),r.team)]=r
 aliases={'kennygainwell':'kennethgainwell','hollywoodbrown':'marquisebrown','jamescook':'jamescook','joshpalmer':'joshuapalmer','nicksingleton':'nicholassingleton'}
 depth=read('depth_'+str(current.season.max()));depth=depth[depth.dt.eq(depth.dt.max())] if 'dt' in depth else depth;depth_lookup={}
 if 'dt' in depth:
  for _,r in depth.iterrows():
   if pd.notna(r.gsis_id) and r.pos_abb in POS:depth_lookup[(r.gsis_id,r.team)]=min(float(r.pos_rank),depth_lookup.get((r.gsis_id,r.team),999))
 selected=[];audit=[]
 for p in unique.values():
  team=p['teamAbbreviation'];team='LA' if team=='LAR' else team;pos=p['position'];game=bygame.get(p['competition']['competitionId']);reason=None
  if not game:reason='off-slate'
  name=normalize(p['displayName']);r=names.get((name,team))
  if r is None:r=names.get((aliases.get(name,name),team))
  if pos=='DST':
   rr=current[current.player_id.eq('DST_'+team)];r=rr.iloc[0] if len(rr)==1 else None
  if r is None:reason=reason or 'no exact player identity and model row'
  elif pos!=r.position:reason='position disagreement'
  elif pos!='DST' and r.status!='ACT':reason='not on active roster: '+str(r.status)
  elif p.get('status','').upper() in ['OUT','IR','O','D','PUP','SUSP','SUSPENDED']:reason='official unavailable: '+str(p['status'])
  elif pos=='QB' and depth_lookup.get((r.player_id,team),999)!=1:reason='not confirmed depth-chart QB1'
  elif not np.isfinite(r['mean']):reason='nonfinite model forecast'
  if reason:audit.append({'name':p['displayName'],'team':team,'reason':reason});continue
  mu=max(-1.,float(r['mean']));cal=oof[(oof.position==pos)&(abs(oof.prediction-mu)<=max(2,mu*.25))]
  if len(cal)<80:
   same=oof[oof.position==pos];cal=same.loc[(same.prediction-mu).abs().sort_values().index[:80]]
  sd=float(np.std(cal.residual)) or 1
  selected.append({'id':str(p['draftableId']),'player_id':str(p['playerId']),'gsis_id':r.player_id,'name':p['displayName'],'pos':pos,'team':team,'game':game['id'],'game_id':game['game_id'],'start':game['start'],'salary':int(p['salary']),'status':p.get('status','None'),'slot_ids':p['slot_ids'],'mean':round(mu,4),'sd':round(sd,4),'q10':round(max(-4,float(mu+cal.residual.quantile(.1))),2),'q90':round(max(0,float(mu+cal.residual.quantile(.9))),2),'depth':depth_lookup.get((r.player_id,team)),'prior_opportunities':round(float(r.prior_opp),2),'prior_games':int(r.prior_rows),'model_source':'independently fitted football outcomes'})
 for team in {p['team'] for p in selected}:
  for pos in POS:
   same=sorted([p for p in selected if p['team']==team and p['pos']==pos],key=lambda p:-p['mean']);cap={'QB':1,'RB':3,'WR':5,'TE':3,'DST':1}[pos]
   for rank,p in enumerate(same,1):p['role']=SLOTS.index((pos,min(rank,cap)));p['role_rank']=rank
 return sorted(selected,key=lambda x:(POS.index(x['pos']),-x['mean'],x['id'])),{'official_distinct_players':len(unique),'modeled_active_players':len(selected),'excluded':audit,'questionable':[p['name'] for p in selected if p['status']=='Q']}

def analog_library(oof,tm):
 x=oof.copy();x['rnk']=x.groupby(['game_id','team','position']).prediction.rank(ascending=False,method='first').astype(int);scales={pos:float(np.std(x[x.position==pos].residual)) for pos in POS};records=[]
 for gid,group in x.groupby('game_id',sort=True):
  teams=tm[tm.game_id.eq(gid)&tm.score_oof.notna()].sort_values('home')
  if len(teams)!=2:continue
  residual=np.zeros(26);game_scores=[]
  for side,(_,team) in enumerate(teams.iterrows()):
   game_scores.append(float(team.team_score-team.score_oof));tg=group[group.team==team.team]
   for si,(pos,rank) in enumerate(SLOTS):
    r=tg[(tg.position==pos)&(tg.rnk==rank)];residual[13*side+si]=float(r.iloc[0].residual/scales[pos]) if len(r) else 0
  records.append({'source_game':gid,'residual':residual.round(5).tolist(),'score_residual':np.round(game_scores,3).tolist()})
 if len(records)<200:raise ValueError('Insufficient held-out games for joint residual scenarios')
 R=np.array([r['residual'] for r in records]);R=(R-R.mean(axis=0))/(R.std(axis=0)+1e-6)
 for i,r in enumerate(records):r['residual']=R[i].round(5).tolist()
 return records

def simulate(players,games,library,n,seed):
 rng=np.random.default_rng(seed);scores=np.zeros((n,len(players)),np.float32);gs=np.zeros((n,len(games),2),np.float32);R=np.array([r['residual'] for r in library]);Q=np.array([r['score_residual'] for r in library]);draws=rng.integers(len(library),size=(n,len(games)))
 for gi,g in enumerate(games):
  ids=draws[:,gi];gs[:,gi,:]=np.maximum(0,np.round(np.array([g['away_mean'],g['home_mean']])+Q[ids]))
  for pi,p in enumerate(players):
   if p['game']!=g['id']:continue
   side=int(p['team']==g['home']);ri=13*side+p['role'];values=p['mean']+p['sd']*R[ids,ri];cap={'QB':1,'RB':3,'WR':5,'TE':3,'DST':1}[p['pos']]
   if p['role_rank']>cap:values=p['mean']+p['sd']*(.5*R[ids,ri]+.8660254*rng.standard_normal(n))
   floor=-4 if p['pos']=='DST' else -3 if p['pos']=='QB' else -1;raw=np.maximum(floor,values)
   scores[:,pi]=floor+(raw-floor)*max(0.,p['mean']-floor)/max(1e-6,float(raw.mean())-floor)
 return scores,gs,draws

def valid(p,ix):
 if len(ix)!=9 or len(set(ix))!=9:return False
 c=collections.Counter(p[i]['pos'] for i in ix)
 return c['QB']==1 and c['DST']==1 and 2<=c['RB']<=3 and 3<=c['WR']<=4 and 1<=c['TE']<=2 and sum(p[i]['salary'] for i in ix)<=50000 and len({p[i]['team'] for i in ix})>=2

def optimizer(players,objective,flex=None,ban=None):
 P=len(players);pos=np.array([p['pos'] for p in players]);salary=np.array([p['salary'] for p in players]);A=[np.ones(P),salary];lo=[9,0];hi=[9,50000]
 for k,minn,maxx in [('QB',1,1),('RB',2,3),('WR',3,4),('TE',1,2),('DST',1,1)]:A.append((pos==k).astype(float));lo.append(minn);hi.append(maxx)
 if flex:
  for k in ['RB','WR','TE']:A.append((pos==k).astype(float));base={'RB':2,'WR':3,'TE':1}[k]+(k==flex);lo.append(base);hi.append(base)
 for team in sorted({p['team'] for p in players}):A.append(np.array([p['team']==team for p in players],float));lo.append(0);hi.append(8)
 for lineup in ban or []:row=np.zeros(P);row[lineup]=1;A.append(row);lo.append(0);hi.append(8)
 res=milp(-np.array(objective,float),integrality=np.ones(P),bounds=Bounds(0,1),constraints=LinearConstraint(np.array(A),lo,hi),options={'time_limit':.3,'mip_rel_gap':.01})
 if res.x is None:return None
 ix=np.flatnonzero(res.x>.5).tolist()
 return ix if valid(players,ix) else None

def candidates(players,worlds,n=1200,seed=571):
 rng=np.random.default_rng(seed);mu=np.array([p['mean'] for p in players]);sd=np.array([p['sd'] for p in players]);seen={};counts=collections.Counter()
 for k in range(n):
  flex=['RB','WR','TE'][k%3]
  if k<3:objective=mu
  elif k%4==0:objective=worlds[int(rng.integers(len(worlds)))]*.45+mu*.55
  else:objective=mu+rng.uniform(.1,.9)*sd*rng.normal(size=len(players))
  ix=optimizer(players,objective,flex)
  if ix:seen[tuple(ix)]=ix;counts[flex]+=1
 ix=optimizer(players,mu)
 if ix:seen[tuple(ix)]=ix
 return np.array(list(seen.values()),dtype=np.int32),dict(counts)

def lineup_payload(players,ix):
 by={pos:sorted([i for i in ix if players[i]['pos']==pos],key=lambda i:-players[i]['mean']) for pos in POS};out=[]
 for pos,qty in [('QB',1),('RB',2),('WR',3),('TE',1)]:
  for j in range(qty):i=by[pos].pop(0);out.append({'slot':pos if qty==1 else pos+str(j+1),**players[i]})
 extra=[i for q in by.values() for i in q if players[i]['pos']!='DST'];i=extra[0];out.append({'slot':'FLEX',**players[i]});out.append({'slot':'DST',**players[by['DST'][0]]});return out

def rank_lineups(players,games,cand,selection,evaluation,gs_eval):
 cs=np.array([selection[:,ix].sum(axis=1) for ix in cand]);es=np.array([evaluation[:,ix].sum(axis=1) for ix in cand]);best=cs.max(axis=0);tie=np.isclose(cs,best,atol=.005);credit=(tie/np.maximum(1,tie.sum(axis=0))).mean(axis=1);rank=np.argsort(-credit,kind='stable');top=rank[:20];eval_best=es.max(axis=0);etie=np.isclose(es,eval_best,atol=.005);evcredit=(etie/np.maximum(1,etie.sum(axis=0))).mean(axis=1);results=[]
 for ranknum,ci in enumerate(top,1):
  ix=cand[ci].tolist();r=es[ci];win=np.flatnonzero(r>=eval_best-.005);wi=int(win[np.argmin(abs(r[win]-np.median(r[win])))]) if len(win) else int(np.argmax(r-eval_best));payload=lineup_payload(players,ix)
  game_rows=[{'game':g['id'],'away_score':int(gs_eval[wi,gi,0]),'home_score':int(gs_eval[wi,gi,1])} for gi,g in enumerate(games)]
  for p in payload:p['witness_points']=round(float(evaluation[wi,next(i for i in ix if players[i]['id']==p['id'])]),2)
  contributors=sorted(payload,key=lambda p:-p['witness_points'])[:3];concentrated=collections.Counter(p['game'] for p in payload).most_common(2)
  explanation='This sampled world is carried by '+', '.join(p['name']+' ('+str(p['witness_points'])+' points)' for p in contributors)+'. The roster places '+str(concentrated[0][1])+' players in '+concentrated[0][0]+'. A correct game prediction still requires production to reach these players.'
  results.append({'rank':ranknum,'indices':ix,'players':payload,'salary':sum(p['salary'] for p in payload),'projected_mean':round(sum(p['mean'] for p in payload),2),'simulated_mean':round(float(r.mean()),2),'q90':round(float(np.quantile(r,.9)),2),'selection_peer_first_share':round(float(credit[ci]),6),'evaluation_peer_first_share':round(float(evcredit[ci]),6),'eval_winning_worlds':len(win),'world':{'world_index':wi,'beats_peer_bank':bool(len(win)),'lineup_points':round(float(r[wi]),2),'peer_best':round(float(eval_best[wi]),2),'games':game_rows,'explanation':explanation},'risks':[p['name']+' is marked '+p['status'] for p in payload if p['status'] not in ['None','none','']]+['Joint-residual approximation, not possession-by-possession football.','Peer-bank first share is not Millionaire Maker win probability.']})
 shapes=collections.Counter(next(p['pos'] for p in x['players'] if p['slot']=='FLEX') for x in results)
 return results,{'candidate_count':len(cand),'flex_selected':dict(shapes),'selection_worlds':len(selection),'evaluation_worlds':len(evaluation),'top20_holdout_overlap':len(set(top)&set(np.argsort(-evcredit)[:20])),'objective':'first-place share within the fixed own-model candidate bank; no ownership model','maximum_observed_candidate_count':len(cand)}
