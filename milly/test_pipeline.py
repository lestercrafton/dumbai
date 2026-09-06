"""Regression checks for independent forecasts, chronological evaluation and legal lineups."""
import unittest,json,datetime as dt,unittest.mock as mock
import numpy as np,pandas as pd
from forecast import score,normalize,PUBLIC
from pipeline import fresh_sources,verify_release
from lineups import valid,simulate
class Rules(unittest.TestCase):
 def test_passing_and_bonus(self):self.assertAlmostEqual(float(score(pd.DataFrame([{'passing_yards':300,'passing_tds':3,'passing_interceptions':1}])).iloc[0]),26)
 def test_receptions_rushing_and_fumbles(self):self.assertAlmostEqual(float(score(pd.DataFrame([{'receiving_yards':100,'receptions':8,'receiving_tds':1,'rushing_yards':100,'rushing_tds':1,'rushing_fumbles_lost':1}])).iloc[0]),45)
 def test_conversions_returns(self):self.assertEqual(float(score(pd.DataFrame([{'passing_2pt_conversions':1,'rushing_2pt_conversions':1,'receiving_2pt_conversions':1,'special_teams_tds':1}])).iloc[0]),12)
 def test_zero_game_retained(self):self.assertEqual(float(score(pd.DataFrame([{}])).iloc[0]),0)
 def test_identity_suffix(self):self.assertEqual(normalize('Brian Thomas Jr.'),normalize('Brian Thomas'))
 def test_missing_source_fails(self):
  with mock.patch('pathlib.Path.read_text',return_value=json.dumps({'sources':[]})):
   with self.assertRaises(ValueError):fresh_sources(123)
 def test_stale_source_fails(self):
  names=['schedule','roster_current','dk_lobby','dk_pool_123','depth_2026'];a={'season':2026,'sources':[{'name':n,'ok':True,'retrieved_at':'2026-01-01T00:00:00+00:00'} for n in names]}
  with mock.patch('pathlib.Path.read_text',return_value=json.dumps(a)):
   with self.assertRaises(ValueError):fresh_sources(123,dt.datetime(2026,9,6,tzinfo=dt.timezone.utc))
class Release(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.r=json.loads((PUBLIC/'latest.json').read_text());cls.p=cls.r['players']
 def test_all_invariants(self):self.assertTrue(verify_release(self.r))
 def test_ids_unique(self):self.assertEqual(len({p['player_id'] for p in self.p}),len(self.p))
 def test_twenty_distinct(self):self.assertEqual(len({tuple(l['indices']) for l in self.r['lineups']}),20)
 def test_full_slate(self):self.assertGreaterEqual(self.r['coverage']['official_distinct_players'],len(self.p))
 def test_forbidden_features(self):
  for name in self.r['model']['features']:
   for forbidden in ['salary','ownership','consensus','total_line','belief','actual','team_score_current']:self.assertNotIn(forbidden,name)
 def test_no_current_boxscores(self):self.assertNotIn('dk',self.r['model']['features']);self.assertNotIn('targets',self.r['model']['features'])
 def test_training_precedes_evaluation(self):
  for e in self.r['model']['evaluations']:self.assertLess(max(e['train_seasons']),e['season'])
 def test_all_flex_searched(self):
  c=self.r['diagnostics']['flex_search_attempts'];self.assertEqual(set(c),{'RB','WR','TE'});self.assertLessEqual(max(c.values())-min(c.values()),2)
 def test_no_analyst_inputs(self):self.assertFalse(self.r['human_projection_inputs'])
 def test_no_actual_win_probability(self):self.assertFalse(self.r['entry_ready']);self.assertIn('candidate bank',self.r['diagnostics']['objective'])
 def test_future_at_generation(self):self.assertGreater(pd.Timestamp(self.r['slate_start']),pd.Timestamp(self.r['generated_at']))
 def test_every_lineup_legal(self):
  for l in self.r['lineups']:self.assertTrue(valid(self.p,l['indices']))
 def test_duplicate_invalid(self):
  ix=self.r['lineups'][0]['indices'][:];ix[0]=ix[1];self.assertFalse(valid(self.p,ix))
 def test_too_few_invalid(self):self.assertFalse(valid(self.p,self.r['lineups'][0]['indices'][:8]))
 def test_salary_sum(self):
  for l in self.r['lineups']:self.assertEqual(l['salary'],sum(p['salary'] for p in l['players']))
 def test_mean_sum(self):
  for l in self.r['lineups']:self.assertAlmostEqual(l['projected_mean'],sum(p['mean'] for p in l['players']),delta=.01)
 def test_world_sum(self):
  for l in self.r['lineups']:self.assertAlmostEqual(l['world']['lineup_points'],sum(p['witness_points'] for p in l['players']),delta=.08)
 def test_world_win_label(self):
  for l in self.r['lineups']:
   if l['world']['beats_peer_bank']:self.assertGreaterEqual(l['world']['lineup_points']+.02,l['world']['peer_best'])
 def test_no_unavailable(self):
  for p in self.p:self.assertNotIn(p['status'],['IR','OUT','O','D','SUSP'])
 def test_starting_qbs(self):
  for p in self.p:
   if p['pos']=='QB':self.assertEqual(p['depth'],1)
 def test_reproducible(self):
  a=simulate(self.p,self.r['games'],self.r['analogs'],100,573);b=simulate(self.p,self.r['games'],self.r['analogs'],100,573);self.assertTrue(np.array_equal(a[0],b[0]))
 def test_separate_tapes(self):
  a=simulate(self.p,self.r['games'],self.r['analogs'],100,573);b=simulate(self.p,self.r['games'],self.r['analogs'],100,574);self.assertFalse(np.array_equal(a[0],b[0]))
 def test_mean_preservation(self):
  a=simulate(self.p,self.r['games'],self.r['analogs'],256,573)[0];self.assertLess(float(np.max(abs(a.mean(axis=0)-np.array([p['mean'] for p in self.p])))),.001)
 def test_no_baseline_mutation(self):
  before=json.dumps(self.r);simulate(self.p,self.r['games'],self.r['analogs'],16,91);self.assertEqual(before,json.dumps(self.r))
 def test_slot_order(self):
  for l in self.r['lineups']:self.assertEqual([p['slot'] for p in l['players']],['QB','RB1','RB2','WR1','WR2','WR3','TE','FLEX','DST'])
 def test_official_ids(self):
  for l in self.r['lineups']:
   for p in l['players']:self.assertIn(p['id'],p['slot_ids'].values())
 def test_historical_games(self):self.assertGreater(len(self.r['analogs']),200)
 def test_historical_research(self):self.assertGreater(self.r['research']['slates'],90)
if __name__=='__main__':
 import sys
 result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__]));(PUBLIC/'tests.json').write_text(json.dumps({'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'passed':result.wasSuccessful()},indent=2));sys.exit(not result.wasSuccessful())
