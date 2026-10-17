CREATE TABLE `collection_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`completed_at` text NOT NULL,
	`sport` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `collection_completed` ON `collection_runs` (`completed_at`);--> statement-breakpoint
CREATE TABLE `forecasts` (
	`id` text PRIMARY KEY NOT NULL,
	`sport` text NOT NULL,
	`week_key` text NOT NULL,
	`cohort` text NOT NULL,
	`start_time` text NOT NULL,
	`captured_at` text NOT NULL,
	`payload` text NOT NULL,
	`result` text,
	`graded_at` text
);
--> statement-breakpoint
CREATE INDEX `forecasts_cohort_sport_week` ON `forecasts` (`cohort`,`sport`,`week_key`);--> statement-breakpoint
CREATE TABLE `learning_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`published_at` text NOT NULL,
	`sport` text NOT NULL,
	`week_key` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `learning_published` ON `learning_entries` (`published_at`);