CREATE TABLE IF NOT EXISTS pinned_messages (
    channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    pinned_by  BIGINT NOT NULL REFERENCES users(id),
    pinned_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (channel_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_pinned_messages_channel ON pinned_messages(channel_id);
