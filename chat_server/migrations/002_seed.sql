-- Seed default general channel
INSERT INTO channels (name) VALUES ('general') ON CONFLICT DO NOTHING;