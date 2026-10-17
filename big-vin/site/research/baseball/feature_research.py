#!/usr/bin/env python3
"""Bounded retrospective MLB feature experiment; frozen protocol, no Site writes.
Input canonical-inputs.json comes from the sibling official/free collector.
"""
from pathlib import Path
from collections import Counter,defaultdict
import datetime as dt,hashlib,json,math,os
import numpy as np

ROOT=Path(os.environ.get('BIG_VIN_RESEARCH_DIR',Path(__file__).resolve().parent))
DAY=dt.timedelta(days=1)
def read(name):return json.loads((ROOT/name).read_text())
def write(name,value):(ROOT/name).write_text(json.dumps(value,indent=2,allow_nan=False)+'\n')
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def finite(v):return isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v)
def ordinal(date):return dt.date.fromisoformat(date[:10]).toordinal()
def daystr(n):return dt.date.fromordinal(int(n)).isoformat()
def week(n):return n-dt.date.fromordinal(n).weekday()
ACTIVE={'lookbackDays':730,'halfLifeDays':480,'ratingPenalty':12,'homePenalty':120,'homePrior':0.4,'useRest':False}
BASE={'lookbackDays':730,'halfLifeDays':120,'ratingPenalty':6,'homePenalty':30,'homePrior':0.2,'useRest':False}
METRIC_FIELDS=('hits','baseOnBalls','strikeOuts','homeRuns')
def fit_ratings(history,day,cfg):
 tr=[g for g in history if 1<day-g['_day']<=cfg['lookbackDays']]
 ids=sorted({g[k] for g in tr for k in ('homeId','awayId')});ix={t:i for i,t in enumerate(ids)};n=len(ids);A=np.diag(np.array([cfg['ratingPenalty']]*n+[cfg['homePenalty']],dtype=float));b=np.array([0.]*n+[cfg['homePenalty']*cfg['homePrior']])
 raw=Counter()
 if tr:
  h=np.array([ix[g['homeId']] for g in tr]);a=np.array([ix[g['awayId']] for g in tr]);y=np.array([g['homeScore']-g['awayScore'] for g in tr]);w=2.**(-np.array([day-g['_day'] for g in tr])/cfg['halfLifeDays']);v=np.array([0. if g.get('neutral') else 1. for g in tr])
  np.add.at(A,(h,h),w);np.add.at(A,(a,a),w);np.add.at(A,(h,a),-w);np.add.at(A,(a,h),-w)
  np.add.at(A,(h,np.full(len(h),n)),w*v);np.add.at(A,(a,np.full(len(a),n)),-w*v);np.add.at(A,(np.full(len(h),n),h),w*v);np.add.at(A,(np.full(len(a),n),a),-w*v)
  A[n,n]+=(w*v*v).sum();np.add.at(b,h,w*y);np.add.at(b,a,-w*y);b[n]+=(w*v*y).sum()
  for g in tr:raw.update([g['homeId'],g['awayId']])
 coef=np.linalg.solve(A,b)
 return {'asOf':daystr(day),'ratings':{t:float(coef[i]) for i,t in enumerate(ids)},'homeAdvantage':float(coef[-1]),'trainingGames':len(tr),'lastTrainingDate':max((g['date'] for g in tr),default=None),'teamGames':dict(raw),'parameters':cfg}
def project(g,m):
 if g['homeId'] not in m['ratings'] or g['awayId'] not in m['ratings']:return None
 return m['ratings'][g['homeId']]-m['ratings'][g['awayId']]+(0 if g.get('neutral') else m['homeAdvantage'])
def ratio(rows,group,numerator,denominator):
 values=[(r['stats'].get(group,{}).get(numerator),r['stats'].get(group,{}).get(denominator)) for r in rows]
 if not values or any(not finite(a) or not finite(b) or b<=0 for a,b in values):return None
 return sum(a for a,b in values)/sum(b for a,b in values)
def difference(a,b):return a-b if finite(a) and finite(b) else None
def total(rows,group,field):
 values=[r['stats'].get(group,{}).get(field) for r in rows]
 return sum(values) if all(finite(v) for v in values) else None
def feature_names(window):
 return ['active_margin',f'runs_for_diff_{window}',f'runs_allowed_advantage_{window}']+[f'batting_{x}_rate_diff_{window}' for x in METRIC_FIELDS]+[f'pitching_{x}_rate_advantage_{window}' for x in METRIC_FIELDS]+['staff_outs_prior3_diff','staff_pitches_prior3_diff','games_prior7_diff','venue_run_environment','venue_environment_x_active']
def build_rows(games,stop_day=None):
 games=sorted(games,key=lambda g:(g['_day'],g['startTime'],g['id']));teams=defaultdict(list);history=[];at=0;byday=defaultdict(list)
 for g in games:byday[g['_day']].append(g)
 rows=[];excluded=[];fixtures=[]
 fixture_dates={'2025-08-01','2025-09-01','2026-04-01','2026-09-01','2026-09-16'}
 for d,targets in sorted(byday.items()):
  if stop_day and d>stop_day:break
  while at<len(games) and games[at]['_day']<=d-2:
   g=games[at];history.append(g)
   for side,other in [('home','away'),('away','home')]:teams[g[side+'Id']].append({'day':g['_day'],'id':g['id'],'runsFor':g[side+'Score'],'runsAgainst':g[other+'Score'],'stats':g[side+'Stats']})
   at+=1
  if daystr(d)<'2024-05-01':continue
  active=fit_ratings(history,d,ACTIVE);base=fit_ratings(history,d,BASE)
  past=[g for g in history if d-g['_day']<=730];league_total=float(np.mean([g['homeScore']+g['awayScore'] for g in past])) if past else 0
  venues=defaultdict(list)
  for g in past:venues[g.get('venueId')].append(g['homeScore']+g['awayScore'])
  if daystr(d) in fixture_dates:fixtures.append({'date':daystr(d),'active':active,'ridgeV1':base,'targetGames':[g['id'] for g in targets]})
  for g in targets:
   h=[r for r in teams[g['homeId']] if d-r['day']<=730];a=[r for r in teams[g['awayId']] if d-r['day']<=730]
   if min(len(h),len(a))<10:excluded.append({'id':g['id'],'date':g['date'],'reason':'Fewer than10 prior eligible games for a team under full-day embargo.','homePriorGames':len(h),'awayPriorGames':len(a)});continue
   pred=project(g,active);bp=project(g,base);assert finite(pred) and finite(bp)
   h3=[r for r in h if r['day']>=d-4];a3=[r for r in a if r['day']>=d-4];h7=[r for r in h if r['day']>=d-8];a7=[r for r in a if r['day']>=d-8]
   v=venues.get(g.get('venueId'),[]);park=((sum(v)+100*league_total)/(len(v)+100)/league_total-1) if league_total>0 and g.get('venueId') is not None else 0.
   context=[difference(total(h3,'pitching','outs'),total(a3,'pitching','outs')),difference(total(h3,'pitching','numberOfPitches'),total(a3,'pitching','numberOfPitches')),len(h7)-len(a7),park,park*pred]
   features={}
   for window in (20,60):
    hh=h[-window:];aa=a[-window:]
    values=[pred,float(np.mean([r['runsFor'] for r in hh])-np.mean([r['runsFor'] for r in aa])),float(np.mean([r['runsAgainst'] for r in aa])-np.mean([r['runsAgainst'] for r in hh]))]
    values +=[difference(ratio(hh,'batting',f,'plateAppearances'),ratio(aa,'batting',f,'plateAppearances')) for f in METRIC_FIELDS]
    values +=[difference(ratio(aa,'pitching',f,'outs'),ratio(hh,'pitching',f,'outs')) for f in METRIC_FIELDS]
    features[str(window)]=values+context
   rows.append({'id':g['id'],'date':g['date'],'day':d,'block':daystr(week(d)),'homeId':g['homeId'],'awayId':g['awayId'],'venueId':g.get('venueId'),'actual':g['homeScore']-g['awayScore'],'active':pred,'ridgeV1':bp,'features':features,'lastInputDate':max(r['day'] for r in h+a),'homePriorGames':len(h),'awayPriorGames':len(a),'venuePriorGames':len(v),'baselineTrainingGames':active['trainingGames'],'baselineLastTrainingDate':active['lastTrainingDate']})
 return rows,excluded,fixtures
def specs():
 out=[{'id':'active-unadjusted','name':'Active September14 score ratings','family':'unchanged','window':20,'alpha':None,'columns':[]}]
 for alpha in (10,100,1000):out.append({'id':f'calibration-ridge{alpha}','name':f'Active + calibration (ridge{alpha})','family':'calibration','window':20,'alpha':alpha,'columns':[0]})
 for family,size in [('runs',3),('boxscore',11),('context',16)]:
  for window in (20,60):
   for alpha in (10,100,1000):out.append({'id':f'{family}-last{window}-ridge{alpha}','name':f'Active + {family},last{window} games,ridge{alpha}','family':family,'window':window,'alpha':alpha,'columns':list(range(size))})
 assert len(out)==22
 return out
def xmatrix(rows,spec):return np.array([[r['features'][str(spec['window'])][i] if r['features'][str(spec['window'])][i] is not None else np.nan for i in spec['columns']] for r in rows],dtype=float)
def learner(train,spec):
 X=xmatrix(train,spec);missing=~np.isfinite(X);med=np.array([float(np.median(X[np.isfinite(X[:,j]),j])) if np.isfinite(X[:,j]).any() else 0. for j in range(X.shape[1])]);Z=np.where(missing,med,X);aug=np.concatenate([Z,missing.astype(float)],axis=1);mu=aug.mean(axis=0);sd=aug.std(axis=0);sd[sd<1e-12]=1.;scaled=(aug-mu)/sd;design=np.column_stack([np.ones(len(train)),scaled]);target=np.array([r['actual']-r['active'] for r in train]);penalty=np.diag([0.]+[float(spec['alpha'])]*scaled.shape[1]);coef=np.linalg.solve(design.T@design+penalty,design.T@target)
 return {'medians':med.tolist(),'means':mu.tolist(),'standardDeviations':sd.tolist(),'coefficients':coef.tolist(),'trainingRows':len(train),'lastTrainingTargetDate':max(r['date'] for r in train),'spec':spec,'features':[feature_names(spec['window'])[i] for i in spec['columns']]}
def predict_correction(targets,model):
 X=xmatrix(targets,model['spec']);missing=~np.isfinite(X);Z=np.where(missing,np.array(model['medians']),X);aug=np.concatenate([Z,missing.astype(float)],axis=1);scaled=(aug-np.array(model['means']))/np.array(model['standardDeviations']);return np.column_stack([np.ones(len(targets)),scaled])@np.array(model['coefficients'])
def replay(rows,spec,start,end):
 targets=[r for r in rows if start<=r['date']<=end];byblock=defaultdict(list)
 for r in targets:byblock[r['block']].append(r)
 output=[];models=[]
 for block,test in sorted(byblock.items()):
  cutoff=ordinal(block);train=[r for r in rows if 1<cutoff-r['day']<=730];model=None
  if spec['family']!='unchanged' and len(train)>=500:model=learner(train,spec);assert model['lastTrainingTargetDate']<daystr(cutoff-1);models.append({'cutoff':block,**model})
  adjustments=predict_correction(test,model) if model else np.zeros(len(test))
  for r,delta in zip(test,adjustments):
   output.append({k:r[k] for k in ('id','date','block','actual','active','ridgeV1','homeId','awayId')}|{'predicted':r['active']+float(delta),'residualCorrection':float(delta),'learnerCutoff':block,'learnerTrainingRows':len(train),'learnerLastTargetDate':model['lastTrainingTargetDate'] if model else None,'featureLastInputDate':daystr(r['lastInputDate'])})
 return output,models
def metrics(rows,key='predicted'):
 if not rows:return {'games':0}
 errors=np.array([r['actual']-r[key] for r in rows]);return {'games':len(rows),'weeks':len({r['block'] for r in rows}),'mae':float(abs(errors).mean()),'rmse':float(np.sqrt(np.mean(errors**2))),'bias':float(errors.mean()),'winnerSignAccuracy':float(np.mean([(r['actual']>0)==(r[key]>=0) for r in rows]))}
def paired(rows):
 groups=defaultdict(list)
 for r in rows:groups[r['block']].append(abs(r['actual']-r['predicted'])-abs(r['actual']-r['active']))
 sums=np.array([sum(g) for g in groups.values()]);counts=np.array([len(g) for g in groups.values()]);rng=np.random.default_rng(20260917);draws=rng.integers(0,len(sums),(5000,len(sums)));boot=sums[draws].sum(axis=1)/counts[draws].sum(axis=1)
 return {'candidateMinusActiveMae':float(sums.sum()/counts.sum()),'weeklyBlockBootstrap95Pct':[float(v) for v in np.quantile(boot,[.025,.975])] if len(groups)>=8 else None,'weeks':len(groups),'draws':5000,'seed':20260917}
def main():
 protocol=read('protocol.json');raw=read('canonical-inputs.json');games=[];excluded_source=[]
 for g in raw['games']:
  if g.get('excludeReason'):excluded_source.append({'id':g['id'],'date':g['date'],'reason':g['excludeReason']});continue
  assert finite(g['homeScore']) and finite(g['awayScore']) and g['homeScore']>=0 and g['awayScore']>=0 and g['homeId']!=g['awayId'];games.append({**g,'_day':ordinal(g['date'])})
 rows,excluded,fixtures=build_rows(games);assert all(r['lastInputDate']<=r['day']-2 for r in rows)
 write('feature-rows.json',rows);write('baseline-parity-fixtures.json',fixtures)
 candidates=specs();dev=[];dev_predictions={};dev_models={}
 for spec in candidates:
  predictions,models=replay(rows,spec,'2025-08-01','2025-09-30');dev.append({'spec':spec,'metrics':metrics(predictions)});dev_predictions[spec['id']]=predictions;dev_models[spec['id']]=models
 chosen=min(dev,key=lambda r:(r['metrics']['mae'],r['metrics']['rmse'],len(r['spec']['columns']),r['spec']['id']))
 selection={'lockedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'protocolSha256':sha(ROOT/'protocol.json'),'inputSha256':sha(ROOT/'canonical-inputs.json'),'developmentOnly':True,'selected':chosen,'candidates':sorted(dev,key=lambda r:r['metrics']['mae'])}
 write('selection-locked-before-validation.json',selection)
 validation_started=dt.datetime.now(dt.timezone.utc).isoformat();assert validation_started>=selection['lockedAt']
 validation,val_models=replay(rows,chosen['spec'],'2026-04-01','2026-09-16');validation_metrics=metrics(validation);active_metrics=metrics(validation,'active');base_metrics=metrics(validation,'ridgeV1');uncertainty=paired(validation)
 dev_selected=dev_predictions[chosen['spec']['id']]
 # Poison future outcomes and all final box stats on/after this cutoff. Earlier
 # predictions, rolling inputs and prior score fits must remain exactly equal.
 poison_cutoff='2025-09-01';poison=[]
 for g in games:
  if g['date']>=poison_cutoff:
   stats={group:{key:99999 for key in vals} for group,vals in g['homeStats'].items()};poison.append({**g,'homeScore':999,'awayScore':1,'homeStats':stats,'awayStats':stats})
  else:poison.append(g)
 earlier,_,_=build_rows(poison,ordinal(poison_cutoff));expected=[r for r in rows if r['date']<=poison_cutoff]
 without_actual=lambda rs:[{k:v for k,v in r.items() if k!='actual'} for r in rs]
 assert without_actual(earlier)==without_actual(expected),'Future outcomes contaminated pre-cutoff features.'
 old_pred,_=replay(expected,chosen['spec'],'2025-08-01',poison_cutoff);new_pred,_=replay(earlier,chosen['spec'],'2025-08-01',poison_cutoff);assert without_actual(old_pred)==without_actual(new_pred)
 names=feature_names(60);missing={n:sum(r['features']['60'][i] is None for r in rows) for i,n in enumerate(names)}
 credible=chosen['spec']['family']!='unchanged' and validation_metrics['mae']<active_metrics['mae'] and validation_metrics['rmse']<=active_metrics['rmse'] and uncertainty['weeklyBlockBootstrap95Pct'] and uncertainty['weeklyBlockBootstrap95Pct'][1]<0
 decision='Recommend a separate prospective shadow only; keep production active until future evidence.' if credible else 'Retain active production model; later validation does not establish a credible margin-error improvement. No activation.'
 results={'createdAt':dt.datetime.now(dt.timezone.utc).isoformat(),'protocol':protocol,'protocolSha256':sha(ROOT/'protocol.json'),'sources':raw['provenance'],'coverage':{'sourceGames':len(raw['games']),'eligibleHistoricalGames':len(games),'featureRows':len(rows),'sourceDateRange':[min(g['date'] for g in games),max(g['date'] for g in games)],'sourceExclusions':dict(Counter(g['reason'] for g in excluded_source)),'warmupExclusions':len(excluded),'targetStatMissingnessCounts60GameWindow':missing,'starterFeatures':0,'exactBullpenFeatures':0,'workloadInterpretation':'Lagged total pitching-staff workload proxy; exact bullpen workload unavailable.'},'development':{'range':['2025-08-01','2025-09-30'],'grid':selection['candidates'],'selected':chosen,'selectedVsActive':paired(dev_selected)},'selectionLockedAt':selection['lockedAt'],'validationStartedAt':validation_started,'validation':{'range':['2026-04-01','2026-09-16'],'label':'Later-date retrospective validation. These outcomes were partly inspected in earlier research; no fresh holdout or profitability claim.','selected':validation_metrics,'activeSameHistory':active_metrics,'ridgeV1SameHistory':base_metrics,'paired':uncertainty},'decision':decision,'productionVersionRetained':'mlb-weekly-tuned-2026-09-14','verification':{'allRollingInputsAtLeastTwoUtcDatesEarlier':True,'weeklyLearnerTrainingDatesAtLeastTwoUtcDatesEarlier':True,'futureOutcomeAndBoxStatPoisonInvariance':True,'selectionSavedBeforeLaterValidationScoring':True,'noTargetActualStarterOrFuturePitcherFields':True,'noHistoricalPricesInvented':True}}
 write('research-results.json',results);write('development-grid-predictions.json',dev_predictions);write('validation-predictions.json',validation);write('selected-model-fits.json',{'development':dev_models[chosen['spec']['id']],'validation':val_models});write('exclusions.json',{'source':excluded_source,'warmup':excluded})
 print(json.dumps({'coverage':results['coverage'],'selected':chosen,'validation':results['validation'],'decision':decision},indent=2))
if __name__=='__main__':main()
