"""Scheduling, contest identity and unposted-pool behavior (no network)."""
import datetime as dt,json,pathlib,tempfile,unittest
from unittest import mock
import contest,plan
UTC=dt.timezone.utc
def ms(t):return f'/Date({int(t.timestamp()*1000)})/'
NOW=dt.datetime(2026,10,18,18,16,tzinfo=UTC)  # Sunday 1:16 PM Central, a typical late start
SUNDAY=dt.datetime(2026,10,25,17,0,tzinfo=UTC)
LOBBY={'Contests':[
 {'id':1,'n':'NFL $2.5M Fantasy Football Millionaire','gameType':'Classic','sd':ms(SUNDAY),'dg':155198,'a':20,'m':100000},
 {'id':2,'n':'NFL Satellite to NFL $555 Fantasy Football Millionaire','gameType':'Classic','sd':ms(SUNDAY),'dg':155198,'a':5,'m':10},
 {'id':3,'n':'NFL Showdown Millionaire (WAS @ SF)','gameType':'Showdown Captain Mode','sd':ms(SUNDAY),'dg':155300,'a':5,'m':10},
 {'id':4,'n':'NFL Midseason Millionaire','gameType':'Classic','sd':ms(SUNDAY),'dg':155198,'a':150,'m':10},
 {'id':5,'n':'NFL Old Millionaire','gameType':'Classic','sd':ms(NOW-dt.timedelta(hours=1)),'dg':150000,'a':1,'m':10}]}
class Contest(unittest.TestCase):
 def test_options_filter_and_order(self):
  self.assertEqual([c['id'] for c in contest.millionaire_options(LOBBY,NOW)],[1,4])
 def test_release_lookup_by_draft_group(self):
  with tempfile.TemporaryDirectory() as d:
   pub=pathlib.Path(d);self.assertIsNone(contest.release_for(pub,contest.millionaire_options(LOBBY,NOW)))
   (pub/'archive').mkdir();(pub/'archive'/'r.json').write_text(json.dumps({'release_id':'2026-w08-x','contest':{'draft_group':155198}}))
   self.assertEqual(contest.release_for(pub,contest.millionaire_options(LOBBY,NOW))['release_id'],'2026-w08-x')
 def test_previous_release_is_dated_and_not_current(self):
  with tempfile.TemporaryDirectory() as d:
   pub=pathlib.Path(d);self.assertIsNone(contest.previous_release(pub)['release_id'])
   (pub/'latest.json').write_text(json.dumps({'release_id':'2026-w07-a','generated_at':'2026-10-14T13:20:00+00:00','contest':{'name':'X','kickoff':'2026-10-18T17:00:00+00:00'}}))
   p=contest.previous_release(pub);self.assertFalse(p['is_current']);self.assertIn('2026-10-14T13:20:00+00:00',p['note']);self.assertIn('did not refresh',p['note'])
class Plan(unittest.TestCase):
 def setUp(self):self.dir=tempfile.TemporaryDirectory();self.pub=pathlib.Path(self.dir.name)
 def tearDown(self):self.dir.cleanup()
 def test_late_scheduled_start_still_runs(self):
  run,reason,target=plan.decide('schedule',NOW,LOBBY,pub=self.pub);self.assertTrue(run);self.assertEqual(target['draft_group'],155198)
 def test_existing_contest_release_skips(self):
  (self.pub/'latest.json').write_text(json.dumps({'release_id':'2026-w08-x','contest':{'name':'M','draft_group':155198}}))
  run,reason,_=plan.decide('schedule',NOW,LOBBY,pub=self.pub);self.assertFalse(run);self.assertIn('already exists',reason)
 def test_off_schedule_day_skips(self):
  monday=dt.datetime(2026,10,19,18,0,tzinfo=UTC);self.assertFalse(plan.decide('schedule',monday,LOBBY,pub=self.pub)[0])
 def test_manual_and_push_always_run(self):
  (self.pub/'latest.json').write_text(json.dumps({'release_id':'x','contest':{'draft_group':155198}}))
  for event in ('push','workflow_dispatch'):self.assertTrue(plan.decide(event,NOW,LOBBY,pub=self.pub)[0])
 def test_lobby_failure_runs_to_report_it(self):
  self.assertTrue(plan.decide('schedule',NOW,None,'HTTP Error 403',pub=self.pub)[0])
class UnpostedPool(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  try:import core
  except ImportError:raise unittest.SkipTest('model runtime not installed')
  cls.core=core
 def test_empty_pool_is_reported_as_not_posted(self):
  core=self.core
  with mock.patch.object(core,'NOW',core.pd.Timestamp(NOW)),mock.patch.object(core,'get',return_value={'draftables':[],'errorStatus':{}}):
   with self.assertRaises(contest.PoolNotPosted) as caught:core.slate(LOBBY)
  self.assertEqual(caught.exception.contest['draft_group'],155198);self.assertIn('has not posted its player pool',str(caught.exception))
 def test_blocked_pool_is_not_mislabelled_as_waiting(self):
  core=self.core
  with mock.patch.object(core,'NOW',core.pd.Timestamp(NOW)),mock.patch.object(core,'get',return_value=None):
   with self.assertRaises(RuntimeError) as caught:core.slate(LOBBY)
  self.assertNotIsInstance(caught.exception,contest.PoolNotPosted)
 def test_waiting_receipt_keeps_previous_release_dated(self):
  core=self.core
  with tempfile.TemporaryDirectory() as d:
   pub=pathlib.Path(d);(pub/'latest.json').write_text(json.dumps({'release_id':'old','generated_at':'2026-09-06T18:00:00+00:00','contest':{'kickoff':'2026-09-13T17:00:00+00:00'}}))
   err=contest.PoolNotPosted({'name':'M','draft_group':155198,'listed_start':'2099-01-04T18:00:00+00:00'},'not posted')
   with mock.patch.object(core,'PUB',pub),mock.patch.object(core,'collect',side_effect=err):core.run()
   h=json.loads((pub/'health.json').read_text());self.assertEqual(h['status'],'waiting_for_pool');self.assertEqual(h['previous_release']['release_id'],'old');self.assertFalse(h['previous_release']['is_current'])
   late=contest.PoolNotPosted({'name':'M','draft_group':1,'listed_start':(dt.datetime.now(UTC)+dt.timedelta(hours=3)).isoformat()},'not posted')
   with mock.patch.object(core,'PUB',pub),mock.patch.object(core,'collect',side_effect=late):
    with self.assertRaises(contest.PoolNotPosted):core.run()
   self.assertEqual(json.loads((pub/'health.json').read_text())['status'],'failed')
if __name__=='__main__':unittest.main(verbosity=2)
