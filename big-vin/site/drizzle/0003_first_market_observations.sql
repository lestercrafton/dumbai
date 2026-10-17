CREATE TABLE `first_market_observations` (
	`forecast_id` text PRIMARY KEY NOT NULL,
	`observed_at` text NOT NULL,
	`recorded_at` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`forecast_id`) REFERENCES `forecasts`(`id`) ON UPDATE no action ON DELETE no action
);
