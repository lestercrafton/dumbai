CREATE TABLE `read_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`status` integer NOT NULL,
	`headers` text NOT NULL,
	`rendered_at` text NOT NULL,
	`source` text NOT NULL,
	`parts` integer NOT NULL,
	`body` text NOT NULL,
	`registered_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `read_cache_rendered` ON `read_cache` (`rendered_at`);--> statement-breakpoint
CREATE TABLE `read_cache_parts` (
	`key` text NOT NULL,
	`rendered_at` text NOT NULL,
	`part` integer NOT NULL,
	`body` text NOT NULL,
	PRIMARY KEY(`key`, `rendered_at`, `part`)
);
--> statement-breakpoint
CREATE INDEX `feed_cache_fetched` ON `feed_cache` (`fetched_at`);--> statement-breakpoint
CREATE INDEX `collection_sport_completed` ON `collection_runs` (`sport`,`completed_at`);--> statement-breakpoint
CREATE INDEX `completed_games_observed` ON `completed_games` (`observed_at`);--> statement-breakpoint
CREATE INDEX `forecasts_sport_id` ON `forecasts` (`sport`,`id`);--> statement-breakpoint
CREATE INDEX `forecasts_sport_start` ON `forecasts` (`sport`,`start_time`);--> statement-breakpoint
CREATE INDEX `forecasts_graded` ON `forecasts` (`graded_at`);