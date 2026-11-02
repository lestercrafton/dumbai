import test from 'node:test';import assert from 'node:assert/strict';
import {fitRatings,projectGame} from './ratings.mjs';
import {publishDecision} from './rank-signal.mjs';
import {cbbPriors,cbbPace,cbbSeasonOf} from './cbb-priors.mjs';
const g=(d,h,a,hs,as,extra={})=>({date:d,homeId:h,awayId:a,homeScore:hs,awayScore:as,...extra});
test('fatigue columns fit a back-to-back penalty and apply it to projections',()=>{
 const games=[];for(let i=0;i<40;i++){const b2b=i%2?1:0;games.push(g(`2026-01-${String(1+i%28).padStart(2,'0')}`,'A','B',b2b?95:105,100,{b2bDiff:b2b,tzDiff:0}));}
 const m=fitRatings(games,{sport:'nba',asOf:'2026-02-01',parameters:{halfLifeDays:45,ratingPenalty:2,useFatigue:true}});
 assert.ok(m.fatigueCoefficients.b2b<-3);
 const rested=projectGame({homeId:'A',awayId:'B',b2bDiff:0},m),tired=projectGame({homeId:'A',awayId:'B',b2bDiff:1},m);
 assert.ok(tired.predictedHomeMargin<rested.predictedHomeMargin-3);
});
test('college priors rate a team before it has played, and pace scales the margin',()=>{
 const m=fitRatings([g('2025-11-03','A','B',70,60)],{sport:'cbb',asOf:'2025-11-05',parameters:{ratingPenalty:5,usePriors:true,usePace:true,homePrior:4},priors:{A:10,B:0,C:-10}});
 const p=projectGame({homeId:'C',awayId:'B',neutral:true,pace:60},m),q=projectGame({homeId:'C',awayId:'B',neutral:true,pace:75},m);
 assert.equal(p.error,undefined);assert.ok(p.predictedHomeMargin<0);
 assert.ok(Math.abs(q.predictedHomeMargin/p.predictedHomeMargin-75/60)<1e-9);
 assert.equal(projectGame({homeId:'C',awayId:'B',neutral:true,pace:60},m).homeAdvantage,0);
});
test('college prior file covers Division I teams with Torvik tempo',()=>{
 assert.equal(cbbSeasonOf('2026-11-03'),2027);assert.equal(cbbSeasonOf('2026-03-01'),2026);
 const p=cbbPriors(2027);assert.ok(Object.keys(p).length>300);
 assert.ok(cbbPace({date:'2026-11-05',homeId:Object.keys(p)[0],awayId:Object.keys(p)[1]})>55);
});
test('college picks need priced lines and enough recent games per team',()=>{
 const good={bucketGraded:80,winChance:0.6,breakEven:0.524};
 assert.equal(publishDecision(good,'cbb',{homeEffectiveGames:2,awayEffectiveGames:9}).published,false);
 assert.equal(publishDecision(good,'cbb',{homeEffectiveGames:6,awayEffectiveGames:9}).published,true);
 assert.equal(publishDecision(null,'cbb').published,false);
});
