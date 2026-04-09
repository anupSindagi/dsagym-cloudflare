CREATE TABLE `leetcode` (
	`id` integer PRIMARY KEY NOT NULL,
	`rating` real NOT NULL,
	`title` text NOT NULL,
	`title_zh` text,
	`title_slug` text NOT NULL,
	`contest_slug` text,
	`problem_index` text,
	`contest_id_en` text,
	`contest_id_zh` text
);
