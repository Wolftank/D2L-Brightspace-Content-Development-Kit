ALTER TABLE `builds` ADD `error` text;--> statement-breakpoint
CREATE UNIQUE INDEX `builds_project_version` ON `builds` (`project_id`,`version`);