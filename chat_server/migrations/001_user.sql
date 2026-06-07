-- /migrations/001_user.sql 

-- users table
CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(32) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- channels table
CREATE TABLE channels (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- messages table
CREATE TABLE messages (
    id BIGSERIAL PRIMARY KEY,
    channel_id BIGINT REFERENCES channels(id),
    user_id BIGINT REFERENCES users(id),
    text TEXT NOT NULL,
    timestamp INTEGER NOT NULL,  -- Unix timestamp
    created_at TIMESTAMP DEFAULT NOW()
);

-- indexes for fast queries
CREATE INDEX idx_messages_channel ON messages(channel_id, id DESC);
CREATE INDEX idx_messages_user ON messages(user_id);
