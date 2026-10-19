"""Decide whether this workflow run should train and publish.

Scheduled starts on GitHub can arrive hours late, so the decision is once per
contest rather than tied to the cron hour: a scheduled run goes ahead on any of
Milly's scheduled Central days unless a release for the upcoming contest already
exists. Manual and code-change runs always go ahead.
"""
from __future__ import annotations
import datetime as dt,json,os,pathlib,sys,zoneinfo
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
import contest
CENTRAL=zoneinfo.ZoneInfo('America/Chicago')
SCHEDULED_DAYS={1:'Tuesday',2:'Wednesday',5:'Saturday',6:'Sunday'}
PUB=pathlib.Path(__file__).resolve().parent/'public'

def decide(event,now,lobby=None,lobby_error=None,pub=PUB):
 local=now.astimezone(CENTRAL)
 if event!='schedule':return True,f'{event} run; always runs.',None
 if local.weekday() not in SCHEDULED_DAYS:return False,f'Scheduled start arrived on {local:%A} Central, outside the Tue/Wed/Sat/Sun schedule.',None
 if lobby is None:return True,f'Could not read the DraftKings lobby ({lobby_error}); running so the model run reports the source problem.',None
 options=contest.millionaire_options(lobby,now)
 if not options:return True,'No qualifying Sunday Millionaire is listed yet; running so the model run reports it.',None
 target=contest.summary(options[0]);existing=contest.release_for(pub,options)
 if existing:return False,f"Release {existing.get('release_id')} already exists for {(existing.get('contest') or {}).get('name')} (draft group {(existing.get('contest') or {}).get('draft_group')}).",target
 return True,f"No release yet for {target['name']} (draft group {target['draft_group']}).",target

def main():
 now=dt.datetime.now(dt.timezone.utc);event=os.environ.get('EVENT','workflow_dispatch');lobby=error=None
 if event=='schedule':
  try:lobby=contest.fetch_json(contest.LOBBY_URL,timeout=45)
  except Exception as e:error=str(e)
 run,reason,target=decide(event,now,lobby,error)
 print('Local Central time',now.astimezone(CENTRAL).isoformat(),'run',run,'-',reason)
 out=os.environ.get('GITHUB_OUTPUT')
 if out:
  with open(out,'a') as f:f.write(f'run={str(run).lower()}\nreason={reason.replace(chr(10)," ")}\ncontest={json.dumps(target)}\n')
if __name__=='__main__':main()
