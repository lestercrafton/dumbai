import unittest
from grading import simulate_field, grade_lineups


def pool():
    ps = []
    spec = [('QB', 6000, 18)] * 4 + [('RB', 6000, 12)] * 8 + [('WR', 5500, 11)] * 10 + [('TE', 4000, 8)] * 4 + [('DST', 3000, 6)] * 4
    for k, (pos, sal, mu) in enumerate(spec):
        ps.append({'i': k, 'position': pos, 'salary': sal + (k % 5) * 200, 'mu': mu, 'game': 'A@B' if k % 2 else 'C@D'})
    return ps


class GradingTest(unittest.TestCase):
    def test_field_respects_roster_and_salary(self):
        ps = pool()
        field = simulate_field(ps, n=500, seed=1)
        for row in field[:100]:
            positions = [ps[k]['position'] for k in row]
            self.assertEqual(positions.count('QB'), 1)
            self.assertEqual(positions.count('DST'), 1)
            self.assertEqual(len(set(row)), 9)
            self.assertLessEqual(sum(ps[k]['salary'] for k in row), 50000)

    def test_percentile_orders_lineups(self):
        ps = pool()
        values = {p['i']: (40.0 if p['i'] in (0, 4, 5, 12, 13, 14, 22, 6, 26) else 5.0) for p in ps}
        lineups = [{'rank': 1, 'ids': [0, 4, 5, 12, 13, 14, 22, 6, 26]}, {'rank': 2, 'ids': [1, 7, 8, 15, 16, 17, 23, 9, 27]}]
        out, summary = grade_lineups(ps, values, lineups, n=2000, seed=2)
        self.assertGreater(out[0]['estimated_field_percentile'], 99)
        self.assertLess(out[1]['estimated_field_percentile'], out[0]['estimated_field_percentile'])
        self.assertIn('not the real contest', summary['label'])


if __name__ == '__main__':
    unittest.main()
