CREATE TABLE `completed_games` (
	`key` text PRIMARY KEY NOT NULL,
	`sport` text NOT NULL,
	`payload` text NOT NULL,
	`observed_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `completed_games_sport` ON `completed_games` (`sport`);