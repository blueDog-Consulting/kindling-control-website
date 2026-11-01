-- Requests to join the invite-only Android test on Google Play.
-- A row lives only until a moderator has added the person to the Play Console tester list
-- (they then delete it from the share page), and the daily cleanup drops any request left
-- unhandled for 90 days. See docs/PRESETS.md, "Android test invites".
CREATE TABLE tester_requests (
  id         TEXT PRIMARY KEY,                   -- random id
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,               -- lower-cased; the Google account used on Google Play
  created_at INTEGER NOT NULL                    -- unix ms
);
CREATE INDEX tester_requests_new ON tester_requests(created_at);
