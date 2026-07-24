CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text DEFAULT '' NOT NULL,
	`property_id` text,
	`kind` text DEFAULT 'outreach' NOT NULL,
	`channel` text DEFAULT 'call' NOT NULL,
	`draft` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`compliance_warnings` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`decided_at` text,
	`recipient` text,
	`delivery_status` text,
	`delivered_at` text,
	`provider_message_id` text,
	`delivery_error` text
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text DEFAULT '' NOT NULL,
	`actor` text DEFAULT 'agent' NOT NULL,
	`action` text NOT NULL,
	`entity_type` text DEFAULT '' NOT NULL,
	`entity_id` text DEFAULT '' NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `contact_permissions` (
	`property_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text DEFAULT '' NOT NULL,
	`do_not_contact` integer DEFAULT false NOT NULL,
	`phone_allowed` integer DEFAULT true NOT NULL,
	`email_allowed` integer DEFAULT true NOT NULL,
	`mail_allowed` integer DEFAULT true NOT NULL,
	`text_allowed` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text DEFAULT '' NOT NULL,
	`property_id` text NOT NULL,
	`type` text DEFAULT 'phone' NOT NULL,
	`value` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text DEFAULT '' NOT NULL,
	`property_id` text NOT NULL,
	`name` text NOT NULL,
	`doc_type` text DEFAULT 'document' NOT NULL,
	`source` text DEFAULT 'user' NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`recorded_date` text,
	`amount` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `listing_connections` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`board` text NOT NULL,
	`member_confirmed` integer DEFAULT false NOT NULL,
	`agreement_confirmed` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `model_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text DEFAULT '' NOT NULL,
	`agent` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`fallback_count` integer DEFAULT 0 NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `offers` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text DEFAULT '' NOT NULL,
	`property_id` text NOT NULL,
	`party` text DEFAULT '' NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text DEFAULT '' NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'owner' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `properties` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text DEFAULT '' NOT NULL,
	`address` text NOT NULL,
	`neighborhood` text DEFAULT '' NOT NULL,
	`owner_name` text DEFAULT 'Owner not provided' NOT NULL,
	`status` text DEFAULT 'review' NOT NULL,
	`status_label` text DEFAULT 'Needs review' NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`equity` text DEFAULT '' NOT NULL,
	`ownership_years` integer DEFAULT 0 NOT NULL,
	`last_contact` text DEFAULT '' NOT NULL,
	`follow_up_date` text,
	`next_action` text DEFAULT '' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`map_class` text DEFAULT 'parcel-a' NOT NULL,
	`source` text DEFAULT 'import' NOT NULL,
	`latitude` real,
	`longitude` real,
	`bbl` text,
	`bin` text,
	`assessed_value` integer,
	`year_built` integer,
	`owner_mailing_address` text,
	`enriched` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `property_people` (
	`workspace_id` text DEFAULT '' NOT NULL,
	`property_id` text NOT NULL,
	`person_id` text NOT NULL,
	`relationship` text DEFAULT 'owner' NOT NULL,
	PRIMARY KEY(`property_id`, `person_id`)
);
--> statement-breakpoint
CREATE TABLE `saved_neighborhoods` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text DEFAULT '' NOT NULL,
	`name` text NOT NULL,
	`search` text DEFAULT '' NOT NULL,
	`status_filter` text DEFAULT 'all' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `signals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text DEFAULT '' NOT NULL,
	`property_id` text NOT NULL,
	`type` text NOT NULL,
	`value` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'lead_note' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `suppressions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'phone' NOT NULL,
	`value` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text DEFAULT '' NOT NULL,
	`property_id` text,
	`title` text NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`due` text DEFAULT 'Today' NOT NULL,
	`time` text DEFAULT '' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `timeline_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text DEFAULT '' NOT NULL,
	`property_id` text NOT NULL,
	`type` text DEFAULT 'note' NOT NULL,
	`title` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`event_date` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'google' NOT NULL,
	`provider_sub` text NOT NULL,
	`email` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'owner' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
