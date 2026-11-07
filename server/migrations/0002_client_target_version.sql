-- Per-client upgrade target. When set it wins over the global
-- settings.target_client_version, so one client can be upgraded first.
ALTER TABLE clients ADD COLUMN target_version TEXT;
