-- The home-screen widget's token. It can only read the widget's summary, so
-- it is kept apart from agent keys: neither works where the other belongs.
-- There is at most one, and only its hash is stored.

CREATE TABLE widget_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
