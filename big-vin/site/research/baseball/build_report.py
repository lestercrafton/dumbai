#!/usr/bin/env python3
"""Human/UI report from the frozen corrected experiment; no new model search."""
from pathlib import Path
from collections import Counter
import datetime as dt,hashlib,json,math
import numpy as np
import feature_research as f
ROOT=f.ROOT
def main():
 result=f.read('research-results.json');grid=result['development']['grid'];development=f.read('development-grid-predictions.json');validation=f.read('validation-predictions.json');feature_rows=f.read('feature-rows.json');canonical=f.read('canonical-inputs.json');parity=f.read('baseline-parity-results.json')
 baseline=next(x for x in grid if x['spec']['family']=='unchanged');best_feature=next(x for x in grid if x['spec']['family']!='unchanged');best_sign=max(grid,key=lambda x:x['metrics']['winnerSignAccuracy'])
 families=[]
 for family in ('unchanged','calibration','runs','boxscore','context'):
  winner=min([x for x in grid if x['spec']['family']==family],key=lambda x:(x['metrics']['mae'],x['metrics']['rmse'],x['spec']['id']))
  families.append({'family':family,**winner,'pairedVsActive':f.paired(development[winner['spec']['id']])})
 feature_uncertainty=f.paired(development[best_feature['spec']['id']]);v1_uncertainty=f.paired([{**r,'predicted':r['ridgeV1']} for r in validation])
 # Independent arithmetic checks of selected development-best feature learner.
 # This does not change selection or evaluate another later-period candidate.
 repro,models=f.replay(feature_rows,best_feature['spec'],'2025-08-01','2025-09-30');stored=development[best_feature['spec']['id']];assert repro==stored
 worst_normal_equation_residual=0.
 for m in models:
  cutoff=f.ordinal(m['cutoff']);train=[r for r in feature_rows if 1<cutoff-r['day']<=730];X=f.xmatrix(train,m['spec']);miss=~np.isfinite(X);Z=np.where(miss,np.array(m['medians']),X);aug=np.concatenate([Z,miss.astype(float)],axis=1);assert np.max(np.abs(aug.mean(axis=0)-m['means']))<1e-12
  scaled=(aug-np.array(m['means']))/np.array(m['standardDeviations']);D=np.column_stack([np.ones(len(train)),scaled]);y=np.array([r['actual']-r['active'] for r in train]);P=np.diag([0.]+[float(m['spec']['alpha'])]*(D.shape[1]-1));coef=np.array(m['coefficients']);error=float(np.max(np.abs((D.T@D+P)@coef-D.T@y)));worst_normal_equation_residual=max(worst_normal_equation_residual,error)
 assert worst_normal_equation_residual<1e-8
 # Independently check lagged run form against only earlier canonical games.
 eligible=sorted([g for g in canonical['games'] if not g['excludeReason']],key=lambda g:(g['date'],g['startTime'],g['id']));checked=[]
 for date in ('2025-08-01','2025-09-01','2026-04-01','2026-09-01','2026-09-16'):
  r=next(x for x in feature_rows if x['date']==date);past=[g for g in eligible if 1<f.ordinal(date)-f.ordinal(g['date'])<=730];teamrows={}
  for team in (r['homeId'],r['awayId']):
   teamrows[team]=[(g['homeScore'],g['awayScore']) if g['homeId']==team else (g['awayScore'],g['homeScore']) for g in past if team in (g['homeId'],g['awayId'])][-60:]
  h=teamrows[r['homeId']];a=teamrows[r['awayId']];for_diff=sum(x[0] for x in h)/len(h)-sum(x[0] for x in a)/len(a);against_diff=sum(x[1] for x in a)/len(a)-sum(x[1] for x in h)/len(h)
  assert abs(for_diff-r['features']['60'][1])<1e-12 and abs(against_diff-r['features']['60'][2])<1e-12;checked.append(r['id'])
 extra_checks={'checkedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'developmentBestFeatureSpec':best_feature['spec']['id'],'reproducedDevelopmentPredictions':len(repro),'verifiedPriorLearnerNormalEquations':len(models),'maximumNormalEquationResidual':worst_normal_equation_residual,'independentlyCheckedRollingFeatureGameIds':checked,'allTrainingOnlyScalersVerified':True,'baselineRuntimeParity':parity}
 f.write('feature-verification.json',extra_checks)
 first_learner=f.ordinal('2024-05-01');warmup_only=sum(not g['excludeReason'] and f.ordinal(g['date'])<first_learner for g in canonical['games'])
 coverage={**result['coverage'],'sourceGamesUsedOnlyForInitialWarmup':warmup_only,'developmentActualDateRange':[min(r['date'] for r in stored),max(r['date'] for r in stored)],'validationActualDateRange':[min(r['date'] for r in validation),max(r['date'] for r in validation)],'featureRowsByYear':dict(Counter(r['date'][:4] for r in feature_rows))}
 report={'title':'MLB free-data feature study — retain the active formula','createdAt':dt.datetime.now(dt.timezone.utc).isoformat(),'decision':'Retain mlb-weekly-tuned-2026-09-14. None of21 residual corrections beat the unchanged score model in development; no new feature shadow or activation is recommended from this experiment.','scope':'Retrospective chronological study. Candidate family/window/penalty selected on August–September2025 only. Later2026 results partly inspected in prior work; active settings were themselves hindsight-selected on2026 data. No fresh independent holdout or profit claim.','coverage':coverage,'modelNames':{'active':'Active September14 score-rating formula, refit on same collected history','ridgeV1':'Original Ridge v1 score-rating formula, same history','bestFeature':best_feature['spec']['name']},'development':{'registeredDates':['2025-08-01','2025-09-30'],'games':790,'weeks':9,'selected':baseline,'bestFeature':best_feature,'bestFeatureVsActive':feature_uncertainty,'bestPerFamily':families,'allCandidateResults':grid,'bestSignAccuracyCandidate':best_sign,'note':'Highest sign accuracy did not override worse MAE. Every model used the same790 eligible games.'},'validation':{'registeredDates':['2026-04-01','2026-09-16'],'games':2182,'weeks':25,'models':[{'name':'Active September14 — selected unchanged strategy',**result['validation']['activeSameHistory']},{'name':'Original Ridge v1 — descriptive comparator',**result['validation']['ridgeV1SameHistory']}],'ridgeV1MinusActive':v1_uncertainty,'featureCandidateStatus':'No residual candidate advanced past the declared development selector. The selected strategy is identical to active, so its zero difference is mechanical, not evidence of a feature benefit. No post-validation reselection.'},'features':result['protocol']['features'],'chronology':result['protocol']['chronology'],'protocolSha256':result['protocolSha256'],'sourceProvenance':result['sources'],'verification':extra_checks,'nextTest':'The new collector can support a separately specified starter/pitcher and genuine bullpen study. First preserve dated pregame probable-starter snapshots and prior pitcher appearances. Do not substitute postgame actual starters. Statcast and fielding-definition work remains a later phase; no current feature benefit is claimed.'}
 report['dataAvailabilityAfterFreeze']='The collector subsequently completed exact historical starter and bullpen splits for all7234 games. They arrived after the frozen input used by this first study; the tested context feature remains total staff workload. Exact bullpen fields are available for the next separately dated experiment. Historical actual starters still do not establish target pregame knowledge.'
 f.write('report.json',report)
 family_table='\n'.join(f"| {x['family']} | {x['spec']['id']} | {x['metrics']['mae']:.5f} | {x['metrics']['rmse']:.5f} | {100*x['metrics']['winnerSignAccuracy']:.2f}% |" for x in families)
 md=f'''# MLB free-data model study — September 17, 2026

**Retain `mlb-weekly-tuned-2026-09-14`.** None of the21 predeclared residual corrections beat the unchanged score-rating formula on790 development games. The best new feature specification increased MAE from**3.48608 to3.49303 runs**. No feature candidate is recommended for activation or a new shadow from this experiment.

## What was collected and tested

The sibling collector obtained7,234 unique official completed games across2024–2026. The model used7,041 regular-season games dated March20,2024 through September16,2026 UTC after excluding98 games with suspension/resumption/reschedule flags,90 postseason games and5 games beyond the registered UTC boundary. Of those eligible games,435 before May1,2024 supplied warmup only, leaving6,606 prequential feature/label rows. No additional target failed the10-prior-game minimum, and every declared stat ratio was available for both20- and60-game windows. Missing-value handling was therefore unused in this sample.

The collector's259 disagreements between team-fielding error totals and schedule linescores were retained in its audit. Fielding errors were excluded here. No starter, final weather, attendance, pitch-location, future-next-game or season-end aggregate information was used.

The active formula uses a480-day score half-life,730-day lookback,team penalty12,home prior0.4/home penalty120,and no rest adjustment. Both it and original Ridge v1 were refitted on the same newly collected regular-season history. These are algorithm comparisons on a common dataset, **not reproductions of original frozen production forecasts**. The collected history starts in2024; it cannot supply earlier rows that a full730-day history would have contained at the earliest cutoffs. The active parameter settings were selected after2026 outcomes in earlier work, so their historical performance is descriptive.

## Chronology and bounded candidates

The original protocol was registered at2026-09-17T18:42:26.810015Z. A preserved pre-fit clarification specifies workload windows, conservative flagged-game exclusions and omitted fielding errors. For a target on UTC dateD, score/stat inputs stop atD−2. There is no same-day doubleheader input. This conservative buffer sacrifices freshness to avoid ordinary overnight finalization ambiguity; flagged suspension/resumption/reschedule cases are excluded entirely.

Each baseline prediction is fitted using only its own eligible prior scores. Residual learners train on those prequential errors, rather than full-history fitted residuals. Each Monday block fit uses labeled games throughC−2, within730 days, with at least500 labels. Medians, scaling and all coefficients come only from that prior training set. Learner coefficients can refit in later blocks under the frozen specification; candidate settings are never chosen using validation scores.

The bounded set contains the unchanged active baseline plus21 residual ridge specifications. Ridge penalties are10/100/1000. Three calibration-only variants use the active margin. Eighteen variants combine20/60-game windows with runs,box-score or context feature families. They use run-scoring/prevention form; batting hits,walks,strikeouts and homers per plate appearance; pitching rates per out; lagged total staff outs/pitches; recent game counts; and a prior venue scoring-environment proxy with100-game shrinkage toward league scoring. The venue proxy is not an official or causal park factor. Staff workload is not exact bullpen usage.

The selector minimizes development MAE, thenRMSE,feature count,and stable ID. Development is August1–September30,2025 (actual targets end September29 UTC):790 games in9 Monday blocks. The selected specification was locked before corrected later-period scoring. Every candidate uses the same targets; no price,score,team or betting-threshold filtering is optimized.

| Feature family | Best development specification | MAE | RMSE | Winner sign accuracy |
| --- | --- | ---: | ---: | ---: |
{family_table}

The best extension,60-game run form with ridge1000,was**0.00694 runs worse** in MAE. Its exploratory paired-week bootstrap95% interval for extension-minus-active error is**[−0.00159,+0.01594]** (5,000 draws,seed20260917). These9 reused development blocks do not establish an improvement. The highest development winner-sign accuracy was57.72% for a richer context model, but its MAE was3.51096 versus3.48608 active. A secondary winner-picking percentage did not override poorer line accuracy.

## Later-date retrospective comparison

The registered later period is April1–September16,2026 UTC:2,182 games in25 blocks. Much of2026 was already examined by prior research; this is **retrospective temporal validation, not a fresh holdout**. No feature candidate passed the development selector, so the selected later strategy remains the unchanged active formula. Its zero difference from active is mechanical and must not be presented as a precise estimate of feature value.

| Same-history formula | MAE | RMSE | Winner sign accuracy |
| --- | ---: | ---: | ---: |
| Active September14 / selected unchanged strategy | 3.51480 | 4.58174 | 54.72% |
| Original Ridge v1 | 3.52539 | 4.58455 | 54.72% |

The Ridge-v1-minus-active MAE difference is+0.01058 runs, with exploratory weekly-bootstrap95% interval[−0.00238,+0.02322]. The small difference is uncertain. There are no original historical offers for these targets, so the study reports no ATS,units,ROI or profitable betting claim. No calibrated probability model was fitted and no Brier/confidence claim is made.

## Verification and useful next step

Independent Node checks compared the Python score fits with the actual Big Vin runtime over dates in2024,2025 and2026; maximum prediction difference was2.23e−15 runs. The corrected final replay's5 parity fixtures also pass. Independent run-form reconstruction,train-only scaling and9 residual normal-equation checks passed. Replacing current/future scores and box statistics with poisoned values leaves earlier features and predictions unchanged. Suspended/resumed ambiguity, source dates,all exclusions and source hashes are retained.

The result is a useful negative finding: this simple implementation of recent team totals,venue context and staff workload does not improve the chosen line-error objective on development. It does not prove that baseball statistics are useless or that another properly tested feature model cannot help.

After this study's input was frozen,the collector completed exact historical starter and bullpen splits for all7,234 games. Those fields are now available for a separately dated follow-up. They were not silently inserted into this result,and the tested workload proxy must not be relabeled as bullpen usage.

Next, preserve actual pregame probable-starter snapshots and prior pitcher appearances, then specify a separate starter and genuine bullpen comparison. A pitcher named in a final historical response is not evidence that the same pitcher was announced before kickoff. The collector's additional pitcher/Statcast work can support that later study; those fields were not silently added after examining these results. Production settings and historical forecast records remain unchanged.

## Reproduce

Use the saved `canonical-inputs.json` to reproduce exactly; rerunning the collector or `prepare_inputs.py` may select revised source data.

```sh
env OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 python3 '{ROOT}/feature_research.py'
node '{ROOT}/baseline-parity.test.mjs'
env OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 python3 '{ROOT}/build_report.py'
```

`report.json` is the compact UI-facing result. `research-results.json` retains the complete protocol and grid; `development-grid-predictions.json` and `validation-predictions.json` retain per-game comparisons. `feature-rows.json`, `feature-verification.json`, `exclusions.json`, the original/amended protocol and runtime source make the calculation auditable. A failed implementation run is quarantined locally and contributes no result.

Source lineage is the official [MLB2025 schedule](https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=2025-01-01&endDate=2025-12-31&gameTypes=R,F,D,L,W&hydrate=team,probablePitcher,linescore,decisions,gameInfo,venue,weather) and [MLB2025 team game logs](https://statsapi.mlb.com/api/v1/teams/stats?stats=gameLog&group=hitting,pitching,fielding&season=2025&sportIds=1&gameType=R&startDate=2025-01-01&endDate=2025-12-31&limit=10000&offset=0), with corresponding2024 and2026 requests listed in `report.json`. Current endpoints can change; exact fetched timestamps and hashes are preserved.
'''
 # Human-readable spacing in prose; keep IDs, paths and source hashes intact.
 replacements={'the21':'the 21','on790':'on 790','from**':'from **','to3.':'to 3.','obtained7':'obtained 7','across2024':'across 2024','used7':'used 7','March20,2024':'March 20, 2024','September16,2026':'September 16, 2026','excluding98':'excluding 98',',90':', 90','and5':'and 5',',435':', 435','May1,2024':'May 1, 2024','leaving6':'leaving 6','the10':'the 10','both20':'both 20','and60':'and 60',"collector's259":"collector's 259",'a480':'a 480',',730':', 730','lookback,team':'lookback, team','penalty12':'penalty 12',',home':', home','prior0.4':'prior 0.4','penalty120,and':'penalty 120, and','after2026':'after 2026','in2024':'in 2024','full730':'full 730','at2026':'at 2026','dateD':'date D','atD−2':'at D−2','throughC−2':'through C−2','within730':'within 730','least500':'least 500','plus21':'plus 21','are10':'are 10','combine20':'combine 20','runs,box':'runs, box','hits,walks,strikeouts':'hits, walks, strikeouts','outs/pitches;':'outs/pitches;','with100':'with 100','thenRMSE,feature':'then RMSE, feature','count,and':'count, and','August1–September30,2025':'August 1–September 30, 2025',':790':': 790','in9':'in 9','price,score,team':'price, score, team',',60-game':', 60-game','ridge1000,was':'ridge 1000, was','was**':'was **','bootstrap95':'bootstrap 95','is**':'is **',',seed20260917':', seed 20260917','These9':'These 9','was57':'was 57','was3':'was 3','versus3':'versus 3','April1–September16,2026':'April 1–September 16, 2026',':2,182':': 2,182','in25':'in 25','of2026':'of 2026','is+0':'is +0','interval[−':'interval [−','ATS,units,ROI':'ATS, units, ROI','in2024,2025':'in 2024, 2025','and2026':'and 2026','was2.23':'was 2.23',"replay's5":"replay's 5",'reconstruction,train-only':'reconstruction, train-only','and9':'and 9','dates,all':'dates, all','totals,venue':'totals, venue','[MLB2025':'[MLB 2025','corresponding2024':'corresponding 2024'}
 for a,b in replacements.items():md=md.replace(a,b)
 (ROOT/'research-report.md').write_text(md)
 manifest={p.name:sha for p in sorted(ROOT.iterdir()) if p.is_file() and p.name!='artifact-manifest.json' for sha in [hashlib.sha256(p.read_bytes()).hexdigest()]};f.write('artifact-manifest.json',manifest)
 print(json.dumps({'report':str(ROOT/'report.json'),'markdown':str(ROOT/'research-report.md'),'selected':'active-unadjusted','bestFeatureDevelopmentDifference':feature_uncertainty,'laterComparatorDifference':v1_uncertainty,'verification':extra_checks['maximumNormalEquationResidual']},indent=2))
if __name__=='__main__':main()
