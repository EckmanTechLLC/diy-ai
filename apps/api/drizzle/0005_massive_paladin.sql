CREATE TABLE `circuits` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	`circuit` text NOT NULL,
	`origin` text,
	`findings` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `circuits_project_id_position_idx` ON `circuits` (`project_id`,`position`);--> statement-breakpoint
ALTER TABLE `messages` ADD `circuit_id` text REFERENCES circuits(id) ON DELETE set null;--> statement-breakpoint
INSERT INTO `circuits` (`id`, `project_id`, `name`, `position`, `circuit`, `origin`, `findings`, `created_at`, `updated_at`)
SELECT
	lower(hex(randomblob(16))),
	`id`,
	substr(COALESCE(
		NULLIF(trim(CASE WHEN json_valid(`circuit_origin`) THEN json_extract(`circuit_origin`, '$.name') END), ''),
		NULLIF(trim(CASE WHEN json_valid(`circuit`) THEN json_extract(`circuit`, '$.title') END), ''),
		'Circuit 1'
	), 1, 80),
	0,
	`circuit`,
	`circuit_origin`,
	`circuit_findings`,
	`created_at`,
	`updated_at`
FROM `projects`
WHERE `circuit` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `circuit`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `circuit_origin`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `circuit_findings`;