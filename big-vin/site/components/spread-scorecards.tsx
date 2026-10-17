import styles from './spread-scorecards.module.css';

export type SpreadSummary={wins:number;losses:number;pushes:number;pending:number;graded:number;recorded:number;offered?:number;winRate:number|null};

type Period={name:string;caption:string;summary:SpreadSummary|null|undefined};

export default function SpreadScorecards({day,week,overall}:{day:Period;week:Period;overall:Period}){
 return <section className={styles.grid} aria-label="Against-the-spread results by period">
  {[day,week,overall].map(({name,caption,summary})=><article className={styles.card} key={name}>
   <div className={styles.heading}><span>{name}</span><small>{caption}</small></div>
   <strong className={styles.rate}>{summary?.winRate==null?'—':`${(summary.winRate*100).toFixed(1)}%`}</strong>
   <div className={styles.record}><b>{summary?`${summary.wins}–${summary.losses}${summary.pushes?`–${summary.pushes}`:''}`:'—'}</b><span>Win–Learn{summary?.pushes?'–Push':''} · against the spread</span></div>
   <small className={styles.status}>{summary?`${summary.graded} of ${summary.offered??summary.recorded} lines graded${summary.pending?` · ${summary.pending} pending`:''}`:'Awaiting results'}</small>
  </article>)}
 </section>;
}
