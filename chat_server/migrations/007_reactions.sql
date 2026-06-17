CREATE TABLE reactions (
    id         BIGSERIAL PRIMARY KEY,
    message_id BIGINT    NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    BIGINT    NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    emoji      VARCHAR(8) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (message_id, user_id, emoji)
);

CREATE INDEX idx_reactions_message ON reactions(message_id);
