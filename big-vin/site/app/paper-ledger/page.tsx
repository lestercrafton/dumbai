'use client';

import {useCallback, useEffect, useState} from 'react';
import Link from 'next/link';
import {ArrowLeft, ArrowUpRight, ClipboardList, Download, RefreshCw} from 'lucide-react';
import {api, browserBoard, JsonCall} from '@/lib/board-client';
import {formatCentralTime} from '@/lib/board-presentation.mjs';
import {summarizeLedger} from '@/lib/legacy.mjs';
import {sportsDay} from '@/lib/time';
import styles from './page.module.css';

type Play = {
  id: string;
  created_at: string;
  sport: string;
  start_time: string;
  home: string;
  away: string;
  market: string;
  selection: string;
  line: number | null;
  odds: number;
  risk: number;
  outcome: string;
  pnl: number | null;
  grade_source: string | null;
  rank: number | null;
  [key: string]: unknown;
};

const resultLabels: Record<string, string> = {
  pending: 'Pending',
  win: 'Win',
  learn: 'Learn',
  push: 'Push',
  void: 'Void',
};

function signed(value: unknown, digits = 1) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  return (number > 0 ? '+' : '') + number.toFixed(digits);
}

function summarize(plays: Play[]) {
  return summarizeLedger(plays.map(play => ({
    ...play,
    gradedRisk: ['win', 'learn', 'push'].includes(play.outcome) ? play.risk : 0,
  })));
}

function exportLedger(plays: Play[]) {
  const keys = [...new Set(plays.flatMap(play => Object.keys(play)))];
  const cell = (value: unknown) => {
    const text = typeof value === 'object'
      ? JSON.stringify(value) ?? ''
      : typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : '';
    return '"' + (/^[=+@-]/.test(text) ? "'" : '') + text.replaceAll('"', '""') + '"';
  };
  const contents = [
    keys.map(cell).join(','),
    ...plays.map(play => keys.map(key => cell(play[key])).join(',')),
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([contents], {type: 'text/csv'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'big-vin-paper-plays.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function PaperLedger() {
  const [ledger, setLedger] = useState<Play[]>([]);
  const [busy, setBusy] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [gradingId, setGradingId] = useState<string | null>(null);

  const loadLedger = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const response = await api('/api/ledger');
      setLedger(response.plays);
      setHasLoaded(true);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void api('/api/ledger')
      .then(response => {
        if (!active) return;
        setLedger(response.plays);
        setHasLoaded(true);
      })
      .catch(caught => {
        if (active) setError((caught as Error).message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => { active = false; };
  }, []);

  const refreshResults = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      // Keep the feed's Eastern sports-day grouping; displayed times are Central.
      const groups = [...new Set(
        ledger
          .filter(play => play.outcome === 'pending' && Date.parse(play.start_time) < Date.now())
          .map(play => play.sport + ':' + sportsDay(play.start_time)),
      )].slice(0, 12);
      const snapshots = await Promise.allSettled(groups.map(async key => {
        const [sport, date] = key.split(':');
        return {sport, date, payload: await browserBoard(sport, date)};
      }));
      const response = await api('/api/ledger', JsonCall({
        action: 'refresh',
        snapshots: snapshots.flatMap(snapshot => snapshot.status === 'fulfilled' ? [snapshot.value] : []),
      }, 'PATCH'));
      setNotice(response.graded + ' plays graded from final scores.');
      await loadLedger();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const manualGrade = async (id: string, outcome: string) => {
    setGradingId(id);
    setError('');
    setNotice('');
    try {
      await api('/api/ledger', JsonCall({id, outcome}, 'PATCH'));
      setNotice('Result updated.');
      await loadLedger();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setGradingId(null);
    }
  };

  const stats = summarize(ledger);
  const controlsBusy = busy || gradingId !== null;
  const rankedPlays = ledger.some(play => play.rank && play.rank <= 8);

  return (
    <div className={styles.page}>
      <a href="#ledger" className={styles.skipLink}>Skip to paper ledger</a>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Big Vin home">BIG VIN<span>.</span></Link>
        <Link href="/" className={styles.backLink}><ArrowLeft size={16} aria-hidden="true" />Back to board</Link>
      </header>

      <main id="ledger" className={styles.main} tabIndex={-1}>
        <section className={styles.intro} aria-labelledby="ledger-title">
          <p className={styles.eyebrow}>THE RECORD</p>
          <h1 id="ledger-title">Paper ledger<span>.</span></h1>
          <p className={styles.description}>Win. Learn. Keep the record. Your saved paper plays, at the exact prices you recorded.</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primaryButton} onClick={() => void refreshResults()} disabled={controlsBusy || !hasLoaded}>
              <RefreshCw size={16} aria-hidden="true" className={busy ? styles.spinning : undefined} />
              Grade final scores
            </button>
            <button type="button" className={styles.secondaryButton} onClick={() => exportLedger(ledger)} disabled={!ledger.length}>
              <Download size={16} aria-hidden="true" />Export log
            </button>
            <button type="button" className={styles.textButton} onClick={() => void loadLedger()} disabled={controlsBusy}>
              Refresh log
            </button>
          </div>
        </section>

        <section className={styles.stats} aria-label="Paper play summary" aria-busy={busy}>
          <div>
            <span>WIN / LEARN / PUSH</span>
            <strong>{hasLoaded ? stats.win + ' / ' + stats.learn + ' / ' + stats.push : '—'}</strong>
            <small>{hasLoaded ? stats.pending + ' pending · ' + stats.void + ' void' : 'Saved results'}</small>
          </div>
          <div>
            <span>NET UNITS</span>
            <strong className={hasLoaded && stats.pnl >= 0 ? styles.positive : undefined}>{hasLoaded ? signed(stats.pnl, 2) : '—'}</strong>
            <small>Actual recorded price</small>
          </div>
          <div>
            <span>WIN RATE</span>
            <strong>{stats.winRate == null ? '—' : (stats.winRate * 100).toFixed(1) + '%'}</strong>
            <small>Pushes excluded</small>
          </div>
          <div>
            <span>RETURN ON RISK</span>
            <strong>{stats.roi == null ? '—' : (stats.roi * 100).toFixed(1) + '%'}</strong>
            <small>Profit ÷ settled risk</small>
          </div>
        </section>

        {error && (
          <div className={styles.message} role="alert">
            <p>{error}</p>
            {ledger.length > 0 && <p>Your last loaded records remain below.</p>}
            <button type="button" className={styles.textButton} onClick={() => void loadLedger()} disabled={controlsBusy}>Try again</button>
          </div>
        )}
        {notice && <output className={styles.notice}>{notice}</output>}

        {!ledger.length ? (
          <section className={styles.empty} aria-live="polite" aria-busy={busy}>
            <ClipboardList size={28} aria-hidden="true" />
            <h2>{busy ? 'Loading your log…' : error ? 'The record is temporarily unavailable.' : 'No saved paper plays yet.'}</h2>
            <p>{busy ? 'Retrieving your recorded lines and results.' : error ? 'Refresh the log to try again.' : 'Existing recorded plays will appear here, with their original prices, risk and results.'}</p>
            {!busy && <Link href="/" className={styles.backLink}>Open game board<ArrowUpRight size={16} aria-hidden="true" /></Link>}
          </section>
        ) : (
          <section className={styles.records} aria-labelledby="plays-title" aria-busy={controlsBusy}>
            <div className={styles.sectionHeading}>
              <h2 id="plays-title">Saved plays</h2>
              <p>{ledger.length} records{busy ? ' · Updating…' : ''}</p>
            </div>
            <ul className={styles.playList}>
              {ledger.map(play => (
                <li key={play.id}>
                  <article className={styles.play} aria-labelledby={'play-' + play.id}>
                    <div className={styles.playHeading}>
                      <div>
                        <p className={styles.playMeta}>
                          {play.sport.toUpperCase()}
                          <span aria-hidden="true"> / </span>
                          Rank {play.rank || '—'}
                        </p>
                        <h3 id={'play-' + play.id}>{play.away}<span className={styles.at}> at </span>{play.home}</h3>
                        <p className={styles.playTime}>
                          <time dateTime={play.start_time}>{formatCentralTime(play.start_time)}</time>
                        </p>
                      </div>
                      <span className={play.outcome === 'win' ? styles.winBadge : styles.resultBadge}>
                        {resultLabels[play.outcome] || play.outcome}
                      </span>
                    </div>

                    <dl className={styles.playDetails}>
                      <div className={styles.selection}>
                        <dt>Selection · {play.market}</dt>
                        <dd>{play.selection === 'home' ? play.home : play.selection === 'away' ? play.away : play.selection}</dd>
                      </div>
                      <div>
                        <dt>Line / price</dt>
                        <dd>{play.market === 'moneyline' ? 'ML' : signed(play.line)} / {signed(play.odds, 0)}</dd>
                      </div>
                      <div>
                        <dt>Risk</dt>
                        <dd>{play.risk}u</dd>
                      </div>
                      <div>
                        <dt>Net units</dt>
                        <dd className={play.pnl != null && play.pnl > 0 ? styles.positive : undefined}>{signed(play.pnl, 2)}</dd>
                      </div>
                    </dl>

                    <div className={styles.playFooter}>
                      <div className={styles.savedDetails}>
                        <p>Recorded <time dateTime={play.created_at}>{formatCentralTime(play.created_at)}</time></p>
                        <p>{play.grade_source || 'Awaiting final'}</p>
                      </div>
                      <label className={styles.grade}>
                        <span>{gradingId === play.id ? 'Saving…' : 'Manual grade'}</span>
                        <select
                          aria-label={'Manually grade ' + play.away + ' at ' + play.home}
                          value={play.outcome}
                          onChange={event => void manualGrade(play.id, event.target.value)}
                          disabled={controlsBusy}
                        >
                          <option value="pending" disabled>Pending</option>
                          <option value="win">Win</option>
                          <option value="learn">Learn</option>
                          <option value="push">Push</option>
                          <option value="void">Void</option>
                        </select>
                      </label>
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          </section>
        )}

        {rankedPlays && (
          <section className={styles.ranks} aria-labelledby="ranks-title">
            <div className={styles.sectionHeading}>
              <h2 id="ranks-title">By recorded rank</h2>
            </div>
            <p className={styles.rankDescription}>Each play’s saved pregame position. These results do not change the model or past selections.</p>
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users need to focus this overflow region to scroll the rank table. */}
            <section className={styles.tableScroll} tabIndex={0} aria-label="Results by recorded rank; scroll horizontally for all columns">
              <table className={styles.rankTable}>
                <caption className={styles.srOnly}>Paper play results for saved ranking positions one through eight</caption>
                <thead>
                  <tr>{['Rank', 'Win', 'Learn', 'Push', 'Pending', 'Net units'].map(heading => <th key={heading} scope="col">{heading}</th>)}</tr>
                </thead>
                <tbody>
                  {Array.from({length: 8}, (_, index) => {
                    const rank = index + 1;
                    const summary = summarize(ledger.filter(play => play.rank === rank));
                    return (
                      <tr key={rank}>
                        <th scope="row">{rank}</th>
                        <td>{summary.win}</td>
                        <td>{summary.learn}</td>
                        <td>{summary.push}</td>
                        <td>{summary.pending}</td>
                        <td>{signed(summary.pnl, 2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          </section>
        )}

        <p className={styles.finePrint}>Latest 1,000 records. Auto-grading checks up to 12 game dates per click and uses final scores including overtime. Manual grades accommodate book-specific rules. Voids return the stake and are excluded from risk; pushes count as settled risk.</p>
      </main>

      <footer className={styles.footer}>
        <span>BIG VIN / GRIND TO WIN</span>
        <Link href="/">Back to the board<ArrowUpRight size={14} aria-hidden="true" /></Link>
      </footer>
    </div>
  );
}
