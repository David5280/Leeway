-- What each paid AI call used and cost, for the owner's monthly limit and the
-- usage shown in Settings. Counts and costs only: never anything that was
-- asked or answered.
CREATE TABLE ai_usage (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- The job that made the call, like summary or paystub (ai/jobs.ts).
  job text NOT NULL CHECK (job ~ '^[a-z_]{1,32}$'),
  model text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 100),
  input_tokens integer NOT NULL CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL CHECK (output_tokens >= 0),
  cache_read_tokens integer NOT NULL CHECK (cache_read_tokens >= 0),
  cache_write_tokens integer NOT NULL CHECK (cache_write_tokens >= 0),
  -- In millionths of a US dollar, at the prices when the call was made.
  cost_micros bigint NOT NULL CHECK (cost_micros >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A month's spend is summed by time.
CREATE INDEX ai_usage_created ON ai_usage (created_at);

-- The spending alerts raised in a month, each once: a warning at 80% of the
-- limit, and the limit itself. The owner can dismiss one; a new month starts clean.
CREATE TABLE ai_spend_alerts (
  -- The first day of the month, in the owner's time zone.
  month date NOT NULL,
  level text NOT NULL CHECK (level IN ('warning', 'limit')),
  raised_at timestamptz NOT NULL,
  dismissed_at timestamptz,
  PRIMARY KEY (month, level)
);
