-- The dashboard summary Claude writes, when the owner turns it on. One row per
-- day keeps the cost to a few calls a day: a row is reused while the facts it
-- was written from are unchanged, or until it is a few hours old.
CREATE TABLE ai_summaries (
  day date PRIMARY KEY,
  -- A hash of the facts the summary was written from.
  facts_hash text NOT NULL,
  headline text,
  points jsonb,
  -- Set when writing failed, so the next try waits instead of retrying on every load.
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((headline IS NOT NULL AND points IS NOT NULL) OR error IS NOT NULL)
);
