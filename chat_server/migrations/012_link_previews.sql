-- Link preview cache. Global, not per-user — a URL's metadata doesn't
-- depend on who's asking, so the first person anywhere to hit a link
-- is the only one who ever pays the fetch cost within the TTL window.
CREATE TABLE link_previews (
    url_hash    CHAR(64) PRIMARY KEY,
    url         TEXT NOT NULL,
    title       TEXT,
    description TEXT,
    image_url   TEXT,
    fetched_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
