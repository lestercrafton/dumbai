"""Export validated stored draws for a separate scenario interface. No belief enters training."""
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parent
P=ROOT/'public'
def matrix(v):return isinstance(v,list) and bool(v) and isinstance(v[0],list)
def walk(d,prefix=''):
    if isinstance(d,dict):
        for k,v in d.items():
            yield prefix+k,v
            if isinstance(v,dict):yield from walk(v,prefix+k+'.')
def run():
    w=json.loads((P/'world-lab.json').read_text());r=json.loads((P/'latest.json').read_text())
    players=w['players'];scores=w['scores_cents'];N=len(scores);PN=len(players)
    assert all(len(a)==PN for a in scores),'Irregular player score matrix'
    candidates=None;ck=None
    for k,v in walk(w):
        if matrix(v) and len(v[0])==9 and len(v)>20 and all(isinstance(x,int) and 0<=x<PN for x in v[0]):candidates=v;ck=k;break
    if candidates is None:
        for k,v in walk(w):
            if isinstance(v,list) and v and isinstance(v[0],dict):
                for field in ('indices','players','lineup'):
                    ix=v[0].get(field)
                    if isinstance(ix,list) and len(ix)==9 and all(isinstance(x,int) and 0<=x<PN for x in ix):candidates=[a[field] for a in v];ck=k+'.'+field;break
                if candidates is not None:break
    if candidates is None:
        lookup={str(p['id']):i for i,p in enumerate(players)}
        candidates=[[lookup[str(p['id'])] for p in a['players']] for a in r['lineups']];ck='latest.lineups (20 only)'
    verified=[]
    for a in candidates:
        if len(a)!=9 or len(set(a))!=9:continue
        ps=[players[i] for i in a];counts={pos:sum(p['position']==pos for p in ps) for pos in ['QB','RB','WR','TE','DST']}
        if counts['QB']!=1 or counts['DST']!=1 or not (2<=counts['RB']<=3 and 3<=counts['WR']<=4 and 1<=counts['TE']<=2):continue
        if sum(p['salary'] for p in ps)>50000 or len({p['game_id'] for p in ps})<2:continue
        verified.append(a)
    assert len(verified)>=20,'Insufficient validated candidate bank'
    bench=None;bk=None
    for k,v in walk(w):
        if isinstance(v,list) and len(v)==N and v and isinstance(v[0],(int,float)) and any(t in k.lower() for t in ('best','benchmark','field')):bench=v;bk=k;break
    if bench is None:bench=[max(sum(row[i] for i in a) for a in verified) for row in scores];bk='maximum in candidate bank, not an opponent field'
    elif 'cent' not in bk.lower() and max(bench)<1000:bench=[round(v*100) for v in bench]
    game_ids=list(dict.fromkeys(p['game_id'] for p in players));mapped={}
    for k,v in walk(w):
        if k.split('.')[-1] in game_ids and matrix(v) and len(v)==N and len(v[0])==2:mapped[k.split('.')[-1]]=v
    client={'release_id':r['release_id'],'created_at':r['created_at'],'expires_at':r['expires_at'],'players':players,'scores_cents':scores,'candidates':verified,'benchmark_cents':bench,'selection_count':w['selection_count'],'game_worlds':mapped,'source_fields':{'candidates':ck,'benchmark':bk},'limitations':['Research candidate reranking, not a global search or actual contest win probability.','Player-threshold conditions supported; game conditions require explicitly mapped paired team scores.','No automatic contest submission, payments or server-side collection of user beliefs.']}
    tmp=P/'client-lab.tmp';tmp.write_text(json.dumps(client,separators=(',',':'),allow_nan=False));tmp.replace(P/'client-lab.json')
    return {'candidates':len(verified),'players':PN,'worlds':N,'games_mapped':len(mapped),'candidate_source':ck,'benchmark_source':bk}
if __name__=='__main__':print(json.dumps(run(),indent=2))
