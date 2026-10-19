"""Grade archived Milly releases without training: refresh the free nflverse schedule and
current-season player stats, then score every release whose games are final."""
import json, datetime as dt, traceback
import run
from run import core, ROOT

if __name__ == '__main__':
    try:
        core.CACHE.mkdir(parents=True, exist_ok=True)
        if not list((ROOT / 'public' / 'archive').glob('*.json')):
            print('No archived releases to grade yet.')
        else:
            core.get('schedule', 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv')
            y = core.YEAR
            core.get('stats_' + str(y), f'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{y}.csv')
            run.grade_archives()
            print(json.dumps(json.loads((ROOT / 'public' / 'scorecard.json').read_text())['releases_scored']))
    except Exception as e:
        core.save(ROOT / 'public' / 'grading-health.json', {'status': 'failed', 'error': str(e), 'at': dt.datetime.now(dt.timezone.utc).isoformat()})
        traceback.print_exc()
        raise
