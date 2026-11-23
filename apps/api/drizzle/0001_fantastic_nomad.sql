CREATE TABLE `llm_endpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`label` text NOT NULL,
	`base_url` text NOT NULL,
	`model` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `llm_endpoints_owner_id_idx` ON `llm_endpoints` (`owner_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`kind` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_project_id_created_at_idx` ON `messages` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`owner_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `key`)
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `circuit_origin` text;