import styles from './results-sport-ticker.module.css';

export const SPORT_TILES = [
  {id: 'cfb', code: 'CFB', name: 'College football'},
  {id: 'nfl', code: 'NFL', name: 'Pro football'},
  {id: 'mlb', code: 'MLB', name: 'Baseball'},
  {id: 'nba', code: 'NBA', name: 'Pro basketball'},
  {id: 'wnba', code: 'WNBA', name: "Women's basketball"},
  {id: 'cbb', code: 'CBB', name: 'College hoops'},
  {id: 'nhl', code: 'NHL', name: 'Hockey'},
] as const;

/** Tile sport picker for the game board, in the same style as the
 * results-page scorecard picker. Buttons, not links: picking a sport
 * swaps the board in place. */
export default function SportPicker({value, onChange}: {value: string, onChange: (sport: string) => void}) {
  return <div className={`${styles.ticker} ${styles.picker}`}>
    <div className={styles.heading}>
      <span className={styles.eyebrow}>GAME BOARD BY SPORT</span>
      <span className={styles.prompt}>Choose your sport</span>
    </div>
    <div className={styles.scroller}>
      <div className={styles.sports} role="group" aria-label="Choose your sport">
        {SPORT_TILES.map(({id, code, name}) => {
          const selected = id === value;
          return <button
            key={id}
            type="button"
            className={`${styles.sport} ${styles.sportButton} ${selected ? styles.selected : ''}`}
            aria-pressed={selected}
            aria-label={`${code}: ${name}${selected ? ', current sport' : ''}`}
            onClick={() => onChange(id)}
          >
            <span className={styles.code}>{code}</span>
            <span className={styles.name}>{name}</span>
            <span className={styles.indicator} aria-hidden="true" />
          </button>;
        })}
      </div>
    </div>
  </div>;
}
