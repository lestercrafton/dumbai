import test from 'node:test';
import assert from 'node:assert/strict';
import {centralDay, centralTime, featuredGame, featuredLeaders, dailySportAvailability, SUPPORTED_SPORTS, visibleOutcome, validBoardDate} from './presentation.mjs';
import {SPORT_PATHS} from './feeds/adapter.mjs';
import {spreadDecision} from './spread-display.mjs';
const now = Date.parse('2026-10-17T00:00:00Z');
const game = (id, edge, extra = {}) => ({id, edge, rank: 1, side: 'home', sport: 'nfl', status: 'scheduled', startTime: '2026-10-17T01:00:00Z', ...extra});
test('Chicago calendar and clock include explicit CT, including the ET date boundary', () => {
  assert.equal(centralDay(now), '2026-10-16');
  assert.equal(centralDay('2026-10-17T04:30:00Z'), '2026-10-16');
  assert.equal(centralTime('2026-10-17T04:30:00Z'), 'Oct 16, 11:30 PM CT');
  assert.equal(centralTime(null), 'Time TBA');
  assert.equal(centralDay('invalid'), null);
});
test('supported presentation sports come from the existing API, with no invented feeds', () => {
  assert.deepEqual(SUPPORTED_SPORTS, Object.keys(SPORT_PATHS));
  assert.deepEqual([...SUPPORTED_SPORTS].sort(), ['cbb','cfb','mlb','nba','nfl','nhl','wnba']);
});
test('hero preserves the best eligible API rank inside each league and never renumbers it', () => {
  const nfl = {sport:'nfl', games:[game('lower', 4, {rank:9}), game('leader', 8, {rank:3})]};
  assert.equal(featuredGame([nfl], now).id, 'leader');
  assert.equal(featuredGame([nfl], now).rank, 3);
  assert.deepEqual(nfl.games.map(value=>value.rank), [9,3]);
});
test('hero covers all seven sports and chooses earliest league leader, not largest mixed-unit edge', () => {
  const slates = SUPPORTED_SPORTS.map((sport,index)=>({sport,games:[game(sport,20-index,{sport,startTime:`2026-10-17T0${index<4?index+1:4}:00:00Z`})]}));
  slates.find(slate=>slate.sport==='mlb').games[0].startTime='2026-10-17T00:30:00Z';
  assert.equal(featuredLeaders(slates,now).length,7);
  assert.equal(featuredGame(slates,now).sport,'mlb');
  assert.equal(featuredGame(slates,now,'nhl').sport,'nhl');
  assert.equal(featuredGame(slates,now,'unsupported').sport,'mlb');
});
test('hero does not invent a pick for missing, stale, thin, synthetic, past, or non-today data', () => {
  const invalid = [
    {stale:true}, {lowEvidence:true}, {rank:null}, {edge:null}, {side:null}, {edge:0}, {status:'live'}, {completed:true},
    {startTime:'2026-10-16T23:00:00Z'}, {startTime:'2026-10-18T01:00:00Z'}, {sport:'soccer'}, {paperWager:{kind:'synthetic-winner-even'}},
  ].map((extra, i) => game(String(i), 99, extra));
  assert.equal(featuredGame([{games:invalid}], now), null);
  assert.equal(featuredGame([], now), null);
});
test('hero includes the late CT game without changing the API Eastern-day convention', () => {
  const late = game('late', 3, {sport:'nba',startTime:'2026-10-17T04:30:00Z'});
  assert.equal(featuredGame([{sport:'nba',games:[late]}], now).id, 'late');
});
test('availability retains completed, unranked and limited-data games and distinguishes failure from an empty league', () => {
  const slates = [{sport:'nhl',games:[game('final',null,{sport:'nhl',completed:true,status:'completed',rank:null})]},
    {sport:'cfb',games:[game('limited',2,{sport:'cfb',lowEvidence:true,rank:null})]}, {sport:'mlb',games:[],offlineSnapshot:true}];
  const availability = dailySportAvailability(slates,['nba']);
  assert.equal(availability.find(item=>item.sport==='nhl').count,1);
  assert.equal(availability.find(item=>item.sport==='cfb').count,1);
  assert.equal(availability.find(item=>item.sport==='mlb').count,0);
  assert.equal(availability.find(item=>item.sport==='mlb').partial,true);
  assert.equal(availability.find(item=>item.sport==='nba').count,null);
  assert.equal(availability.find(item=>item.sport==='nba').failed,true);
  assert.equal(availability.length,7);
});
test('result labels expose wins, losses and pushes without changing settlement', () => {
  assert.equal(visibleOutcome({outcome:'win'}),'Big Vin Wins.');
  assert.equal(visibleOutcome({outcome:'loss'}),'Learn');
  assert.equal(visibleOutcome({outcome:'push'}),'Push');
  assert.equal(visibleOutcome({outcome:'pending'}),'Pending');
  assert.equal(visibleOutcome({outcome:'no-line'}),'Ungraded · no spread');
  assert.equal(visibleOutcome({outcome:'win'},true),'No ATS result · paper winner contract');
});
test('visible results still come from saved spread settlement, never an in-progress score', () => {
  const record={home:{name:'Home'},away:{name:'Away'},side:'home',projection:{predictedHomeMargin:7},market:{homeSpread:-3},
    result:{status:'in-progress',homeScore:21,awayScore:10},liveHomeScore:21,liveAwayScore:10};
  assert.equal(visibleOutcome(spreadDecision(record)),'Pending');
  assert.equal(spreadDecision(record).score,null);
  const completed={...record,result:{status:'completed',homeScore:21,awayScore:10}};
  assert.equal(visibleOutcome(spreadDecision(completed)),'Big Vin Wins.');
  assert.equal(spreadDecision(completed).score,'10–21');
});

test('cleared or impossible date inputs cannot reach date-scoped record helpers', () => {
  assert.equal(validBoardDate(''),false);
  assert.equal(validBoardDate('2026-02-30'),false);
  assert.equal(validBoardDate('2026-10-17'),true);
  assert.equal(validBoardDate(null),false);
});
