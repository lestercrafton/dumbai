"""Scheduled training, prospective recordkeeping, validation and publication."""
from __future__ import annotations
import datetime as dt,json,os,traceback,math
import numpy as np
import pandas as pd
from forecast import ROOT,discover,datasets,train,fit_team,read,score,team,team_rows
PUBLIC=ROOT/'public';PUBLIC.mkdir(exist_ok=True)

def clean(x):
    if isinstance(x,dict):return {str(k):clean(v) for k,v in x.items()}
    if isinstance(x,(list,tuple,np.ndarray)):return [clean(v) for v in x]
    if isinstance(x,(float,np.floating)):return float(x) if math.isfinite(x) else None
    if isinstance(x,np.integer):return int(x)
    return x

def save(name,value):
    p=PUBLIC/name;p.parent.mkdir(parents=True,exist_ok=True)
    s=json.dumps(clean(value),ensure_ascii=False,indent=None if name=='world-lab.json' else 2,default=str,allow_nan=False)
    tmp=p.with_suffix('.tmp');tmp.write_text(s);tmp.replace(p)

def grade_previous():
    directory=PUBLIC/'releases'
    if not directory.exists():save('scorecard.json',{'status':'awaiting_first_completed_slate','graded':[]});return
    schedule=read('schedule');now=pd.Timestamp.now(tz='UTC');completed=schedule[schedule.home_score.notna() & schedule.away_score.notna()].copy();grades=[]
    for path in sorted(directory.glob('*.json')):
        release=json.loads(path.read_text());kick=pd.Timestamp(release['expires_at']);built=pd.Timestamp(release['created_at'])
        if kick>=now or built>=kick:continue
        wanted={p['game_id'] for line in release['lineups'] for p in line['players']}
        if not wanted.issubset(set(completed.game_id)):continue
        seasons={int(g.split('_')[0]) for g in wanted};frames=[read('stats_'+str(y),False) for y in seasons];frames=[x for x in frames if not x.empty]
        if not frames:continue
        st=pd.concat(frames,ignore_index=True);st['team']=st.team.map(team);st=st[st.game_id.isin(wanted)].drop_duplicates(['game_id','team','player_id']);st['actual']=score(st)
        if not wanted.issubset(set(st.game_id)):continue
        playerpoints={(r.game_id,str(r.player_id)):float(r.actual) for r in st.itertuples()};teams=team_rows(schedule[schedule.game_id.isin(wanted)],st)
        for r in teams.itertuples():playerpoints[(r.game_id,'DST:'+r.team)]=float(r.dst)
        results=[]
        for line in release['lineups']:
            actual=sum(playerpoints.get((p['game_id'],p['player_id']),0.) for p in line['players'])
            results.append({'rank':line['rank'],'actual_points':round(actual,2),'forecast_mean':line['model_mean'],'contest_rank':None,'cash_return':None})
        grades.append({'release_id':release['release_id'],'created_at':release['created_at'],'kickoff':release['expires_at'],'graded_at':now.isoformat(),'lineups':results,'method':'Observed player stats; DST scoring approximate; no full contest standings available'})
    save('scorecard.json',{'status':'graded' if grades else 'awaiting_completed_slate','graded':grades})

def validate_release(release,world):
    from forecast import BLOCKED
    lines=release['lineups'];assert len(lines)==20
    assert len({tuple(sorted(p['id'] for p in x['players'])) for x in lines})==20
    pool={str(p['id']):p for p in world['players']}
    for x in lines:
        ps=x['players'];assert len(ps)==9 and len({p['id'] for p in ps})==9
        assert set(p['slot'] for p in ps)=={'QB','RB1','RB2','WR1','WR2','WR3','TE','FLEX','DST'}
        assert sum(p['salary'] for p in ps)==x['salary']<=50000
        assert len({p['game_id'] for p in ps})>=2
        for p in ps:
            assert p['id'] in pool and p['salary']==pool[p['id']]['salary']
            assert str(p['status']).upper() not in BLOCKED
            assert p['position'] in (['RB','WR','TE'] if p['slot']=='FLEX' else [p['slot'].rstrip('123')])
        w=x['winning_world']
        if w:assert abs(sum(v['points'] for v in w['player_scores'])-w['lineup_score'])<.05 and w['lineup_score']>=w['benchmark_best']
    assert len(set(v['searched'] for v in release['experiments']['flex_audit'].values()))==1
    assert not release['model']['analyst_forecasts_used'] and not release['model']['ownership_used_in_forecasts']
    assert len(world['scores_cents'])==2*world['selection_count']
    assert release['release_id']==world['release_id']
    return {'status':'passed','lineups_checked':20,'checks':['unique lineups and player identities','official salaries and positions','salary cap and at least two games','no explicitly unavailable selections','winning-witness sum and benchmark comparison','balanced FLEX search','independent baseline inputs','separate conditional selection/evaluation draws','matching release identity']}

def run():
    started=dt.datetime.now(dt.timezone.utc).isoformat();save('run-status.json',{'status':'running','started_at':started,'version':'1.0','last_release_is_not_automatically_current':True})
    try:
        grade_previous()
        audit=json.loads((PUBLIC/'source-audit.json').read_text());pool,contest,source=discover(audit);print('Official unique pool',len(pool),'contest',contest['id'],flush=True)
        d,t,pool,stats,quality,features,volume,tf=datasets(pool);print('History rows',quality['historical_rows'],flush=True)
        future,calibration,report,backtests=train(d,features,volume);print('Champion',report['champion'],'2025',report['evaluation']['2025'],flush=True)
        teams,teamcal,teamreport=fit_team(t,tf);report['team_scores']=teamreport;report['data_quality']=quality;report['computed_at']=started;report['code_sha']=os.environ.get('GITHUB_SHA','local');save('model-report.json',report)
        keep=['player_id','game_id','position','team','opp','mu','resid_key','history_n','days_since','team_change']
        predictions=future[keep].dropna(subset=['player_id']);projections=pool.merge(predictions,on=['player_id','game_id','position','team','opp'],how='left',validate='m:1')
        for name,data in [('current_projections',projections),('calibration',calibration),('teamcal',teamcal),('team_projections',teams)]:data.to_csv(ROOT/'cache'/(name+'.csv.gz'),index=False,compression='gzip')
        for yr,b in backtests.items():b[['game_id','player_id','position','team','season','week','dk','mu','q90']].to_csv(ROOT/'cache'/f'predictions_{yr}.csv.gz',index=False,compression='gzip')
        from engine import generate,over_under
        release,world=generate(projections,teams,calibration,teamcal,report,contest,source);verification=validate_release(release,world);hypotheses=over_under(t,stats)
        save('verification.json',verification);save('hypotheses.json',hypotheses);rid=release['release_id'];save('releases/'+rid+'.json',release);save('world-lab.json',world);save('latest.json',release)
        from html import escape
        (PUBLIC/'feed.xml').write_text(f'''<?xml version="1.0"?><rss version="2.0"><channel><title>Milly — Weekly research</title><link>https://milly-weekly-lester-crafton.vercel.app</link><description>Independent forecasts and scenario research. No guaranteed outcomes.</description><item><title>{escape(rid)}</title><guid>{escape(rid)}</guid><description>{escape(release['summary'])}</description><link>https://milly-weekly-lester-crafton.vercel.app</link></item></channel></rss>''')
        compact={'release_id':rid,'summary':release['summary'],'model':{'training_rows':report['training_rows'],'champion':report['champion'],'evaluation':report['evaluation']},'experiments':release['experiments'],'quality':{k:v for k,v in release['quality'].items() if k not in ['excluded','uncertain_statuses']},'lineups':[{'rank':q['rank'],'salary':q['salary'],'flex':q['flex'],'players':{p['slot']:p['name'] for p in q['players']}} for q in release['lineups']]};save('summary.json',compact)
        save('run-status.json',{'status':'published_research','started_at':started,'completed_at':dt.datetime.now(dt.timezone.utc).isoformat(),'release_id':rid,'lineups':len(release['lineups']),'entry_ready':False,'training_completed':True,'validation_passed':True})
    except Exception as e:
        save('run-status.json',{'status':'withheld','started_at':started,'failed_at':dt.datetime.now(dt.timezone.utc).isoformat(),'error':str(e),'previous_releases_retained_not_relabelled':True});traceback.print_exc();raise
if __name__=='__main__':run()
