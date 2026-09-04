CREATE TABLE `user_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`google_sub` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`picture` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_user_sessions_google_sub` ON `user_sessions` (`google_sub`);--> statement-breakpoint
CREATE INDEX `idx_user_sessions_expires_at` ON `user_sessions` (`expires_at`);--> statement-breakpoint
PRAGMA optimize;
