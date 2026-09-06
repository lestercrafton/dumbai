"""Validated independent-model weekly runner. Earlier pipeline remains preserved.
Fresh data -> historical model selection -> held-out evaluation -> legal lineups -> frozen release.
No contest entry, payments or collection of private customer data.
"""
import datetime as dt,hashlib,html,json,os,time,csv
import numpy as np,pandas as pd
from model import *
from lineups import *
from research import run_research
SITE='https://milly-weekly-lester-crafton.vercel.app'

def freshness(now,season):
    a=json.loads((PUBLIC/'source-audit.json').read_text());good={x['name']:x for x in a['sources'] if x['ok']}
    for key in ['schedule','dk_groups','dk_lobby','roster_current',f'rosters_{season}',f'depth_{season}']:
        if key not in good:raise ValueError('Required fresh source missing: '+key)
        if now-pd.Timestamp(good[key]['retrieved_at'])>pd.Timedelta(hours=3):raise ValueError('Stale source: '+key)
    d=read(f'depth_{season}')
    if 'dt' not in d or now-pd.to_datetime(d.dt,utc=True).max()>pd.Timedelta(days=3):raise ValueError('Current depth observations are stale')
    return a

def validate_release(a,w):
    f=pd.DataFrame(a['players']);assert len(a['lineups'])==20
    assert len({tuple(sorted(x['ids'])) for x in a['lineups']})==20
    assert a['run_id']==w['run_id']
    for x in a['lineups']:
        assert validate(x['indices'],f)
        assert list(f.loc[x['indices'],'id'])==x['ids']
        assert int(f.loc[x['indices'],'salary'].sum())==x['salary']
        e=x['winning_world']
        if e:
            assert abs(sum(p['points'] for p in e['players'])-e['lineup_points'])<.03
            assert e['lineup_points']>e['reference_best']
    assert a['lineup_audit']['forecast_mean_alignment_max_error']<.02
    assert len({v['candidates'] for v in a['lineup_audit']['flex'].values()})==1
    assert pd.Timestamp(a['published_at'])<pd.Timestamp(a['lock'])
    assert all(p['status'] not in ['OUT','IR','INACTIVE','SUSP'] for p in a['players'])
    return {'passed':True,'checks':['20 unique legal lineups','slot identity and salary agreement','held-out witness accounting','forecast mean alignment','equal FLEX search','pre-lock publication','unavailable player exclusion','matching world-bank release']}

def settle(stats,t):
    folder=PUBLIC/'releases';destdir=PUBLIC/'settled';destdir.mkdir(exist_ok=True);results=[]
    available=set(stats.game_id);actual=stats.groupby(['game_id','player_id']).fpts.sum().to_dict();teams=t[t.score.notna()].set_index(['game_id','team'])
    for path in sorted(folder.glob('*.json')) if folder.exists() else []:
        a=json.loads(path.read_text())
        if 'run_id' not in a:continue
        dest=destdir/path.name
        if dest.exists():results.append(json.loads(dest.read_text()));continue
        if not set(a['game_ids'])<=available:continue
        mapping=a.get('game_map',{p['game']:g for p in a['players'] for g in a['game_ids'] if g.endswith(p['game'].replace('@','_'))});points={}
        for p in a['players']:
            game=mapping[p['game']]
            points[p['id']]=float(teams.loc[(game,p['team']),'dst_fp']) if p['pos']=='DST' else float(actual.get((game,p['player_id']),0))
        result={'run_id':a['run_id'],'slate':a['slate'],'published_at':a['published_at'],'settled_at':dt.datetime.now(dt.timezone.utc).isoformat(),'lineup_scores':[{'rank':x['rank'],'points':sum(points[i] for i in x['ids'])} for x in a['lineups']],'forecast_metrics':metrics([points[p['id']] for p in a['players']],[p['mean'] for p in a['players']]),'actual_contest_ranks':None,'actual_roi':None,'note':'Observed paper-lineup scores, not entered contest results. Rare defensive scoring is approximate.'}
        with dest.open('x') as h:h.write(json.dumps(clean(result),allow_nan=False))
        results.append(result)
    write('scorecard.json',{'settled_releases':len(results),'releases':results})

def render(a):
    f={p['id']:p for p in a['players']};cards=[]
    for x in a['lineups']:
        rows=''.join('<tr><td>'+slot+'</td><td>'+html.escape(f[i]['name'])+'</td><td>'+f[i]['team']+'</td><td>$'+format(f[i]['salary'],',')+'</td></tr>' for slot,i in zip(SLOTS,x['ids']))
        e=x['winning_world'];note='No reference win in the evaluation sample.'
        if e:note=f"One held-out statistical world: {e['lineup_points']:.2f} fantasy points, versus {e['reference_best']:.2f} for the best synthetic reference lineup. This is not a Millionaire Maker win probability."
        cards.append(f'<article><h2>#{x["rank"]} · ${x["salary"]:,}</h2><p>Model mean {x["mean"]:.1f} · FLEX {x["flex"]}</p><table>{rows}</table><p>{html.escape(x["explanation"])}</p><p>{note}</p></article>')
    return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Milly — all twenty independent-model lineups</title><style>body{font:16px/1.6 system-ui;background:#f6f5ef;color:#173e32;max-width:920px;margin:auto;padding:24px}article{background:white;border:1px solid #d6ddd7;border-radius:16px;padding:24px;margin:20px 0}table{width:100%;border-collapse:collapse}td{padding:7px;border-bottom:1px solid #eee}h1{font:44px Georgia}a{color:#145b47}.note{background:#fff0d6;padding:20px;border-radius:12px}</style><h1>Milly’s twenty</h1><p>'+html.escape(a['slate'])+' · '+html.escape(a['published_at'])+'</p><p class="note">Independent historical model. Experimental, not a validated profitable strategy. Recheck active statuses before any entry. No analyst point forecasts are inputs.</p><p><a href="'+SITE+'">Milly’s live lab</a></p>'+''.join(cards)+'</html>'

def run():
    start=time.time();now=pd.Timestamp.now(tz='UTC');season=now.year if now.month>=3 else now.year-1
    write('runner-status.json',{'state':'running','started_at':now.isoformat()});source=freshness(now,season)
    print('BUILDING HISTORICAL FEATURES',flush=True);r,t,stats,calendar,future=dataset(now);settle(stats,t)
    current,oof,report=train(r,season);pool,manifest=salary_pool(future,now)
    if now-pd.Timestamp(manifest['fetched_at'])>pd.Timedelta(hours=3):raise ValueError('Draft group snapshot is stale')
    f,excluded=map_forecasts(pool,current,t,future);print('MODELED',len(f),'OF',len(pool),'OFFICIAL PLAYERS',flush=True)
    selected,audit,world,f=build_lineups(f,oof,t,season);research=run_research(stats,calendar,season,oof)
    stamp=pd.Timestamp.now(tz='UTC');codehash=hashlib.sha256(b''.join(p.read_bytes() for p in sorted(ROOT.glob('*.py')))).hexdigest();rid=stamp.strftime('%Y%m%dT%H%M%SZ')+'-'+codehash[:8]
    a={'version':'1.0.0','run_id':rid,'published_at':stamp.isoformat(),'lock':future.kickoff.min().isoformat(),'slate':f'NFL {season} Week {int(future.week.iloc[0])} — {future.gameday.iloc[0]} Sunday main','game_ids':future.game_id.tolist(),'game_map':{g.away_team+'@'+g.home_team:g.game_id for g in future.itertuples()},'players':f.to_dict('records'),'lineups':selected,'games':world['games'],'training':report,'lineup_audit':audit,'research':research,'pool':manifest,'coverage':{'official_players':len(pool),'modeled_players':len(f),'excluded':excluded},'independent_forecast':True,'uses_expert_projections':False,'entry_ready':False,'training_through':r.loc[~r.is_future,'kickoff'].max().isoformat(),'code_sha256':codehash,'data_receipt_sha256':hashlib.sha256(json.dumps(source,sort_keys=True).encode()).hexdigest(),'limitations':['Not demonstrated profitable against a real Millionaire Maker field.','Historical rosters and pre-2025 depth charts lack authenticated publication timestamps.','Questionable-player availability is conditional, not a learned active probability.','Statistical game-block bootstrap, not an exact event simulator.','Synthetic reference field; its win rate is not a real contest probability.','Rookie/role changes and rare defensive scoring remain weak spots.'],'schedule':{'timezone':'America/Chicago','refresh':['Wednesday 08:17','Saturday 08:17','Sunday 10:43','Sunday 11:43'],'review':['Tuesday 08:27'],'timing':'best effort; delayed runs checked against lock'},'worlds_path':'worlds.json'}
    world['run_id']=rid;checks=validate_release(a,world);(PUBLIC/'releases').mkdir(exist_ok=True)
    with (PUBLIC/'releases'/f'{rid}.json').open('x') as h:h.write(json.dumps(clean(a),ensure_ascii=False,allow_nan=False,separators=(',',':')))
    write('worlds.json',world);write('latest.next.json',a);os.replace(PUBLIC/'latest.next.json',PUBLIC/'latest.json')
    for name,value in [('training-report',report),('lineup-audit',audit),('research',research),('pool-audit',manifest),('release-checks',checks)]:write(name+'.json',value)
    (PUBLIC/'twenty.html').write_text(render(a))
    with (PUBLIC/'twenty.csv').open('w',newline='') as h:
        w=csv.writer(h);w.writerow(['Rank']+SLOTS+['Salary','Status'])
        for x in selected:w.writerow([x['rank']]+[f.loc[i,'name']+' ('+f.loc[i,'id']+')' for i in x['indices']]+[x['salary'],'EXPERIMENTAL — RECHECK BEFORE ENTRY'])
    items=[]
    for p in sorted((PUBLIC/'releases').glob('*.json'),reverse=True)[:30]:
        item=json.loads(p.read_text())
        if 'run_id' not in item:continue
        items.append('<item><title>'+html.escape(item['slate'])+'</title><link>'+SITE+'</link><guid isPermaLink="false">'+item['run_id']+'</guid><description>Independent-model research lineups and diagnostics. No winning guarantee.</description></item>')
    (PUBLIC/'feed.xml').write_text('<?xml version="1.0"?><rss version="2.0"><channel><title>Milly weekly research</title><link>'+SITE+'</link><description>Independent forecasts, tested worlds, honest scorecards.</description>'+''.join(items)+'</channel></rss>')
    write('runner-status.json',{'state':'succeeded','run_id':rid,'finished_at':stamp.isoformat(),'seconds':round(time.time()-start,1),'release_checks':checks});print('PUBLISHED',rid,flush=True)
if __name__=='__main__':
    try:run()
    except Exception as e:
        write('runner-status.json',{'state':'failed','finished_at':dt.datetime.now(dt.timezone.utc).isoformat(),'error':str(e),'last_release_preserved':True});raise
