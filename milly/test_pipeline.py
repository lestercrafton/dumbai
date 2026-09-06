"""Focused regression checks. Software checks are not evidence of betting profit."""
import json,pathlib,tempfile,unittest
import numpy as np,pandas as pd
from model import *
from lineups import *
class MillyTests(unittest.TestCase):
    def test_dk_quarterback_scoring(self):
        self.assertAlmostEqual(offense_points(pd.DataFrame([{'passing_yards':300,'passing_tds':3,'passing_interceptions':1,'rushing_yards':20}])).iloc[0],28)
    def test_receiver_bonus_and_fumble(self):
        self.assertAlmostEqual(offense_points(pd.DataFrame([{'receptions':4,'receiving_yards':110,'receiving_tds':1,'fumbles_lost_total':1}])).iloc[0],23)
    def test_two_distinct_yardage_bonuses(self):
        x={'rushing_yards':110,'receiving_yards':100,'rushing_tds':1,'receiving_tds':1,'receptions':5}
        self.assertAlmostEqual(offense_points(pd.DataFrame([x])).iloc[0],44)
    def test_defensive_thresholds(self):
        self.assertEqual(list(pa_points(np.array([0,6,7,13,14,20,21,27,28,34,35]))),[10,7,4,4,1,1,0,0,-1,-1,-4])
    def test_current_target_not_in_features(self):
        a=pd.DataFrame({'id':['a']*4,'y':[3.,7.,11.,15.]});before=lag_ewm(a,'id','y',4);a.loc[2,'y']=9999
        after=lag_ewm(a,'id','y',4);self.assertAlmostEqual(before[2],after[2]);self.assertNotEqual(before[3],after[3])
    def test_no_cross_player_leakage(self):
        a=pd.DataFrame({'id':['a','b','a','b'],'y':[3.,40.,5.,90.]});v=lag_ewm(a,'id','y',4)
        self.assertEqual(v[2],3);self.assertEqual(v[3],40)
    def test_identity_normalization(self):
        self.assertEqual(norm('James Cook III'),norm('James Cook'));self.assertEqual(norm('Wan’Dale Robinson'),norm("Wan'Dale Robinson"))
    def test_json_nonfinite_not_forged_zero(self):self.assertIsNone(clean(float('nan')))
    def test_roster_optimizer_all_flex_types(self):
        rows=[]
        for pos,n in [('QB',2),('RB',4),('WR',5),('TE',3),('DST',2)]:
            for j in range(n):rows.append({'id':str(len(rows)),'name':pos+str(j),'pos':pos,'salary':4500 if pos!='DST' else 2500,'game':'A@B' if j%2 else 'C@D','start':'2026-09-13T17:00:00Z'})
        f=pd.DataFrame(rows)
        for flex in ['RB','WR','TE']:
            ids,receipt=solve(f,np.arange(len(f))+1,flex);self.assertTrue(validate(ids,f));self.assertEqual(f.loc[assign_slots(ids,f)[7],'pos'],flex)
            self.assertFalse(validate(list(ids[:-1])+[ids[0]],f))
    def test_optimizer_reproducible(self):
        f=pd.DataFrame([{'id':str(j),'name':str(j),'pos':p,'salary':3000,'game':'A@B' if j%2 else 'C@D','start':'2026-09-13T17:00:00Z'} for j,p in enumerate(['QB','QB','RB','RB','RB','WR','WR','WR','WR','TE','TE','DST','DST'])])
        a,_=solve(f,np.arange(len(f)));b,_=solve(f,np.arange(len(f)));self.assertEqual(a,b)
    def test_bad_objective_rejected(self):
        with self.assertRaises(ValueError):solve(pd.DataFrame({'salary':[1],'pos':['QB']}),np.array([np.nan]))
    def test_salary_cap_violation(self):
        f=pd.DataFrame({'pos':SLOTS[:-2]+['RB','DST'],'salary':[6000]*9,'game':['A@B']*8+['C@D']});self.assertFalse(validate(range(9),f))
    def test_single_game_rejected(self):
        f=pd.DataFrame({'pos':['QB','RB','RB','WR','WR','WR','TE','RB','DST'],'salary':[3000]*9,'game':['A@B']*9});self.assertFalse(validate(range(9),f))
    def test_simulation_seed_and_mean(self):
        f=pd.DataFrame([{'pos':'QB','team':'A','mean':15.},{'pos':'WR','team':'A','mean':10.},{'pos':'DST','team':'B','mean':7.}]);games=[{'away':'A','home':'B','id':'A@B','means':[20.,22.]}]
        ts=[{'sides':[{'score_residual':-5.,'dst_z':-1.,'z':{'QB1':-1.,'WR1':-1.}},{'score_residual':4.,'dst_z':1.,'z':{}}]},{'sides':[{'score_residual':8.,'dst_z':1.,'z':{'QB1':2.,'WR1':2.}},{'score_residual':-6.,'dst_z':-1.,'z':{}}]}]
        a,sa=simulate(f,games,ts,{'QB':np.array([0.]),'WR':np.array([0.])},256,10);b,sb=simulate(f,games,ts,{'QB':np.array([0.]),'WR':np.array([0.])},256,10)
        self.assertTrue(np.array_equal(a,b));self.assertTrue(np.array_equal(sa,sb));self.assertLess(np.abs(a.mean(0)-f['mean'].values).max(),.01)
    def test_no_hidden_projection_fields(self):
        source=pathlib.Path(__file__).with_name('model.py').read_text();self.assertNotIn('forecast_priors',source);self.assertNotIn('AvgPointsPerGame',source);self.assertNotIn('matchwiz',source)
    def test_immutable_archive(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/'a.json'
            with p.open('x') as f:f.write('{}')
            with self.assertRaises(FileExistsError):p.open('x')
if __name__=='__main__':unittest.main(verbosity=2)
