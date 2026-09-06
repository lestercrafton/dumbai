"""Scheduled Milly run: fetch in collect.py; train, audit, publish immutable releases here."""
from __future__ import annotations
import datetime as dt,hashlib,json,os,pathlib,traceback
import pandas as pd
from forecast import ROOT,discover,datasets,train,fit_team
PUBLIC=ROOT/'public';PUBLIC.mkdir(exist_ok=True)

def save(name,value):
    p=PUBLIC/name;p.parent.mkdir(parents=True,exist_ok=True)
    s=json.dumps(value,ensure_ascii=False,indent=2,default=str,allow_nan=False)
    tmp=p.with_suffix('.tmp');tmp.write_text(s);tmp.replace(p)

def run():
    started=dt.datetime.now(dt.timezone.utc).isoformat()
    save('run-status.json',{'status':'running','started_at':started,'version':'1.0','last_release_is_not_automatically_current':True})
    try:
        audit=json.loads((PUBLIC/'source-audit.json').read_text())
        pool,contest,source=discover(audit);print('Official unique pool',len(pool),'contest',contest['id'],flush=True)
        d,t,pool,stats,quality,features,volume,tf=datasets(pool);print('History rows',quality['historical_rows'],flush=True)
        future,calibration,report,backtests=train(d,features,volume);print('Champion',report['champion'],'2025',report['evaluation']['2025'],flush=True)
        teams,teamcal,teamreport=fit_team(t,tf);report['team_scores']=teamreport
        report['data_quality']=quality;report['computed_at']=started;report['code_sha']=os.environ.get('GITHUB_SHA','local')
        save('model-report.json',report)
        keep=['player_id','game_id','position','team','opp','mu','resid_key','history_n','days_since','team_change']
        projections=pool.merge(future[keep],on=['player_id','game_id','position','team','opp'],how='left',validate='1:1')
        projections.to_csv(ROOT/'cache'/'current_projections.csv.gz',index=False,compression='gzip')
        calibration.to_csv(ROOT/'cache'/'calibration.csv.gz',index=False,compression='gzip')
        teamcal.to_csv(ROOT/'cache'/'teamcal.csv.gz',index=False,compression='gzip')
        teams.to_csv(ROOT/'cache'/'team_projections.csv.gz',index=False,compression='gzip')
        for yr,b in backtests.items():b[['game_id','player_id','position','team','season','week','dk','mu','q90']].to_csv(ROOT/'cache'/f'predictions_{yr}.csv.gz',index=False,compression='gzip')
        if (ROOT/'engine.py').exists():
            from engine import generate,over_under
            release,worlds=generate(projections,teams,calibration,teamcal,report,contest,source)
            hypotheses=over_under(t,stats)
            save('hypotheses.json',hypotheses)
            rid=release['release_id'];save('releases/'+rid+'.json',release)
            save('latest.json',release);save('world-lab.json',worlds)
            from html import escape
            rss=f'''<?xml version="1.0"?><rss version="2.0"><channel><title>Milly — Weekly research</title><link>https://milly-weekly-lester-crafton.vercel.app</link><description>Independent forecasts and scenario research. No guaranteed outcomes.</description><item><title>{escape(rid)}</title><guid>{escape(rid)}</guid><description>{escape(release['summary'])}</description><link>https://milly-weekly-lester-crafton.vercel.app</link></item></channel></rss>'''
            (PUBLIC/'feed.xml').write_text(rss)
            save('run-status.json',{'status':'published_research','started_at':started,'completed_at':dt.datetime.now(dt.timezone.utc).isoformat(),'release_id':rid,'lineups':len(release['lineups']),'entry_ready':False,'training_completed':True})
        else:save('run-status.json',{'status':'trained_no_lineup_stage_yet','started_at':started,'completed_at':dt.datetime.now(dt.timezone.utc).isoformat(),'training_completed':True})
    except Exception as e:
        save('run-status.json',{'status':'withheld','started_at':started,'failed_at':dt.datetime.now(dt.timezone.utc).isoformat(),'error':str(e),'previous_releases_retained_not_relabelled':True})
        traceback.print_exc();raise
if __name__=='__main__':run()
