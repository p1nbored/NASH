CREATE TABLE `remote_scaffold_state` (
	`key` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`state_json` text NOT NULL,
	CONSTRAINT "remote_scaffold_revision" CHECK("remote_scaffold_state"."revision" >= 0),
	CONSTRAINT "remote_scaffold_json" CHECK(json_valid("remote_scaffold_state"."state_json"))
);
