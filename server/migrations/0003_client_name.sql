-- Friendly name per client (e.g. "Home NAS"), set from the dashboard.
-- NULL means "no name": the dashboard falls back to the hostname, then the id.
ALTER TABLE clients ADD COLUMN name TEXT;
