CREATE TABLE `odds_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`sport` text NOT NULL,
	`game_id` text,
	`at` text NOT NULL,
	`start_time` text,
	`received_at` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `odds_snapshots_game` ON `odds_snapshots` (`sport`,`game_id`,`at`);