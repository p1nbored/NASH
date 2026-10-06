CREATE TABLE `scaffold_challenges` (
	`challenge_hash` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`device_ref` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT "scaffold_challenges_expiry_order" CHECK("scaffold_challenges"."expires_at" > "scaffold_challenges"."created_at")
);
--> statement-breakpoint
CREATE INDEX `scaffold_challenges_owner_expiry` ON `scaffold_challenges` (`owner_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `scaffold_challenges_expiry` ON `scaffold_challenges` (`expires_at`);--> statement-breakpoint
CREATE TABLE `scaffold_rate_windows` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`calls` integer NOT NULL,
	CONSTRAINT "scaffold_rate_windows_calls" CHECK("scaffold_rate_windows"."calls" BETWEEN 1 AND 30),
	CONSTRAINT "scaffold_rate_windows_expiry_order" CHECK("scaffold_rate_windows"."expires_at" > "scaffold_rate_windows"."window_start")
);
--> statement-breakpoint
CREATE INDEX `scaffold_rate_windows_expiry` ON `scaffold_rate_windows` (`expires_at`);--> statement-breakpoint
CREATE TABLE `scaffold_workspaces` (
	`workspace_ref` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`label` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "scaffold_workspaces_label_length" CHECK(length("scaffold_workspaces"."label") BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE INDEX `scaffold_workspaces_owner` ON `scaffold_workspaces` (`owner_id`,`created_at`);