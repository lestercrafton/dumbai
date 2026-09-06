"""Execute Milly's complete research release, publishing only a successful run.

A failed collection, model run, or test leaves the previous published release
unchanged and records a failed heartbeat. No contest entries or purchases occur.
"""
from __future__ import annotations
import datetime as dt, hashlib, json, os, pathlib, shutil, subprocess, sys, tempfile, traceback
ROOT = pathlib.Path(__file__).resolve().parent
PUBLIC = ROOT / 'public'
PUBLIC.mkdir(parents=True, exist_ok=True)
START = dt.datetime.now(dt.timezone.utc)
RUN_ID = os.environ.get('GITHUB_RUN_ID', START.strftime('%Y%m%dT%H%M%SZ'))
RUN_URL = ('https://github.com/' + os.environ.get('GITHUB_REPOSITORY', 'lestercrafton/dumbai')
           + '/actions/runs/' + RUN_ID) if os.environ.get('GITHUB_RUN_ID') else None

def atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.new')
    temporary.write_bytes(data)
    os.replace(temporary, path)

def write_health(status, **extra):
    payload = {'status': status, 'run_id': RUN_ID, 'run_url': RUN_URL,
               'started_at': START.isoformat(),
               'checked_at': dt.datetime.now(dt.timezone.utc).isoformat(), **extra}
    atomic(PUBLIC / 'runner-health.json', json.dumps(payload, indent=2).encode())

def execute():
    write_health('running', note='Previous successful release stays visible until this refresh passes.')
    logs = []
    with tempfile.TemporaryDirectory(prefix='milly-run-') as directory:
        work = pathlib.Path(directory)
        for filename in ('collect.py', 'pipeline.py', 'engine.py', 'test_pipeline.py'):
            source = ROOT / filename
            if source.exists():
                shutil.copy2(source, work / filename)
        if (ROOT / 'site').exists():
            shutil.copytree(ROOT / 'site', work / 'site')
        # Give any evaluation/archive code access to the prior immutable record,
        # but remove latest from staging so old output cannot pass as a new run.
        if (PUBLIC / 'archive').exists():
            shutil.copytree(PUBLIC / 'archive', work / 'public' / 'archive')
        for script in ('collect.py', 'pipeline.py', 'test_pipeline.py'):
            process = subprocess.run([sys.executable, str(work / script)], cwd=work,
                                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                     text=True, timeout=1100)
            logs.append('=== ' + script + ' ===\n' + process.stdout)
            print(logs[-1], flush=True)
            if process.returncode:
                raise RuntimeError(script + ' exited ' + str(process.returncode))
        output = work / 'public'
        if not (output / 'latest.json').exists():
            output = work
        latest = output / 'latest.json'
        if not latest.exists():
            raise RuntimeError('Engine completed without a new latest.json; not publishing')
        release = json.loads(latest.read_text())
        if not isinstance(release, dict):
            raise ValueError('Latest release must be a JSON object')
        # These are the exact executed sources, not retyped versions.
        for filename in ('engine.py', 'test_pipeline.py', 'source-release.json'):
            source = work / filename
            if source.exists():
                shutil.copy2(source, ROOT / filename)
        if (work / 'site').exists():
            shutil.copytree(work / 'site', ROOT / 'site', dirs_exist_ok=True)
        allowed = {'latest.json', 'model-report.json', 'research-report.json', 'test-report.json',
                   'predictions.csv', 'lineups.csv', 'top-twenty.csv', 'twenty.csv',
                   'feed.xml', 'source-audit.json', 'contest-discovery.json', 'model-card.md'}
        entries = []
        archive = PUBLIC / 'archive' / RUN_ID
        for name in sorted(allowed):
            candidates = [output / name, work / name, work / 'public' / name]
            source = next((p for p in candidates if p.is_file()), None)
            if source is None:
                continue
            data = source.read_bytes()
            atomic(archive / name, data)
            # Write latest last after all supporting evidence has been stored.
            if name != 'latest.json':
                atomic(PUBLIC / name, data)
            entries.append({'file': name, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
        atomic(archive / 'execution.log', '\n'.join(logs).encode())
        manifest = {'run_id': RUN_ID, 'run_url': RUN_URL, 'created_at': START.isoformat(),
                    'files': entries, 'source_blob': '29fce5a966535433339409f548bd12b55b63bf20',
                    'publication': 'independent research model; no analyst point forecasts or user beliefs in baseline'}
        atomic(archive / 'manifest.json', json.dumps(manifest, indent=2).encode())
        atomic(PUBLIC / 'latest.json', latest.read_bytes())
        atomic(PUBLIC / 'release-manifest.json', json.dumps(manifest, indent=2).encode())
        write_health('success', latest_archive='archive/' + RUN_ID,
                     note='Collection, model execution and model tests finished; this is research, not proof of profit.')
        print(json.dumps({'status': 'success', 'run_id': RUN_ID, 'published_files': entries}), flush=True)

if __name__ == '__main__':
    try:
        execute()
    except Exception as error:
        write_health('failed', error=str(error),
                     note='The previous successful release was retained. Do not interpret stale lineups as refreshed.')
        traceback.print_exc()
        raise SystemExit(1)
