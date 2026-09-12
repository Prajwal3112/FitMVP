CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`occurred_at` text NOT NULL,
	`training_day` text NOT NULL,
	`payload_json` text NOT NULL,
	`schema_version` integer NOT NULL,
	`prev_hash` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_seq_unique` ON `events` (`seq`);--> statement-breakpoint
CREATE INDEX `events_seq_idx` ON `events` (`seq`);--> statement-breakpoint
CREATE INDEX `events_type_idx` ON `events` (`type`);--> statement-breakpoint
CREATE INDEX `events_training_day_idx` ON `events` (`training_day`);--> statement-breakpoint
CREATE TABLE `projections` (
	`name` text PRIMARY KEY NOT NULL,
	`last_seq` integer NOT NULL,
	`state_json` text NOT NULL,
	`updated_at` text NOT NULL
);
