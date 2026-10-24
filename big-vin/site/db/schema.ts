import {sqliteTable,text,real,integer,index,primaryKey} from 'drizzle-orm/sqlite-core';
export const plays=sqliteTable('plays',{
 id:text('id').primaryKey(),createdAt:text('created_at').notNull(),sport:text('sport').notNull(),gameId:text('game_id').notNull(),startTime:text('start_time').notNull(),home:text('home').notNull(),away:text('away').notNull(),market:text('market').notNull(),selection:text('selection').notNull(),line:real('line'),odds:real('odds').notNull(),risk:real('risk').notNull(),modelMargin:real('model_margin'),modelAsOf:text('model_as_of'),snapshotAt:text('snapshot_at').notNull(),provider:text('provider').notNull(),rank:real('rank'),outcome:text('outcome').notNull().default('pending'),pnl:real('pnl'),gradedAt:text('graded_at'),gradeSource:text('grade_source'),homeScore:real('home_score'),awayScore:real('away_score')
},t=>[index('plays_created').on(t.createdAt)]);
export const cache=sqliteTable('feed_cache',{key:text('key').primaryKey(),payload:text('payload').notNull(),fetchedAt:text('fetched_at').notNull()},t=>[index('feed_cache_fetched').on(t.fetchedAt)]);
export const completedGames=sqliteTable('completed_games',{key:text('key').primaryKey(),sport:text('sport').notNull(),payload:text('payload').notNull(),observedAt:text('observed_at').notNull()},t=>[index('completed_games_sport').on(t.sport),index('completed_games_observed').on(t.observedAt)]);
export const forecasts=sqliteTable('forecasts',{
 id:text('id').primaryKey(),sport:text('sport').notNull(),weekKey:text('week_key').notNull(),cohort:text('cohort').notNull(),startTime:text('start_time').notNull(),capturedAt:text('captured_at').notNull(),payload:text('payload').notNull(),result:text('result'),gradedAt:text('graded_at')
},t=>[index('forecasts_cohort_sport_week').on(t.cohort,t.sport,t.weekKey),index('forecasts_sport_id').on(t.sport,t.id),index('forecasts_sport_start').on(t.sport,t.startTime),index('forecasts_graded').on(t.gradedAt)]);
export const learningEntries=sqliteTable('learning_entries',{
 id:text('id').primaryKey(),publishedAt:text('published_at').notNull(),sport:text('sport').notNull(),weekKey:text('week_key').notNull(),payload:text('payload').notNull()
},t=>[index('learning_published').on(t.publishedAt)]);
export const collectionRuns=sqliteTable('collection_runs',{
 id:text('id').primaryKey(),completedAt:text('completed_at').notNull(),sport:text('sport').notNull(),payload:text('payload').notNull()
},t=>[index('collection_completed').on(t.completedAt),index('collection_sport_completed').on(t.sport,t.completedAt)]);
export const firstMarketObservations=sqliteTable('first_market_observations',{
 forecastId:text('forecast_id').primaryKey().references(()=>forecasts.id),observedAt:text('observed_at').notNull(),recordedAt:text('recorded_at').notNull(),payload:text('payload').notNull()
});
export const pickRevisionStates=sqliteTable('pick_revision_states',{
 forecastId:text('forecast_id').primaryKey().references(()=>forecasts.id),payload:text('payload').notNull()
});
// Learning loop (October 19, 2026). Additive only: pick and price rows above are never altered.
export const playbookManifests=sqliteTable('playbook_manifests',{id:text('id').primaryKey(),publishedAt:text('published_at').notNull(),generatedAt:text('generated_at').notNull(),payload:text('payload').notNull()},t=>[index('playbook_manifests_generated').on(t.generatedAt)]);
export const challengerPicks=sqliteTable('challenger_picks',{
 id:text('id').primaryKey(),versionId:text('version_id').notNull(),sport:text('sport').notNull(),gameId:text('game_id').notNull(),weekKey:text('week_key').notNull(),startTime:text('start_time').notNull(),capturedAt:text('captured_at').notNull(),publishedAt:text('published_at').notNull(),payload:text('payload').notNull()
},t=>[index('challenger_picks_version_week').on(t.versionId,t.weekKey),index('challenger_picks_sport_week').on(t.sport,t.weekKey)]);
export const challengerResults=sqliteTable('challenger_results',{pickId:text('pick_id').primaryKey().references(()=>challengerPicks.id),gradedAt:text('graded_at').notNull(),payload:text('payload').notNull()});
export const scoreboards=sqliteTable('scoreboards',{id:text('id').primaryKey(),weekKey:text('week_key').notNull(),publishedFor:text('published_for').notNull(),publishedAt:text('published_at').notNull(),payload:text('payload').notNull()},t=>[index('scoreboards_published_for').on(t.publishedFor)]);
export const promotions=sqliteTable('promotions',{id:text('id').primaryKey(),sport:text('sport').notNull(),effectiveAt:text('effective_at').notNull(),publishedAt:text('published_at').notNull(),payload:text('payload').notNull()},t=>[index('promotions_sport_effective').on(t.sport,t.effectiveAt)]);
export const oddsSnapshots=sqliteTable('odds_snapshots',{id:text('id').primaryKey(),type:text('type').notNull(),sport:text('sport').notNull(),gameId:text('game_id'),at:text('at').notNull(),startTime:text('start_time'),receivedAt:text('received_at').notNull(),payload:text('payload').notNull()},t=>[index('odds_snapshots_game').on(t.sport,t.gameId,t.at)]);
// Read cache (October 19, 2026). Precomputed public API responses, so visitor
// requests on the Cloudflare free plan read one row instead of recomputing.
export const readCache=sqliteTable('read_cache',{key:text('key').primaryKey(),status:integer('status').notNull(),headers:text('headers').notNull(),renderedAt:text('rendered_at').notNull(),source:text('source').notNull(),parts:integer('parts').notNull(),body:text('body').notNull(),registeredAt:text('registered_at').notNull()},t=>[index('read_cache_rendered').on(t.renderedAt)]);
export const readCacheParts=sqliteTable('read_cache_parts',{key:text('key').notNull(),renderedAt:text('rendered_at').notNull(),part:integer('part').notNull(),body:text('body').notNull()},t=>[primaryKey({columns:[t.key,t.renderedAt,t.part]})]);

// My Bankroll (personal Kelly bankrolls). Email OTP login; no passwords.
export const myBankrollUsers=sqliteTable('my_bankroll_users',{
 id:text('id').primaryKey(),email:text('email').notNull().unique(),createdAt:text('created_at').notNull(),lastLoginAt:text('last_login_at')
});
export const myBankrollStarts=sqliteTable('my_bankroll_starts',{
 userId:text('user_id').notNull().references(()=>myBankrollUsers.id),sport:text('sport').notNull(),start:real('start').notNull(),effectiveFrom:text('effective_from'),updatedAt:text('updated_at').notNull()
},t=>[primaryKey({columns:[t.userId,t.sport]})]);
export const myBankrollOtps=sqliteTable('my_bankroll_otps',{
 email:text('email').primaryKey(),codeHash:text('code_hash').notNull(),expiresAt:text('expires_at').notNull(),attempts:integer('attempts').notNull().default(0),createdAt:text('created_at').notNull()
});
