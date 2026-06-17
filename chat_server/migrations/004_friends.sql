-- Symmetric friendships. user_a < user_b is enforced so each pair has one row.
CREATE TABLE friendships (
    user_a     BIGINT NOT NULL REFERENCES users(id),
    user_b     BIGINT NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_a, user_b),
    CHECK (user_a < user_b)
);

-- Primary key covers lookups by user_a; user_b needs its own index.
CREATE INDEX idx_friendships_user_b ON friendships(user_b);
