CREATE TABLE `tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`storage_key` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`size` integer NOT NULL,
	`duration` real DEFAULT 0 NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_code`) REFERENCES `rooms`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tracks_room_position` ON `tracks` (`room_code`,`position`);--> statement-breakpoint
CREATE INDEX `idx_tracks_room` ON `tracks` (`room_code`);--> statement-breakpoint
ALTER TABLE `rooms` ADD `current_track_id` text;--> statement-breakpoint
PRAGMA optimize;
