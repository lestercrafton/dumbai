"""Publish only generated research files onto current main; never force-push.
Keep immutable releases, check source identity, and retry a concurrent normal push.
This runs in the ephemeral Actions checkout and leaves original source untouched.
"""
from __future__ import annotations
import datetime as dt, hashlib, json, os, pathlib, shutil, subprocess, tempfile
ROOT=pathlib.Path(__file__).resolve().parent
REPO=ROOT.parent
MUTABLE={'latest.json','worlds.json','training-report.json','lineup-audit.json','research.json','pool-audit.json','release-checks.json','twenty.csv','twenty.html','runner-status.json','feed.xml','source-audit.json','contest-discovery.json','scorecard.json','grading-status.json'}
def git(*args,cwd=REPO):
 return subprocess.check_output(['git',*args],cwd=cwd,text=True).strip()
def load(path):
 return json.loads(path.read_text()) if path.exists() else {}
def fingerprint(path):
 return hashlib.sha256(b''.join(p.read_bytes() for p in sorted(path.glob('*.py')) if p.name!='publish.py')).hexdigest()
def main():
 generated=ROOT/'public';new=load(generated/'latest.json')
 # The runner fingerprints all Python source including this publisher.
 expected=new.get('code_sha256')
 with tempfile.TemporaryDirectory(prefix='milly-publish-') as temp:
  target=pathlib.Path(temp)/'worktree'
  for attempt in range(3):
   git('fetch','origin','main')
   git('worktree','add','--detach',str(target),'origin/main')
   try:
    remote=target/'milly';public=remote/'public';public.mkdir(parents=True,exist_ok=True)
    actual=hashlib.sha256(b''.join(p.read_bytes() for p in sorted(remote.glob('*.py')))).hexdigest()
    if expected and actual!=expected:raise RuntimeError('Model source changed while this run was executing; do not publish stale-code predictions')
    old=load(public/'latest.json');newer=new.get('published_at','')>=old.get('published_at','')
    for src in generated.rglob('*'):
     if not src.is_file() or src.is_symlink():continue
     rel=src.relative_to(generated);dest=public/rel
     immutable=rel.parts[0] in {'releases','settled','scorecards'}
     if not immutable and not (len(rel.parts)==1 and rel.name in MUTABLE):continue
     if immutable and dest.exists():
      if src.read_bytes()!=dest.read_bytes():raise RuntimeError('Immutable research record differs: '+str(rel))
      continue
     if not immutable and not newer:continue
     dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dest)
    if newer:
     status=load(public/'runner-status.json')
     status.update(publication='committed_by_weekly_workflow',workflow_run_id=os.getenv('GITHUB_RUN_ID'),source_commit=os.getenv('GITHUB_SHA'),publication_attempted_at=dt.datetime.now(dt.timezone.utc).isoformat())
     (public/'runner-status.json').write_text(json.dumps(status,indent=2))
    git('config','user.name','Milly research bot',cwd=target);git('config','user.email','milly-bot@users.noreply.github.com',cwd=target)
    git('add','milly/public',cwd=target)
    if not git('diff','--cached','--name-only',cwd=target):print('No new publication');return
    git('commit','-m','Milly: publish frozen weekly evidence [skip ci]',cwd=target)
    push=subprocess.run(['git','push','origin','HEAD:main'],cwd=target,text=True,capture_output=True)
    if push.returncode==0:
     print('PUBLISHED_COMMIT',git('rev-parse','HEAD',cwd=target));return
    print('Concurrent push or permission failure; retry',attempt+1,push.stderr)
   finally:git('worktree','remove','--force',str(target))
  raise RuntimeError('Publication failed after three normal push attempts; no force-push performed')
if __name__=='__main__':main()
