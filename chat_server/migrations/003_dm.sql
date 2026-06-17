-- direct_messages: tracks the private channel created for each user pair.
-- user_a < user_b is enforced so each pair has exactly one row.
CREATE TABLE direct_messages (
    id         BIGSERIAL PRIMARY KEY,
    user_a     BIGINT NOT NULL REFERENCES users(id),
    user_b     BIGINT NOT NULL REFERENCES users(id),
    channel_id BIGINT NOT NULL REFERENCES channels(id),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (user_a, user_b),
    CHECK  (user_a < user_b)
);

CREATE INDEX idx_dm_user_a ON direct_messages(user_a);
CREATE INDEX idx_dm_user_b ON direct_messages(user_b);
