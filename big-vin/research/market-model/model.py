import sys,json,numpy as np,pandas as pd,lightgbm as lgb,warnings;warnings.filterwarnings('ignore')
from sklearn.linear_model import Ridge;from sklearn.pipeline import make_pipeline;from sklearn.preprocessing import StandardScaler;from sklearn.impute import SimpleImputer
sport=sys.argv[1];df=pd.read_parquet(f'/workspace/ml/feat-{sport}.parquet')
if 'month' not in df:df['month']=df.date.str[:7]
df['move']=df.cS-df.oS;df['moveT']=df.cT-df.oT
X0=[c for c in df.columns if c not in('id','date','home','away','y','tot','month','season') and df[c].notna().any()]
OPENX=[c for c in X0 if c not in('cS','cT','sdS','move','moveT')]
CFG={'g7':dict(n_estimators=200,learning_rate=0.02,num_leaves=7,min_child_samples=200),'g15':dict(n_estimators=400,learning_rate=0.02,num_leaves=15,min_child_samples=100),'g4':dict(n_estimators=150,learning_rate=0.03,num_leaves=4,min_child_samples=400),'lin':None}
def raw(target,base,feats,cfg,data):
  d=data[data[base].notna()&data[target].notna()].copy();bl=(-d[base] if target=='y' else d[base]);d['res']=d[target]-bl;out=pd.Series(0.0,index=d.index)
  for m in sorted(d.month.unique()):
    tr=d[d.month<m];te=(d.month==m).values
    if len(tr)<400:continue
    if cfg is None:mdl=make_pipeline(SimpleImputer(),StandardScaler(),Ridge(alpha=len(tr)/10))
    else:mdl=lgb.LGBMRegressor(objective='huber',alpha=10,verbose=-1,subsample=0.8,subsample_freq=1,colsample_bytree=0.7,reg_lambda=5,n_jobs=2,**cfg)
    mdl.fit(tr[feats],tr.res);out[d.index[te]]=mdl.predict(d.loc[te,feats])
  return d,bl,out
def boot(e1,e2,n=2000):
  rng=np.random.default_rng(0);e1,e2=np.asarray(e1),np.asarray(e2);i=rng.integers(0,len(e1),(n,len(e1)));dd=e1[i].mean(1)-e2[i].mean(1);return np.percentile(dd,[2.5,97.5])
def report(target,d,bl,pr):
  res={}
  for s in sorted(x for x in d.season.unique() if x>=2023):
    k=(d.season==s).values;yv=d.loc[k,target].values;b=bl[k].values;p=pr[k].values;em,eb=np.abs(yv-p),np.abs(yv-b)
    edge=p-b;act=yv-b;m=(act!=0)&(np.abs(edge)>1e-9);big=m&(np.abs(edge)>=1.5)
    res[int(s)]=dict(n=int(k.sum()),mae_model=round(em.mean(),3),mae_line=round(eb.mean(),3),d=round(em.mean()-eb.mean(),3),ci=[round(x,3) for x in boot(em,eb)],rmse_model=round(float(np.sqrt(((yv-p)**2).mean())),3),rmse_line=round(float(np.sqrt(((yv-b)**2).mean())),3),
      hit=round(float((np.sign(edge[m])==np.sign(act[m])).mean()),4) if m.any() else None,n_bets=int(m.sum()),hit_edge15=round(float((np.sign(edge[big])==np.sign(act[big])).mean()),4) if big.any() else None,n_edge15=int(big.sum()))
  return res
out={}
for target,cb,ob in (('y','cS','oS'),('tot','cT','oT')):
  out[target]={}
  for name,base,feats in (('vsClose',cb,X0),('vsOpen',ob,OPENX)):
    if not df[base].notna().any():continue
    preds={};d=bl=None
    for k,c in CFG.items():d,bl,preds[k]=raw(target,base,feats,c,df);print(sport,target,name,k,flush=True)
    preds['blend']=(preds['g7']+preds['lin'])/2
    tune=(d.season==2023).values;best=None
    for k,p in preds.items():
      for sh in (0.25,0.5,0.75,1.0):
        mae=np.abs(d[target].values[tune]-(bl+sh*p).values[tune]).mean()
        if best is None or mae<best[0]:best=(mae,k,sh)
    lineMae=np.abs(d[target].values[tune]-bl.values[tune]).mean()
    pr=bl+best[2]*preds[best[1]];out[target][name]=dict(chosen=best[1],shrink=best[2],tuneMae=round(best[0],3),tuneLineMae=round(lineMae,3),seasons=report(target,d,bl,pr))
    print(json.dumps(out[target][name]),flush=True)
    pd.DataFrame({'id':d.id,'season':d.season,'date':d.date,'y':d[target],'line':bl,'pred':pr}).to_parquet(f'/workspace/ml/pred-{sport}-{target}-{name}.parquet')
json.dump(out,open(f'/workspace/ml/result-{sport}.json','w'),indent=1)
