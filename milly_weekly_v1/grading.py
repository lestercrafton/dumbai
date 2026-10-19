"""After-slate grading for Milly releases: actual DK points per released lineup and an
estimated finish percentile against a simulated field.

The field is an estimate, not the real contest: entrants are simulated as salary-constrained
DraftKings classic lineups (QB, 2 RB, 3 WR, TE, FLEX, DST; 48,000-50,000 salary) drawn from the
actual player pool, with players chosen in proportion to their pre-slate forecast mean squared
(a stand-in for popularity). Actual points come from free public nflverse stats.
"""
import numpy as np

SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'DST']
FIELD_METHOD = 'simulated-salary-constrained-field-v1'


def simulate_field(players, n=20000, seed=0, min_salary=48000, cap=50000, max_tries=40):
    """Return an array of lineups (index lists) drawn from players [{'i','position','salary','mu'}]."""
    rng = np.random.default_rng(seed)
    by_pos = {}
    for k, p in enumerate(players):
        by_pos.setdefault(p['position'], []).append(k)
    flex = by_pos.get('RB', []) + by_pos.get('WR', []) + by_pos.get('TE', [])
    pools = {pos: np.array(by_pos.get(pos, [])) for pos in ['QB', 'RB', 'WR', 'TE', 'DST']}
    pools['FLEX'] = np.array(flex)
    weight = {}
    for pos, idx in pools.items():
        if len(idx) == 0:
            raise ValueError(f'No {pos} players in the pool')
        w = np.array([max(players[k].get('mu', 0) or 0, 0.1) ** 2 for k in idx])
        weight[pos] = w / w.sum()
    salary = np.array([players[k]['salary'] for k in range(len(players))])
    field = []
    attempts = 0
    while len(field) < n and attempts < n * max_tries:
        attempts += 1
        chosen = []
        for slot in SLOTS:
            idx, w = pools[slot], weight[slot]
            for _ in range(10):
                k = int(rng.choice(idx, p=w))
                if k not in chosen:
                    break
            chosen.append(k)
        if len(set(chosen)) != 9:
            continue
        s = int(salary[chosen].sum())
        if min_salary <= s <= cap:
            field.append(chosen)
    if len(field) < n // 10:
        raise ValueError('Could not simulate a usable field from this pool')
    return np.array(field)


def grade_lineups(players, values, lineups, n=20000, seed=0):
    """players: release player records (with 'i'); values: {i: actual points}; lineups: [{'rank','ids'}]."""
    order = [p['i'] for p in players]
    pos_of = {p['i']: k for k, p in enumerate(players)}
    pts = np.array([float(values.get(i, 0.0)) for i in order])
    field = simulate_field(players, n=n, seed=seed)
    field_points = pts[field].sum(axis=1)
    out = []
    for l in lineups:
        total = float(sum(pts[pos_of[i]] for i in l['ids']))
        out.append({'rank': l['rank'], 'points': round(total, 2),
                    'estimated_field_percentile': round(float((field_points < total).mean() * 100), 2),
                    'estimated_field_rank_per_100k': int(round((field_points >= total).mean() * 100000)) + 1})
    summary = {'method': FIELD_METHOD, 'field_size': int(len(field)), 'seed': seed,
               'field_points_p50': round(float(np.median(field_points)), 2),
               'field_points_p99': round(float(np.quantile(field_points, .99)), 2),
               'field_points_max': round(float(field_points.max()), 2),
               'label': 'Estimate against a simulated field, not the real contest standings.'}
    return out, summary
