-- Sinking funds: a yearly or quarterly cost (insurance, a registration, an
-- annual subscription, the holidays) saved toward a little each budget
-- period, so it never lands all at once. What a fund holds back each period
-- comes out of the budget's room the way a goal set aside does. Nothing here
-- moves money.
--
-- source_key is the suggestion a fund was added from (a merchant key, or
-- "holidays"), so the same suggestion is not offered again; null for one
-- added by hand. It touches no other table, so it applies cleanly whatever
-- order it merges in beside migrations 025 to 030.
CREATE TABLE sinking_funds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  cadence text NOT NULL CHECK (cadence IN ('quarter', 'year')),
  -- Any due date of the cost: later ones repeat from it by cadence.
  anchor_date date NOT NULL,
  source_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Suggestions the owner said no to, by the same key, so they stay away.
CREATE TABLE sinking_fund_dismissals (
  source_key text PRIMARY KEY,
  dismissed_at timestamptz NOT NULL DEFAULT now()
);
