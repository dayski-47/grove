-- Mark DM-backing channels so list_channels can filter them out.
ALTER TABLE channels ADD COLUMN is_dm BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill existing DM channels.
UPDATE channels SET is_dm = TRUE
WHERE id IN (SELECT channel_id FROM direct_messages);
