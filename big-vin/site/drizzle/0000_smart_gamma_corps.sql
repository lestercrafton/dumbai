CREATE TABLE `feed_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plays` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`sport` text NOT NULL,
	`game_id` text NOT NULL,
	`start_time` text NOT NULL,
	`home` text NOT NULL,
	`away` text NOT NULL,
	`market` text NOT NULL,
	`selection` text NOT NULL,
	`line` real,
	`odds` real NOT NULL,
	`risk` real NOT NULL,
	`model_margin` real,
	`model_as_of` text,
	`snapshot_at` text NOT NULL,
	`provider` text NOT NULL,
	`rank` real,
	`outcome` text DEFAULT 'pending' NOT NULL,
	`pnl` real,
	`graded_at` text,
	`grade_source` text,
	`home_score` real,
	`away_score` real
);
--> statement-breakpoint
CREATE INDEX `plays_created` ON `plays` (`created_at`);