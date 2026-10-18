import {sqliteTable,text,real,index} from 'drizzle-orm/sqlite-core';
export const plays=sqliteTable('plays',{
 id:text('id').primaryKey(),createdAt:text('created_at').notNull(),sport:text('sport').notNull(),gameId:text('game_id').notNull(),startTime:text('start_time').notNull(),home:text('home').notNull(),away:text('away').notNull(),market:text('market').notNull(),selection:text('selection').notNull(),line:real('line'),odds:real('odds').notNull(),risk:real('risk').notNull(),modelMargin:real('model_margin'),modelAsOf:text('model_as_of'),snapshotAt:text('snapshot_at').notNull(),provider:text('provider').notNull(),rank:real('rank'),outcome:text('outcome').notNull().default('pending'),pnl:real('pnl'),gradedAt:text('graded_at'),gradeSource:text('grade_source'),homeScore:real('home_score'),awayScore:real('away_score')
},t=>[index('plays_created').on(t.createdAt)]);
export const cache=sqliteTable('feed_cache',{key:text('key').primaryKey(),payload:text('payload').notNull(),fetchedAt:text('fetched_at').notNull()});
export const completedGames=sqliteTable('completed_games',{key:text('key').primaryKey(),sport:text('sport').notNull(),payload:text('payload').notNull(),observedAt:text('observed_at').notNull()},t=>[index('completed_games_sport').on(t.sport)]);
export const forecasts=sqliteTable('forecasts',{
 id:text('id').primaryKey(),sport:text('sport').notNull(),weekKey:text('week_key').notNull(),cohort:text('cohort').notNull(),startTime:text('start_time').notNull(),capturedAt:text('captured_at').notNull(),payload:text('payload').notNull(),result:text('result'),gradedAt:text('graded_at')
},t=>[index('forecasts_cohort_sport_week').on(t.cohort,t.sport,t.weekKey)]);
export const learningEntries=sqliteTable('learning_entries',{
 id:text('id').primaryKey(),publishedAt:text('published_at').notNull(),sport:text('sport').notNull(),weekKey:text('week_key').notNull(),payload:text('payload').notNull()
},t=>[index('learning_published').on(t.publishedAt)]);
export const collectionRuns=sqliteTable('collection_runs',{
 id:text('id').primaryKey(),completedAt:text('completed_at').notNull(),sport:text('sport').notNull(),payload:text('payload').notNull()
},t=>[index('collection_completed').on(t.completedAt)]);
export const firstMarketObservations=sqliteTable('first_market_observations',{
 forecastId:text('forecast_id').primaryKey().references(()=>forecasts.id),observedAt:text('observed_at').notNull(),recordedAt:text('recorded_at').notNull(),payload:text('payload').notNull()
});
export const pickRevisionStates=sqliteTable('pick_revision_states',{
 forecastId:text('forecast_id').primaryKey().references(()=>forecasts.id),payload:text('payload').notNull()
});
