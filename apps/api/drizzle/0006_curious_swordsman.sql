ALTER TABLE `circuits` ADD `plan` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `plan` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `inventory` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `plan_options` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `plan_built_at` integer;