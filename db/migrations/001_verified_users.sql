-- Apply once to an existing Core database. This preserves existing users
-- and verifies only the case-insensitive Jishal account.
ALTER TABLE users
ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 0;

UPDATE users
SET is_verified = 1
WHERE username = 'Jishal' COLLATE NOCASE;
