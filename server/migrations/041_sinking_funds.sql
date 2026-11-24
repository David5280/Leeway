-- Sinking funds: a yearly or quarterly cost (insurance, a registration, the
-- holidays) saved toward a little each paycheck, so it never lands all at
-- once. Each fund's share of the budget period is held back from the
-- budget's room the way a goal set aside is. Nothing here moves money.
--
-- A fund either follows a yearly or quarterly bill already tracked (bill_id),
-- taking its name, amount and due dates from the bill so nothing is kept
-- twice, or stands alone with its own.
CREATE TABLE sinking_funds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One fund per bill; removing the bill removes its fund.
  bill_id uuid UNIQUE REFERENCES bills (id) ON DELETE CASCADE,
  name text CHECK (length(name) BETWEEN 1 AND 80),
  amount_cents bigint CHECK (amount_cents > 0),
  cadence text CHECK (cadence IN ('quarter', 'year')),
  -- Any due date of the cost: later ones repeat from it by cadence.
  anchor_date date,
  -- The suggestion a standalone fund was added from (a shown name's key, or
  -- "holidays"), so it is not offered again; null for one added by hand.
  source_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (bill_id IS NOT NULL AND name IS NULL AND amount_cents IS NULL AND cadence IS NULL
      AND anchor_date IS NULL AND source_key IS NULL)
    OR (bill_id IS NULL AND name IS NOT NULL AND amount_cents IS NOT NULL
      AND cadence IS NOT NULL AND anchor_date IS NOT NULL)
  )
);

-- Suggestions the owner said no to, by the same key, so they stay away.
CREATE TABLE sinking_fund_dismissals (
  source_key text PRIMARY KEY,
  dismissed_at timestamptz NOT NULL DEFAULT now()
);
