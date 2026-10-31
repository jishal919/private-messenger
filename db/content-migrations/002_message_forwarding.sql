-- Safe additive migration for message forwarding indicator
ALTER TABLE messages ADD COLUMN is_forwarded INTEGER DEFAULT 0;
