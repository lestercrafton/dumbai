#!/usr/bin/env python3
"""Snapshot only model-safe fields from the official MLB collector output."""
from pathlib import Path
from collections import Counter
import datetime as dt,hashlib,json,math,os
ROOT=Path(os.environ.get('BIG_VIN_RESEARCH_DIR',Path(__file__).resolve().parent))
SOURCE=Path(os.environ.get('BIG_VIN_MLB_DATA_DIR',Path.home()/'.local/share/big-vin/baseball-stats'))/'games.jsonl'
def finite(v):return isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v)
def main():
 raw=[json.loads(line) for line in SOURCE.read_text().splitlines() if line.strip()]
 assert len({str(g['gamePk']) for g in raw})==len(raw)
 assert {2024,2025,2026}.issubset({int(g['season']) for g in raw}), 'Wait for all requested seasons before fitting.'
 selected=[];sources={}
 for g in raw:
  date=g['startTime'][:10];reason=None
  if g['gameType']!='R':reason='Postseason/non-regular season excluded by protocol.'
  elif g.get('hasResumeOrRescheduleFlag'):reason='Suspended/resumed/rescheduled metadata:conservative availability exclusion.'
  elif not all(finite(g.get(k)) and g[k]>=0 for k in ('homeRuns','awayRuns')):reason='Missing or invalid final runs.'
  elif g['homeRuns']==g['awayRuns']:reason='Tied final game excluded.'
  elif date<'2024-03-01' or date>'2026-09-16':reason='Outside registered UTC source/target dates.'
  r={'id':str(g['gamePk']),'date':date,'officialDate':g['officialDate'],'startTime':g['startTime'],'homeId':str(g['homeId']),'awayId':str(g['awayId']),'home':g.get('home'),'away':g.get('away'),'homeScore':g.get('homeRuns'),'awayScore':g.get('awayRuns'),'neutral':False,'venueId':g.get('venueId'),'excludeReason':reason}
  for side in ('home','away'):
   r[side+'Stats']={}
   for group,fields in [('batting',['hits','baseOnBalls','strikeOuts','homeRuns','plateAppearances']),('pitching',['hits','baseOnBalls','strikeOuts','homeRuns','outs','numberOfPitches'])]:
    r[side+'Stats'][group]={k:g.get(f'{side}_{group}_{k}') if finite(g.get(f'{side}_{group}_{k}')) else None for k in fields}
    url=g.get(f'{side}_{group}_sourceUrl');digest=g.get(f'{side}_{group}_sourceSha256')
    if url:sources[(url,digest)]={'url':url,'sha256':digest,'fetchedAt':g.get(f'{side}_{group}_sourceFetchedAt')}
  sources[(g['scheduleSourceUrl'],g['scheduleSourceSha256'])]={'url':g['scheduleSourceUrl'],'sha256':g['scheduleSourceSha256'],'fetchedAt':g['scheduleSourceFetchedAt']}
  selected.append(r)
 out={'preparedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'games':selected,'provenance':{'file':str(SOURCE),'sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),'sourceRows':len(raw),'perSeason':dict(Counter(g['season'] for g in raw)),'sources':list(sources.values()),'timing':'Retrospective final data; UTC full-day embargo and conservative flagged-game exclusions. Original officialDate retained for auditing but chronology uses startTime UTC date.','parkPolicy':'Venue ID as recorded in official historical schedule; not a timestamped pregame capture. Every rating/rolling run-environment estimate uses only older results.','neutralPolicy':'Official designated home/away role used, matching current MLB score-rating feed behavior; no inferred neutral adjustment.','excludedFields':['target actual/final starter or probablePitcher','final weather','attendance','fielding errors','future-next-game fields','season totals']}}
 (ROOT/'canonical-inputs.json').write_text(json.dumps(out,indent=2)+'\n')
 print(json.dumps({'sourceRows':len(raw),'perSeason':out['provenance']['perSeason'],'exclusions':dict(Counter(r['excludeReason'] for r in selected if r['excludeReason'])),'eligible':sum(r['excludeReason'] is None for r in selected)},indent=2))
if __name__=='__main__':main()
