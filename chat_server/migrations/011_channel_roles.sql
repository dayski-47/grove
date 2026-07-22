-- Channel structure & organization: descriptions, freeform categories,
-- private channels with invite codes, and per-member roles.

ALTER TABLE channels
    ADD COLUMN description VARCHAR(500),
    ADD COLUMN category    VARCHAR(100),
    ADD COLUMN is_private  BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN invite_code VARCHAR(12) UNIQUE;

CREATE INDEX idx_channels_category ON channels(category);

ALTER TABLE channel_members
    ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'member';
