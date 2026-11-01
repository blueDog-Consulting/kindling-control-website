-- Requests to join the invite-only Android test on Google Play. See docs/PRESETS.md, "Android test invites".
--
-- A request only counts once the person confirms it from the email we send (so nobody can queue
-- someone else's address). Until then the name waits in pending_name, next to a hash of the
-- confirmation token. Moderators only see confirmed rows, and delete them once the person is on
-- the Play Console tester list. The daily cleanup drops unconfirmed requests after a day and
-- confirmed ones left unhandled for 90 days after the latest confirmation.
CREATE TABLE tester_requests (
  id            TEXT PRIMARY KEY,                -- random id
  email         TEXT NOT NULL UNIQUE,            -- lower-cased; the Google account used on Google Play
  name          TEXT NOT NULL DEFAULT '',        -- confirmed name (what moderators see)
  confirmed_at  INTEGER,                         -- unix ms of the latest confirmation; NULL = not confirmed yet
  pending_name  TEXT,                            -- name from the latest unconfirmed request
  token_hash    TEXT UNIQUE,                     -- SHA-256 of the confirmation token
  token_expires INTEGER,
  created_at    INTEGER NOT NULL                 -- unix ms
);
CREATE INDEX tester_requests_confirmed ON tester_requests(confirmed_at);
