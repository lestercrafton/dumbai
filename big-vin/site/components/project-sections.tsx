'use client';

import { ArrowRight, ArrowUpRight } from 'lucide-react';
import {DonateButton} from '@/components/donate-button';
export {DonateButton} from '@/components/donate-button';
import { SITE_CONFIG } from '@/lib/site-config';
import styles from './project-sections.module.css';

export default function ProjectSections() {
  const pledgeOpening = '50/50.';
  const pledgeBody = SITE_CONFIG.pledge.slice(pledgeOpening.length).trimStart();

  return (
    <div className={styles.sections}>
      <section id="how-it-works" className={styles.section} aria-labelledby="method-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>02 / THE METHOD</p>
            <h2 id="method-heading">The line behind<br />the edge.</h2>
          </div>
          <p className={styles.sectionIntro}>
            We build our own fair line. Compare it to Vegas.
            Let the difference do the talking.
          </p>
        </div>

        <ol className={styles.methodSteps}>
          <li>
            <span className={styles.stepNumber}>01</span>
            <h3>Rate the teams.</h3>
            <p>Past results tell us how strong each team is. That gives us our starting point.</p>
          </li>
          <li>
            <span className={styles.stepNumber}>02</span>
            <h3>Make the line.</h3>
            <p>Compare the ratings, adjust for home field, and add rest adjustments for the NFL.</p>
          </li>
          <li>
            <span className={styles.stepNumber}>03</span>
            <h3>Find the gap.</h3>
            <p>Compare our fair line to the Vegas market line. Bigger edges rank higher on the board.</p>
          </li>
        </ol>

        <div className={styles.lineExample} aria-label="Illustrative line comparison, not a live pick">
          <div className={styles.exampleCaption}>
            <span className={styles.eyebrow}>A QUICK EXAMPLE</span>
            <span>Same game. Same home team.</span>
            <span className={styles.exampleDisclaimer}>Illustration, not a live pick.</span>
          </div>
          <div className={styles.exampleValue}>
            <span>Our fair line</span>
            <strong>−6.0</strong>
          </div>
          <span className={styles.exampleOperator} aria-hidden="true">vs</span>
          <div className={styles.exampleValue}>
            <span>Vegas line</span>
            <strong>−3.5</strong>
          </div>
          <span className={styles.exampleOperator} aria-hidden="true"><ArrowRight size={15} /></span>
          <div className={`${styles.exampleValue} ${styles.exampleEdge}`}>
            <span>The edge</span>
            <strong>2.5<span>pts</span></strong>
            <span>Home −3.5</span>
          </div>
        </div>
        <p className={styles.edgeNote}>
          Edge is a line difference, not a win probability.
          <span>Data: ESPN · nflverse / nfldata.</span>
        </p>

        <details className={styles.sourceDetails}>
          <summary>
            <span>The math &amp; our data sources</span>
            <span className={styles.detailsIcon} aria-hidden="true" />
          </summary>
          <div className={styles.sourceContent}>
            <div className={styles.formula}>
              <p>
                <span>Expected home margin</span>
                Home rating − away rating + home adjustment + rest adjustment
              </p>
              <p>
                <span>Fair home spread</span>
                The opposite of the expected home margin
              </p>
              <p>
                <span>Edge in points</span>
                The absolute gap between our fair line and the market line
              </p>
              <p className={styles.formulaNote}>
                Rest is applied to NFL games. The home adjustment is zero at neutral sites.
                The Vegas line is the sportsbook quote supplied by ESPN; each game names its bookmaker.
              </p>
            </div>
            <div className={styles.sources}>
              {SITE_CONFIG.dataSources.map((source) => (
                <div key={source.name}>
                  <a href={source.href} target="_blank" rel="noopener noreferrer">
                    {source.name}
                    <ArrowUpRight size={15} aria-hidden="true" />
                    <span className={styles.srOnly}> (opens in a new tab)</span>
                  </a>
                  <p>{source.description}</p>
                </div>
              ))}
            </div>
          </div>
        </details>
      </section>

      <section id="story" className={`${styles.section} ${styles.story}`} aria-labelledby="story-heading">
        <div>
          <p className={styles.eyebrow}>03 / THE STORY</p>
          <h2 id="story-heading">It started with<br />a spreadsheet.</h2>
          <p className={styles.startDate}>FIRST ENTRY <time dateTime="2021-03-22">3/22/21</time></p>
        </div>
        <div className={styles.storyCopy}>
          <p>
            During COVID, Big Vin and his boy Stan started tracking lines by hand.
            One spreadsheet. <span>They found an edge.</span>
          </p>
          <p>
            Now Big Vin is partnering with AI to bring that edge to everyone.
          </p>
        </div>
      </section>

      <section id="pledge" className={`${styles.section} ${styles.pledge}`} aria-labelledby="pledge-heading">
        <div>
          <h2 id="pledge-heading" className={styles.eyebrow}>04 / THE PLEDGE</h2>
          <p className={styles.pledgeCopy}>
            <span className={styles.pledgeNumber}>{pledgeOpening}</span>{' '}
            <span>{pledgeBody}</span>
          </p>
        </div>
      </section>

      <section id="ambassadors" className={`${styles.section} ${styles.ambassadors}`} aria-labelledby="ambassadors-heading">
        <div>
          <p className={styles.eyebrow}>05 / OUR PEOPLE</p>
          <h2 id="ambassadors-heading">Built together.</h2>
        </div>
        <p>
          Grateful to our college ambassadors for working with us to build the
          knowledge we need to finally beat Vegas.
        </p>
      </section>

      <section id="donate" className={`${styles.section} ${styles.donate}`} aria-labelledby="donate-heading">
        <p className={styles.eyebrow}>06 / BACK THE PROJECT</p>
        <h2 id="donate-heading">Help build<br />the next edge.</h2>
        <p>Better data. Better models. A project we build together.</p>
        <DonateButton />
      </section>
    </div>
  );
}
