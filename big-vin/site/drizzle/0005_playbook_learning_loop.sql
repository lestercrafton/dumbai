CREATE TABLE `challenger_picks` (
	`id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`sport` text NOT NULL,
	`game_id` text NOT NULL,
	`week_key` text NOT NULL,
	`start_time` text NOT NULL,
	`captured_at` text NOT NULL,
	`published_at` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `challenger_picks_version_week` ON `challenger_picks` (`version_id`,`week_key`);--> statement-breakpoint
CREATE INDEX `challenger_picks_sport_week` ON `challenger_picks` (`sport`,`week_key`);--> statement-breakpoint
CREATE TABLE `challenger_results` (
	`pick_id` text PRIMARY KEY NOT NULL,
	`graded_at` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`pick_id`) REFERENCES `challenger_picks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `playbook_manifests` (
	`id` text PRIMARY KEY NOT NULL,
	`published_at` text NOT NULL,
	`generated_at` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `playbook_manifests_generated` ON `playbook_manifests` (`generated_at`);--> statement-breakpoint
CREATE TABLE `promotions` (
	`id` text PRIMARY KEY NOT NULL,
	`sport` text NOT NULL,
	`effective_at` text NOT NULL,
	`published_at` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `promotions_sport_effective` ON `promotions` (`sport`,`effective_at`);--> statement-breakpoint
CREATE TABLE `scoreboards` (
	`id` text PRIMARY KEY NOT NULL,
	`week_key` text NOT NULL,
	`published_for` text NOT NULL,
	`published_at` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scoreboards_published_for` ON `scoreboards` (`published_for`);