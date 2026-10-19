import type {Metadata} from 'next';
import ResearchFrame from '@/components/research-frame';
export const metadata:Metadata={title:'October 19, 2026: the day we changed the game | Big Vin',description:'Playbook v1 is frozen. Big Vin and Milly Mate start learning in public.'};
// Published text. Keep it exactly as written.
export default function October19Note(){
 return <ResearchFrame active="note"><article className="panel playbook-note">
  <p className="eyebrow">PUBLISHED OCTOBER 19, 2026 · PLAYBOOK V1 FROZEN</p>
  <h1>October 19, 2026: the day we changed the game</h1>
  <p>Starting today, Big Vin and Milly Mate stop being fixed formulas and start learning in public.</p>
  <p>Everything up to now is frozen as Playbook v1. Every pick we&apos;ve made stays on the record exactly as it was posted, at the original odds, and nothing gets rewritten.</p>
  <p>From here on, each week we&apos;ll test a handful of new ideas next to the live picks. Some will add injury and lineup news, some will tweak how we weigh matchups, and some will change how we size plays. A new idea only takes over after it beats the current playbook on games it had never seen. Lucky streaks and hindsight don&apos;t count.</p>
  <p>Every Tuesday we&apos;ll post the scoreboard, showing what won, what lost, what we&apos;re keeping, and what we&apos;re throwing out.</p>
  <p>We don&apos;t know exactly where this goes. What we do know is that if we try a lot of things, keep score honestly, and hold on to what works, we&apos;ll keep getting better. That&apos;s all we&apos;ve wanted since day one.</p>
  <p className="fine">For entertainment only. Not betting advice.</p>
  <nav className="playbook-note-links" aria-label="Follow the experiment"><a href="/challengers">This week&apos;s challengers ↗</a><a href="/scoreboard">Tuesday scoreboard ↗</a><a href="/challengers#promotions">Promotion history ↗</a></nav>
 </article></ResearchFrame>;
}
