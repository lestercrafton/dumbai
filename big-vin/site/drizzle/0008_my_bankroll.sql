CREATE TABLE `my_bankroll_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`created_at` text NOT NULL,
	`last_login_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `my_bankroll_users_email` ON `my_bankroll_users` (`email`);
--> statement-breakpoint
CREATE TABLE `my_bankroll_starts` (
	`user_id` text NOT NULL,
	`sport` text NOT NULL,
	`start` real NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `sport`),
	FOREIGN KEY (`user_id`) REFERENCES `my_bankroll_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `my_bankroll_otps` (
	`email` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`attempts` integer NOT NULL DEFAULT 0,
	`created_at` text NOT NULL
);
