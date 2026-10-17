'use client';

import {useCallback, useEffect, useState} from 'react';
import {ArrowDown, ArrowRight, ArrowUpRight, ChevronDown, Database, Radio, RefreshCw, Scale, TrendingUp} from 'lucide-react';
import {DonateButton} from '@/components/donate-button';
export {DonateButton} from '@/components/donate-button';
import {useRefreshingResource} from '@/components/use-refreshing-resource';
import CfbNewsReview, {CfbNewsFlag} from '@/components/cfb-news-review';
import {handicap, spreadDecision} from '@/lib/spread-display.mjs';
import {moneylineComparison} from '@/lib/moneyline.mjs';
import {centralDay, centralTime, featuredGame, featuredLeaders, SUPPORTED_SPORTS, sportLabel, visibleOutcome} from '@/lib/presentation.mjs';
import {shortScoreUnit, scoreUnit} from '@/lib/sport-copy';
import {displayLines} from '@/lib/board-presentation.mjs';
import {liveScorePresentation} from '@/lib/board-discovery.mjs';
import {liveGameProgress} from '@/lib/live-game-progress.mjs';
import {livePickStatus} from '@/lib/live-pick-status.mjs';
import {espnGamecastUrl} from '@/lib/gamecast.mjs';
import {SITE_CONFIG} from '@/lib/site-config';
import research from '@/lib/research.json';

type Row = Record<string, any>;
const teamName = (team: Row) => team?.name || team?.abbreviation || 'Team';
const teamCode = (team: Row) => team?.abbreviation || team?.name || 'Team';
const pointValue = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '—';
function stakeNote(game: Row) {
  const bankroll = game.bankroll;
  if (!bankroll) return null;
  const label = game.forecastOrigin === 'cfb-reconstructed-2026-09-26' ? 'Paper stake' : 'Sheet stake';
  if (bankroll.stake != null) return `${label}: $${bankroll.stake.toFixed(2)} · ${bankroll.riskUnits.toFixed(2)}u${bankroll.fundingConfirmed ? ' · Funding confirmed' : ''}`;
  if (bankroll.status === 'unpriced') return `${label}: awaiting price`;
  if (bankroll.status === 'void') return `${label}: void`;
  if (bankroll.status === 'waiting-prior') return `${label}: awaiting ${bankroll.blockedBy} results`;
  if (bankroll.status === 'bankroll-depleted') return `${label}: bankroll depleted`;
  return `${label}: full-card funding required`;
}

export function SiteHeader({onBoard, onResults}: {onBoard: () => void; onResults: () => void}) {
  return <header className="vin-header">
    <a className="vin-wordmark" href="#top" aria-label="Big Vin home"><span className="vin-mark" aria-hidden="true">b<span>v</span><i/></span><span>BIG VIN<span className="vin-wordmark-sub">AN INDEPENDENT EDGE.</span></span></a>
    <nav aria-label="Main navigation"><a href="#board" onClick={onBoard}>The board</a><a href="#board" onClick={onResults}>Results</a><a href="#method">The model</a><a href="#story">Our story</a></nav>
    <DonateButton className="vin-button-outline vin-header-donate"/>
  </header>;
}

export function TodayHero({readSlate, onOpenGame, refreshKey = 0}: {readSlate: (sport: string, date: string, days: number) => Promise<any>; onOpenGame: (game: Row) => void; refreshKey?: number}) {
  const [today, setToday] = useState(() => centralDay()!);
  const [featuredSport, setFeaturedSport] = useState<string|null>(null);
  // A seven-day API window preserves Eastern-day query semantics and includes
  // late-night CT kickoffs that belong to the following Eastern sports date.
  const read = useCallback(async () => {
    const results = await Promise.allSettled(SUPPORTED_SPORTS.map(sport => readSlate(sport, today, 7)));
    const slates = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    if (!slates.length) throw new Error('Today’s sports lines could not be checked.');
    return {slates, partial: results.some(result => result.status === 'rejected') || slates.some(slate => slate.partialLiveCoverage || slate.offlineSnapshot)};
  }, [readSlate, today]);
  const {data, busy, error, load} = useRefreshingResource<{slates: Row[]; partial: boolean}>('featured:' + today, read);
  useEffect(() => {if (refreshKey > 0) void load();}, [refreshKey, load]);
  useEffect(() => {
    const check = () => {if (document.visibilityState === 'visible') {setToday(centralDay()!); void load();}};
    const timer = setInterval(check, 60000);
    window.addEventListener('focus', check);
    return () => {clearInterval(timer); window.removeEventListener('focus', check);};
  }, [load]);
  const leaders = data ? featuredLeaders(data.slates) : [];
  const game = data ? featuredGame(data.slates, Date.now(), featuredSport) : null;
  const decision = game ? spreadDecision(game) : null;
  const lines = game ? displayLines(game) : null;
  return <section className="vin-hero" aria-labelledby="hero-title">
    <div className="vin-hero-copy">
      <p className="vin-kicker"><span className="vin-signal"/> INDEPENDENT THINKING. EVERY GAME.</p>
      <h1 id="hero-title">Find the<br/>difference<span>.</span></h1>
      <p className="vin-hero-description">Our line. The Vegas line.<br/>A clearer view of the game.</p>
      <a className="vin-hero-link" href="#board">See the full board <ArrowDown size={18}/></a>
      <div className="vin-hero-footnote"><span>EVERY SPORT ON THE DAY’S BOARD</span><span>BUILT IN THE OPEN</span></div>
    </div>
    <div className={`vin-feature ${game ? '' : 'vin-feature-empty'}`} aria-busy={busy}>
      <div className="vin-feature-top"><span><Radio size={14}/>{data?.partial || error ? 'TODAY’S AVAILABLE TOP EDGES' : 'TOP EDGE BY SPORT'}</span><span>CT</span></div>
      {leaders.length > 0 && <div className="vin-feature-leagues" role="group" aria-label="Today’s eligible league leaders">{leaders.map(leader => <button key={leader.sport} type="button" aria-pressed={game?.sport === leader.sport} onClick={() => setFeaturedSport(leader.sport)}><span>{leader.sport.toUpperCase()}</span><small>{pointValue(leader.edge)} {shortScoreUnit(leader.sport)}</small></button>)}</div>}
      {game && decision && lines ? <>
        <div className="vin-feature-meta"><span>{sportLabel(game.sport).toUpperCase()}</span><span>{centralTime(game.startTime)}</span></div>
        <h2 className="vin-feature-matchup"><span>{teamName(game.away)}</span><small>at</small><span>{teamName(game.home)}</span></h2>
        <div className="vin-feature-bottom"><div><span className="vin-label">THE SIDE</span><strong>{lines.pick || 'No ATS pick'}</strong><small>{game.archived ? 'Saved pregame line' : 'Latest available line'}</small></div><div className="vin-feature-edge"><strong>{pointValue(game.edge)}</strong><span>{scoreUnit(game.sport).toUpperCase()} OF EDGE</span></div></div>
        <button className="vin-feature-action" onClick={() => onOpenGame(game)}>See this matchup <ArrowUpRight size={19}/></button>
        <p className="vin-feature-disclaimer">Each league’s highest-ranked eligible game today. The earliest-starting league leader is featured first. Points, runs and goals are kept separate; this is not a cross-sport confidence ranking.</p>
      </> : <div className="vin-feature-placeholder"><div className="vin-orbit" aria-hidden="true"><span/><i/></div><h2>{busy && !data ? 'Finding today’s difference.' : error && !data ? 'The feed needs a moment.' : 'The next edge is still taking shape.'}</h2><p>{busy && !data ? 'Checking NFL, college football, NBA, WNBA, college basketball, NHL and MLB.' : error && !data ? 'We couldn’t verify today’s lines. Try again or explore the saved board below.' : 'No eligible upcoming line is available across the supported sports today in Central time. Explore the daily board below.'}</p>{error && !data && <button className="vin-text-button" onClick={() => void load()}>Check again <RefreshCw size={15}/></button>}</div>}
      {(data?.partial || (error && data)) && <p className="vin-feature-warning" role="status">{error ? 'Refresh unavailable. Showing the last checked data.' : 'Coverage is incomplete or using saved observations. Some leagues or eligible games may be missing.'}</p>}
    </div>
  </section>;
}

export function GameCards({games, sport, onInspect, offline=false, refreshFailed=false, now=Date.now()}: {games: Row[]; sport: string; onInspect: (game: Row) => void; offline?:boolean; refreshFailed?:boolean; now?:number}) {
  return <div className="vin-game-grid">{games.map(game => {
    const decision = spreadDecision(game);
    const lines = displayLines(game);
    const score:Row = liveScorePresentation(game,{offline,refreshFailed,now});
    const progress = liveGameProgress(game,{offline,refreshFailed,now});
    const livePick = livePickStatus(game,{offline,refreshFailed,now});
    const moneyline = moneylineComparison(game, sport);
    const synthetic = game.paperWager?.kind === 'synthetic-winner-even';
    const settled = !synthetic && ['win','loss','push','void'].includes(decision.outcome);
    const liveResult = !settled && livePick.provisional;
    const gamecast = espnGamecastUrl(game,sport);
    const ScorePanel = gamecast ? 'a' : 'div';
    const cardState = decision.outcome === 'win' && !synthetic ? 'vin-game-win'
      : decision.outcome === 'loss' && !synthetic ? 'vin-game-learn'
      : score.kind === 'live' && livePick.provisional && livePick.state === 'covering' ? 'vin-game-covering'
      : score.kind === 'live' && livePick.provisional && livePick.state === 'not-covering' ? 'vin-game-not-covering' : 'vin-game-neutral';
    return <article className={`vin-game-card ${game.lowEvidence ? 'vin-game-limited' : ''} ${cardState}`} key={game.id} data-game-id={game.id} data-rank={game.rank??''} data-result-outcome={decision.outcome} data-live-pick-status={score.kind==='live'?livePick.state:undefined}>
      <div className="vin-game-top"><span className="vin-game-rank">{game.rank ? <><span>#</span>{String(game.rank).padStart(2, '0')}</> : 'UNRANKED'}</span><span>{score.kind==='live' && <b className={livePick.isWinning?'vin-live':'vin-score-neutral'}>{score.label.toUpperCase()} · </b>}{centralTime(game.startTime)}</span></div>
      <div className="vin-game-matchup"><h3>{teamName(game.away)} <span>at</span> {teamName(game.home)}</h3><span className="vin-game-league">{sport.toUpperCase()}{game.neutralSite ? ' · Neutral' : ''}</span></div>
      {(score.kind==='live'||score.kind==='final')&&<ScorePanel href={gamecast??undefined} target={gamecast?'_blank':undefined} rel={gamecast?'noopener noreferrer':undefined} className={`vin-scoreboard ${gamecast?'vin-scoreboard-link':''} vin-scoreboard-${score.freshness} ${score.kind==='live'&&livePick.provisional?livePick.state==='covering'?'vin-scoreboard-covering':livePick.state==='not-covering'?'vin-scoreboard-not-covering':'':''}`} aria-label={`${score.label}: ${teamName(game.away)} ${score.awayScore??'unavailable'}, ${teamName(game.home)} ${score.homeScore??'unavailable'}${progress?'. '+progress.label:''}${gamecast?'. Open ESPN Gamecast in a new tab':''}`}>
       <div className="vin-scoreboard-top"><strong>{score.label}</strong>{progress&&<span className="vin-game-progress">{progress.label}</span>}</div>
       <div className="vin-scoreboard-teams"><div><span>{teamCode(game.away)}</span><strong>{score.awayScore??'—'}</strong></div><span aria-hidden="true">–</span><div><strong>{score.homeScore??'—'}</strong><span>{teamCode(game.home)}</span></div></div>
       {score.kind==='live'&&<>{!livePick.provisional&&<div className={`vin-live-pick-status ${livePick.isWinning?'vin-live-pick-winning':''}`}><strong>{livePick.label}</strong><span>{livePick.provisional?'Against the displayed line · provisional':livePick.reason==='stale-score'?'Live pick status unavailable · refresh needed':livePick.reason==='stale-line'?'Price is stale':livePick.reason==='no-ats-pick'?'No displayed ATS pick':'Complete score needed'}</span></div>}<p>{score.updatedAt?'Feed checked '+centralTime(score.updatedAt):'Feed check time unavailable.'} · Reported clock, not a countdown.{score.freshness!=='live'?' Refresh for the latest score.':''}{!score.completeScore?' Score unavailable for one or both teams.':''}</p></>}
       {gamecast&&<span className="vin-gamecast-label">ESPN Gamecast <ArrowUpRight size={13} aria-hidden="true"/></span>}
      </ScorePanel>}
      <div className="vin-game-lines" role="group" aria-label={`Spread comparison for ${lines.teamName}`}><div><span className="vin-label">{synthetic ? 'PAPER CONTRACT' : 'VEGAS LINE'}</span><strong>{synthetic ? 'Synthetic winner · +100' : lines.marketLine!=null?`${lines.teamShort} ${handicap(lines.marketLine)}`:'No market spread'}</strong><small>{synthetic ? 'No sportsbook quote' : 'Spread'}</small></div><div><span className="vin-label">BIG VIN LINE</span><strong>{lines.fairLine!=null?`${lines.teamShort} ${handicap(lines.fairLine)}`:'No projection'}</strong><small>Fair spread</small></div><div><span className="vin-label">VALUE</span><strong>{decision.pick && lines.edge!=null?pointValue(lines.edge):'—'}</strong><small>{shortScoreUnit(sport)} of edge</small></div></div>
      {moneyline && <dl className="vin-moneyline" aria-label={`Moneyline comparison for ${moneyline.teamName}`}><div><dt>{moneyline.quote?.label || 'Vegas ML'}</dt><dd>{moneyline.team} <strong aria-label={moneyline.quote ? undefined : 'Unavailable'}>{moneyline.vegas}</strong></dd></div><div><dt>BV ML <span>(est.)</span></dt><dd>{moneyline.team} <strong>{moneyline.implied}</strong></dd></div><div className="vin-ml-ev"><dt>ML EV <span>(est.)</span></dt><dd><strong aria-label={moneyline.evPer100 === null ? 'Unavailable' : `${moneyline.ev.replace(/u$/, ' units')} estimated net profit or loss per 100 units wagered`}>{moneyline.ev}</strong><small>per 100 units wagered</small>{moneyline.evPer100 !== null && moneyline.evPer100 < 0 && <small>No ML edge</small>}</dd></div></dl>}
      <div className="vin-game-pick"><div><span className="vin-label">BIG VIN’S PICK</span><strong>{lines.pick || 'No ATS pick'}</strong></div><span className="vin-pick-kind">{synthetic ? 'Paper contract' : 'Against the spread'}</span></div>
      <div className={`vin-game-status vin-visible-result ${settled?'vin-result-settled':liveResult?'vin-result-live':''}`}>
        {(settled || liveResult) && <span className="vin-result-heading">{settled ? decision.outcome==='void'?'SETTLED':'FINAL' : 'LIVE'} · AGAINST THE SPREAD</span>}
        <strong className={`vin-outcome-badge vin-outcome-${liveResult?livePick.state:decision.outcome}`}>{liveResult ? livePick.label : visibleOutcome(decision, synthetic)}</strong>
        {decision.score && <span className="vin-final-score">Final · {teamCode(game.away)} {decision.score.split('–')[0]} – {decision.score.split('–')[1]} {teamCode(game.home)}</span>}
        <span>{game.archived ? 'Uses the saved pregame line' : game.stale ? 'Stale price' : 'Feed observation'}{liveResult?' · provisional':decision.outcome==='pending'?' · awaiting final':''}</span>
        {liveResult && livePick.state==='not-covering' && <span>Net {scoreUnit(sport)} needed to move past the spread.</span>}
      </div>
      {(game.stale || game.lowEvidence || (!game.rank && game.rankReason)) && <p className="vin-data-note">{game.stale ? 'Stale market snapshot. Excluded from ranked picks.' : game.lowEvidence ? 'Limited rating evidence. Included in full-card results; outside ranked picks.' : game.rankReason}</p>}
      <details className="vin-game-details"><summary>Behind the line <CfbNewsFlag gameId={game.id} sport={sport}/><ChevronDown size={15}/></summary><div>
        <p>{game.modelLabel || 'Experimental ratings'} · results before {game.modelAsOf || 'the model cutoff'}.</p>
        <p>Source: {game.market?.provider || 'No market provider returned'}.{game.market?.observedAt ? ' Price observed ' + centralTime(game.market.observedAt) + '.' : ''}</p>
        {game.forecastCapturedAt && <p>{game.forecastOrigin === 'cfb-reconstructed-2026-09-26' ? 'Reconstructed' : 'Forecast saved'} {centralTime(game.forecastCapturedAt)}.</p>}
        {game.historyRankBasis && <p>Board rank: {game.rank?`#${game.rank}`:'unranked'} · Saved-card rank: {game.historyCardRank?`#${game.historyCardRank}`:'unranked'}. Tracked Top cards use the saved-card rank; search keeps the board rank unchanged.</p>}
        {game.firstMarket && <p>First price captured {centralTime(game.firstMarket.observedAt)}. Saved forecasts retain their grading price.</p>}
        {moneyline && <><p>BV ML estimates {moneyline.team}’s outright-win price from Big Vin’s fair spread using the existing sport-specific margin conversion. It is not a calibrated win probability or an ML pick.</p><p>ML EV estimates net profit or loss per 100 units wagered at the displayed Vegas moneyline: win chance × profit if won, minus loss chance × 100 units. A unit is your chosen stake size; +10u EV means an estimated net gain of 10 units for every 100 units wagered. Positive means a projected moneyline edge; negative means no projected ML edge at that price. The spread edge is separate. EV uses the unrounded model estimate and the quoted payout, including the book’s price margin. It is an estimate, not a guaranteed return.</p><p>{moneyline.quote ? <>Vegas ML: {moneyline.quote.provider}’s displayed quote{moneyline.quote.observedAt ? ', checked ' + centralTime(moneyline.quote.observedAt) : ''}.{moneyline.quote.historical ? ' Historical quote timing is unverified; this is not a verified pregame price.' : game.archived ? ' The latest feed quote is separate from the saved pregame spread.' : ''}</> : 'Vegas ML: no sportsbook moneyline quote was returned for this team. The dash is not a spread-derived substitute.'}</p></>}
        {game.conferences?.length > 0 && <p>Conferences: {game.conferences.join(' / ')}.</p>}
        {game.lowEvidence && <p>{game.projection?.ratingCoverage === 'one-prior' ? 'One team uses a prior rating.' : game.projection?.ratingCoverage === 'both-prior' ? 'Both teams use prior ratings.' : 'Fewer than five time-weighted games for at least one team.'}</p>}
        {stakeNote(game) && <p>{stakeNote(game)}.{game.bankroll?.profitUnits != null ? ' Sized result: ' + game.bankroll.profitUnits.toFixed(2) + 'u.' : ''}</p>}
        {game.forecastOrigin === 'cfb-reconstructed-2026-09-26' && <p>Paper result: {!game.paperWager ? 'price pending' : ['win', 'loss', 'push'].includes(game.bankroll?.outcome) ? game.bankroll.outcome === 'loss' ? 'Learn' : game.bankroll.outcome : game.result?.status === 'completed' ? 'settlement pending' : 'awaiting final'}.{synthetic ? ' Winner-only contract, excluded from against-the-spread results.' : ''}</p>}
        <CfbNewsReview gameId={game.id} sport={sport}/>
        <button type="button" className="vin-text-button" onClick={() => onInspect(game)}>Record a paper play <ArrowUpRight size={15}/></button>
      </div></details>
    </article>;
  })}</div>;
}

export function ModelSection() {
  return <section id="method" className="vin-section vin-method" aria-labelledby="model-title">
    <div className="vin-section-heading"><div><p className="vin-kicker">01 / THE THINKING</p><h2 id="model-title">No black box.<br/>Just a different line.</h2></div><p>We turn game results into a fair spread, then measure where our number and the market part ways.</p></div>
    <ol className="vin-process">
      <li><span className="vin-process-number">01</span><Database size={25}/><h3>Start with the games.</h3><p>Schedules, final scores and available sportsbook lines from ESPN’s public scoreboards. NFL history from nflverse.</p><span className="vin-source-tag">ESPN + NFLVERSE</span></li>
      <li><span className="vin-process-number">02</span><Scale size={25}/><h3>Build our own line.</h3><p>Opponent-adjusted ratings weigh recent results, account for home field and add rest for the NFL. Thin histories are pulled toward average.</p><span className="vin-source-tag">BIG VIN RATINGS</span></li>
      <li><span className="vin-process-number">03</span><TrendingUp size={25}/><h3>Find the difference.</h3><p>Compare the fair spread with the available Vegas line. The gap ranks each sport’s card in its own units: points, runs or goals. Keep the pick and its recorded price for the results.</p><span className="vin-source-tag">EDGE, NOT PROBABILITY</span></li>
    </ol>
    <div className="vin-equation"><span>Our fair line</span><b aria-hidden="true">−</b><span>Vegas line</span><b aria-hidden="true">=</b><strong>The difference.</strong><small>Points / runs / goals, by sport</small></div>
    <details className="vin-method-details"><summary>The sources, the limits, the honest benchmark <ChevronDown size={17}/></summary><div>
      <p>The live model uses opponent-adjusted ridge regression, recency weighting, home advantage and NFL rest. It does not currently include injuries, quarterbacks, pitchers, goalies or weather. The original Sagarin, White Owl, Golden Mean and Momentum blend inspired the workflow; those proprietary inputs are not today’s live feeds.</p>
      <p>On 855 held-out NFL games from 2023–25, mean absolute error was {research.test.same_games_with_market.candidate.mae.toFixed(2)} points for Big Vin versus {research.test.same_games_with_market.market.mae.toFixed(2)} for the market. Lower is better. That test does not establish an advantage over Vegas. Later tuning is tracked separately in the learning log.</p>
      <p>Other supported sports use ESPN, SportsDataverse/hoopR archives and MLB StatsAPI where applicable. Public data can be late or incomplete. Existing saved prices, picks and model cutoffs are retained; a new score doesn’t create a new past pick.</p>
      <div className="vin-source-links"><a href="https://github.com/nflverse/nfldata" target="_blank" rel="noreferrer">nflverse <ArrowUpRight size={14}/></a><a href="https://www.espn.com/college-football/scoreboard" target="_blank" rel="noreferrer">ESPN scoreboards <ArrowUpRight size={14}/></a><a href="/learning-log">Learning log <ArrowUpRight size={14}/></a></div>
    </div></details>
  </section>;
}

export function StorySection() {
  return <section id="story" className="vin-section vin-story" aria-labelledby="story-title">
    <div className="vin-story-art" aria-hidden="true"><div className="vin-sheet-top"><span>BIG VIN + STAN</span><span>03 / 22 / 21</span></div><div className="vin-sheet-grid"><span>GAME</span><span>OUR LINE</span><span>THE EDGE</span>{Array.from({length: 15}, (_, index) => <i key={index}/>)}</div><span className="vin-sheet-note">It started with a spreadsheet.</span><div className="vin-story-stamp">21<span>THE ORIGINALS</span></div></div>
    <div className="vin-story-copy"><p className="vin-kicker">02 / FROM THE SPREADSHEET</p><h2 id="story-title">Big Vin.<br/>His boy Stan.<br/>One big idea.</h2><p>During COVID, Big Vin and his boy Stan started tracking games by hand. A spreadsheet. A few different lines. Every result written down.</p><p>By March 22, 2021, the sheets were filling up. They kept finding the gaps they called an edge. The idea stuck. The hours of manual upkeep didn’t.</p><p>Now we’re partnering with AI to do the heavy lifting, test the thinking and keep the record honest. Same curiosity. A lot more possibility.</p><a className="vin-text-link" href="https://docs.google.com/spreadsheets/d/1ATE4c-WRT6yLOwoAwqmxW8CPhlg5HbE2kEGTyVgWWmo/edit" target="_blank" rel="noreferrer">The March 22, 2021 spreadsheet <ArrowUpRight size={16}/></a></div>
  </section>;
}

export function SupportSection() {
  return <section id="support" className="vin-section vin-support" aria-labelledby="pledge-title">
    <div className="vin-pledge"><p className="vin-kicker">03 / BUILT TOGETHER</p><h2 id="pledge-title" className="vin-profit-ratio">50<span>/</span>25<span>/</span>25<span className="vin-period">.</span></h2><p className="vin-pledge-copy">{SITE_CONFIG.pledge}</p><div className="vin-split vin-profit-split" aria-hidden="true">{SITE_CONFIG.profitAllocation.map(item => <span key={item.label}>{item.percent}%<small>{item.label}</small></span>)}</div></div>
    <div className="vin-support-action"><div><h3>Help build the next edge.</h3><p>A project our community keeps going.</p></div><DonateButton/></div>
    <div className="vin-ambassadors"><span className="vin-ambassador-icon" aria-hidden="true">↗</span><p>{SITE_CONFIG.ambassadors}</p><span>THE NEXT GENERATION<br/>OF INDEPENDENT THINKING.</span></div>
  </section>;
}

export function SiteFooter() {
  return <footer className="vin-footer"><div><a className="vin-footer-brand" href="#top">BIG VIN<span>↗</span></a><p>Independent thinking. Visible assumptions. Honest results.</p></div><p className="vin-risk">An experimental research project, not financial or betting advice. An edge measures disagreement, not a guaranteed return. Past and simulated results don’t predict future performance. Never risk money you can’t afford to lose.</p><span>BUILT FROM THE SHEETS.<br/>ALWAYS LEARNING.</span></footer>;
}
