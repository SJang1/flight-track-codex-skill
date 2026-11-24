CREATE TABLE `provider_quota` (
  `provider_id` text PRIMARY KEY NOT NULL,
  `next_allowed_ms` integer NOT NULL
);
