import styles from './results-sport-ticker.module.css';

const sports = [
  {id: 'cfb', code: 'CFB', name: 'College football'},
  {id: 'nfl', code: 'NFL', name: 'Pro football'},
  {id: 'mlb', code: 'MLB', name: 'Baseball'},
  {id: 'nba', code: 'NBA', name: 'Pro basketball'},
  {id: 'wnba', code: 'WNBA', name: "Women's basketball"},
  {id: 'cbb', code: 'CBB', name: 'College hoops'},
  {id: 'nhl', code: 'NHL', name: 'Hockey'},
] as const;

type ResultsSportTickerProps = {
  activeSport: string;
  cohort?: string;
  week?: string;
  version?: string;
};

export default function ResultsSportTicker({activeSport, cohort, week, version}: ResultsSportTickerProps) {
  return <nav className={styles.ticker} aria-label="Results by sport">
    <div className={styles.heading}>
      <span className={styles.eyebrow}>RESULTS BY SPORT</span>
      <span className={styles.prompt}>Choose a scorecard <span aria-hidden="true">↗</span></span>
    </div>
    <div className={styles.scroller}>
      <div className={styles.sports}>
        {sports.map(({id, code, name}) => {
          const selected = id === activeSport;
          const query = new URLSearchParams({sport: id});
          // Formula versions and weeks belong to one sport. Keep them only when
          // linking to the already selected scorecard.
          if (selected) {
            if (cohort) query.set('cohort', cohort);
            if (week) query.set('week', week);
            if (version) query.set('version', version);
          } else {
            query.set('cohort', 'live');
          }
          return <a
            key={id}
            className={`${styles.sport} ${selected ? styles.selected : ''}`}
            href={`/weekly-results?${query.toString()}`}
            aria-current={selected ? 'page' : undefined}
            aria-label={`${code}: ${name} results${selected ? ', current sport' : ''}`}
          >
            <span className={styles.code}>{code}</span>
            <span className={styles.name}>{name}</span>
            <span className={styles.indicator} aria-hidden="true" />
          </a>;
        })}
      </div>
    </div>
  </nav>;
}
