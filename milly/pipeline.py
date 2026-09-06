"""Milly model input inspection. Replaced by the tested training pipeline in the same development session."""
import pathlib,json,gzip,pandas as pd
R=pathlib.Path(__file__).resolve().parent
out={}
for p in sorted((R/'cache').glob('*')):
 if p.name.startswith(('stats_2025','rosters_2025','roster_current','depth_2026','players','dk_pool','injuries_current')):
  try:
   if p.suffix=='.json':
    d=json.loads(p.read_text()); rec={'keys':list(d),'count':len(d.get('draftables',[])),'sample':d.get('draftables',[])[:3]}
    rec['other']={k:v for k,v in d.items() if k!='draftables'}
   else:
    d=pd.read_csv(p,low_memory=False); rec={'columns':list(d),'rows':len(d),'sample':d.head(2).fillna('').to_dict('records')}
    for k in ['position','status','week','dt','depth_team','club_code']:
     if k in d:rec[k]=d[k].astype(str).value_counts().head(20).to_dict()
   out[p.name]=rec
  except Exception as e:out[p.name]={'error':str(e)}
(R/'public'/'model-input-inspection.json').write_text(json.dumps(out,indent=2,default=str))
print('Wrote input inspection for',len(out),'sources')
