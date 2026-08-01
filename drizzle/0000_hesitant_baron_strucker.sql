CREATE TABLE `discs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`title` text NOT NULL,
	`media_type` text NOT NULL,
	`year` integer,
	`watchmode_id` integer NOT NULL,
	`imdb_id` text,
	`poster_url` text,
	`genres` text,
	`barcode_upc` text,
	`raw_lookup_title` text,
	`staged_path` text,
	`complete_path` text,
	`staged_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discs_watchmode_id_unique` ON `discs` (`watchmode_id`);--> statement-breakpoint
CREATE TABLE `scan_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`barcode` text,
	`upc_title` text,
	`watchmode_id` integer,
	`outcome` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `unmatched_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`path` text NOT NULL,
	`tree` text NOT NULL,
	`detected_at` integer NOT NULL,
	`best_guess_disc_id` integer,
	`best_guess_score` real,
	`resolution` text DEFAULT 'unresolved' NOT NULL,
	FOREIGN KEY (`best_guess_disc_id`) REFERENCES `discs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unmatched_files_path_unique` ON `unmatched_files` (`path`);