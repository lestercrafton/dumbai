CREATE TABLE `my_bankroll_kalshi` (
	`user_id` text PRIMARY KEY NOT NULL,
	`api_key_id` text NOT NULL,
	`private_key_enc` text NOT NULL,
	`private_key_iv` text NOT NULL,
	`go_full` integer NOT NULL DEFAULT 0,
	`connected_at` text NOT NULL,
	`last_ok_at` text,
	`last_error` text,
	FOREIGN KEY (`user_id`) REFERENCES `my_bankroll_users`(`id`) ON UPDATE no action ON DELETE cascade
);
