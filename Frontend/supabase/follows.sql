-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor).

-- The follows table stores each user's followed artists, keyed by
-- their Supabase auth.uid (GitHub login).
CREATE TABLE IF NOT EXISTS follows (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  artist_id   text NOT NULL,
  artist_name text NOT NULL DEFAULT '',
  artist_thumb text NOT NULL DEFAULT '',
  created_at  timestamptz DEFAULT now(),
  UNIQUE(user_id, artist_id)
);

-- Row-Level Security: each user can only see / edit their own follows.
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own follows"
  ON follows FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own follows"
  ON follows FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own follows"
  ON follows FOR DELETE
  USING (auth.uid() = user_id);
