CREATE TABLE `pick_revision_states` (
	`forecast_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`forecast_id`) REFERENCES `forecasts`(`id`) ON UPDATE no action ON DELETE no action
);
