CREATE TABLE `members` (
	`room_code` text NOT NULL,
	`id` text NOT NULL,
	`display_name` text NOT NULL,
	`is_host` integer DEFAULT false NOT NULL,
	`last_seen` integer NOT NULL,
	PRIMARY KEY(`room_code`, `id`),
	FOREIGN KEY (`room_code`) REFERENCES `rooms`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_members_room_seen` ON `members` (`room_code`,`last_seen`);--> statement-breakpoint
CREATE TABLE `reactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_code` text NOT NULL,
	`member_name` text NOT NULL,
	`emoji` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_code`) REFERENCES `rooms`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_reactions_room_created` ON `reactions` (`room_code`,`created_at`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`host_token` text NOT NULL,
	`track_key` text NOT NULL,
	`track_name` text NOT NULL,
	`track_type` text NOT NULL,
	`track_size` integer NOT NULL,
	`duration` real DEFAULT 0 NOT NULL,
	`is_playing` integer DEFAULT false NOT NULL,
	`position` real DEFAULT 0 NOT NULL,
	`position_updated_at` integer NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`host_only` integer DEFAULT true NOT NULL,
	`reactions_enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rooms_expires_at` ON `rooms` (`expires_at`);--> statement-breakpoint
PRAGMA optimize;
