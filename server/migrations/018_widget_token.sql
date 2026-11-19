-- The home-screen widget's token. It can only read the widget's summary, so
-- it is kept apart from agent keys: neither works where the other belongs.
-- There is at most one, held to that by the key as with weekly_email, and only
-- its hash is stored.

CREATE TABLE widget_tokens (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
