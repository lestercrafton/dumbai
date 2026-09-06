"""Build the validated model runtime from a reviewed source revision.
The data remains fresh each run; only executable source is pinned. Keeping this
runtime isolated avoids mixing the two earlier experimental engine schemas.
"""
from pathlib import Path
import subprocess
ROOT=Path(__file__).resolve().parent
REVISION='3b3783dc8cca657d287137008b922c8d8cbd0ff7'
RUNTIME=ROOT/'runtime_v1'
RUNTIME.mkdir(exist_ok=True)
subprocess.run(['git','fetch','origin',REVISION],check=True)
for name in ['model.py','lineups.py','research.py','run_weekly.py','test_pipeline.py']:
    text=subprocess.check_output(['git','show',f'{REVISION}:milly/{name}'],text=True)
    if name=='model.py':
        old="sides=pd.concat([games[['game_id','week','home_team']]"
        new="d['week']=pd.to_numeric(d['week'],errors='coerce');first=d[d.week.eq(1)].copy();d['week']+=1;d=pd.concat([first,d],ignore_index=True)\n        sides=pd.concat([games[['game_id','week','home_team']]"
        if text.count(old)!=1:raise RuntimeError('Undated depth lag patch no longer matches reviewed source')
        text=text.replace(old,new)
        text=text.replace('Historical depth feeds before 2025 lack authenticated publication timestamps.','Undated historical depth feeds are lagged one week except week one. Publication timestamps are still not authenticated.')
    if name=='run_weekly.py':
        text=text.replace("'version':'1.0.0'","'version':'1.0.1'")
        text=text.replace("'Historical rosters and pre-2025 depth charts lack authenticated publication timestamps.'","'Historical roster and preseason depth publication timestamps are not authenticated; other undated depth features lag one week.'")
        old="if dest.exists():results.append(json.loads(dest.read_text()));continue"
        new="if dest.exists():\n            previous=json.loads(dest.read_text())\n        else:previous=None"
        if text.count(old)!=1:raise RuntimeError('Settlement patch does not match reviewed source')
        text=text.replace(old,new)
        old="with dest.open('x') as h:h.write(json.dumps(clean(result),allow_nan=False))"
        new="result['outcome_sha256']=hashlib.sha256(json.dumps(clean(points),sort_keys=True).encode()).hexdigest()\n        if previous and previous.get('outcome_sha256')==result['outcome_sha256']:\n            results.append(previous);continue\n        if previous:\n            revisions=destdir/'revisions';revisions.mkdir(exist_ok=True)\n            stamp=dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')\n            (revisions/(dest.stem+'-'+stamp+'.json')).write_text(json.dumps(previous,allow_nan=False))\n        result['revision_of']=previous.get('outcome_sha256') if previous else None\n        with dest.open('w') as h:h.write(json.dumps(clean(result),allow_nan=False))"
        if text.count(old)!=1:raise RuntimeError('Outcome revision patch does not match reviewed source')
        text=text.replace(old,new)
    (RUNTIME/name).write_text(text)
for name in ['cache','public']:
    target=ROOT/name;target.mkdir(exist_ok=True)
    link=RUNTIME/name
    if not link.exists():link.symlink_to(target, target_is_directory=True)
(RUNTIME/'SOURCE_REVISION.txt').write_text(REVISION+'\nPatches: one-week lag of undated non-week-one depth; versioned stat corrections; version 1.0.1.\n')
print('Prepared isolated weekly model runtime',RUNTIME)
