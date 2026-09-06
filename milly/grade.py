"""Postmortems run even when the next slate cannot be generated.
Prediction releases are immutable; later stat corrections create versioned grading revisions.
"""
import datetime as dt,hashlib,json,pathlib
import numpy as np,pandas as pd
from model import ROOT,PUBLIC,TEAM_MAP,read,num,offense_points,pa_points,clean,metrics,write

def run():
    folder=PUBLIC/'releases'
    if not folder.exists():write('scorecard.json',{'settled_releases':0,'releases':[]});return
    records=[]
    for p in sorted(folder.glob('*.json')):
        a=json.loads(p.read_text())
        if 'run_id' in a and pd.Timestamp(a['published_at'])<pd.Timestamp(a['lock']):records.append((p,a))
    s=read('schedule');s=s[s.home_score.notna()&s.away_score.notna()].copy()
    for key in ['home_team','away_team']:s[key]=s[key].replace(TEAM_MAP)
    years={int(g.split('_')[0]) for _,a in records for g in a['game_ids']};frames=[]
    for y in sorted(years):
        q=read(f'stats_{y}')
        if not q.empty:frames.append(q)
    if not frames:write('scorecard.json',{'settled_releases':0,'releases':[]});return
    st=pd.concat(frames,ignore_index=True);st['team']=st.team.replace(TEAM_MAP);st['actual']=offense_points(st)
    actual=st.groupby(['game_id','player_id']).actual.sum().to_dict();present=set(st.game_id)&set(s.game_id)
    cols=['def_sacks','def_interceptions','def_tds','def_safeties','def_punt_blocks','def_fg_blocks','def_pat_blocks','special_teams_tds','fumble_recovery_opp']
    by=st.groupby(['game_id','team'])[cols].sum();dst={}
    for g in s.itertuples():
        for own,opp,points in [(g.home_team,g.away_team,g.away_score),(g.away_team,g.home_team,g.home_score)]:
            if (g.game_id,own) not in by.index or (g.game_id,opp) not in by.index:continue
            a=by.loc[(g.game_id,own)];b=by.loc[(g.game_id,opp)]
            allowed=max(0,points-6*b.def_tds)
            dst[g.game_id,own]=float(a.def_sacks+2*(a.def_interceptions+a.fumble_recovery_opp+a.def_safeties+a.def_punt_blocks+a.def_fg_blocks+a.def_pat_blocks)+6*(a.def_tds+a.special_teams_tds)+pa_points(np.array([allowed]))[0])
    results=[];out=PUBLIC/'settled';out.mkdir(exist_ok=True);revisions=out/'revisions';revisions.mkdir(exist_ok=True)
    for path,a in records:
        if not set(a['game_ids'])<=present:continue
        mapping=a.get('game_map',{});points={}
        for p in a['players']:
            game=mapping.get(p['game'])
            if game is None:break
            points[p['id']]=dst[(game,p['team'])] if p['pos']=='DST' else float(actual.get((game,p['player_id']),0))
        if len(points)!=len(a['players']):continue
        value={'run_id':a['run_id'],'slate':a['slate'],'published_at':a['published_at'],'lineup_scores':[{'rank':l['rank'],'points':round(sum(points[i] for i in l['ids']),2)} for l in a['lineups']],'forecast_metrics':metrics([points[p['id']] for p in a['players']],[p['mean'] for p in a['players']]),'actual_contest_ranks':None,'actual_roi':None,'note':'Observed paper-lineup scores, not real entered-contest ranks or returns. Rare defensive scoring is approximate.'}
        dest=out/path.name;previous=json.loads(dest.read_text()) if dest.exists() else None
        same=previous and previous.get('lineup_scores')==clean(value['lineup_scores']) and previous.get('forecast_metrics')==clean(value['forecast_metrics'])
        if same:results.append(previous);continue
        revision=1 if previous is None else previous.get('revision',1)+1
        if previous:
            saved=revisions/f"{a['run_id']}-r{revision-1}.json"
            if not saved.exists():saved.write_text(json.dumps(previous,allow_nan=False))
        value.update(revision=revision,settled_at=dt.datetime.now(dt.timezone.utc).isoformat(),revises_sha256=hashlib.sha256(json.dumps(previous,sort_keys=True).encode()).hexdigest() if previous else None)
        tmp=dest.with_suffix('.tmp');tmp.write_text(json.dumps(clean(value),allow_nan=False));tmp.replace(dest);results.append(value)
    write('scorecard.json',{'settled_releases':len(results),'releases':results,'stat_corrections_versioned':True})
if __name__=='__main__':run()
