-- Planning: balance history for net worth, debt terms, bills, savings goals,
-- and recurring charges the owner said are not bills.

-- One balance per account per day, so net worth can be charted over time.
CREATE TABLE balance_history (
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  day date NOT NULL,
  balance_cents bigint NOT NULL,
  PRIMARY KEY (account_id, day)
);

-- Records every balance change, from bank sync or a hand edit, in one place.
-- Days are the database's own date (UTC on most hosts); a chart of net worth
-- does not need finer than that.
CREATE FUNCTION record_balance() RETURNS trigger AS $$
BEGIN
  IF NEW.balance_cents IS NOT NULL THEN
    INSERT INTO balance_history (account_id, day, balance_cents)
    VALUES (NEW.id, current_date, NEW.balance_cents)
    ON CONFLICT (account_id, day) DO UPDATE SET balance_cents = EXCLUDED.balance_cents;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER accounts_record_balance
  AFTER INSERT OR UPDATE OF balance_cents ON accounts
  FOR EACH ROW EXECUTE FUNCTION record_balance();

-- Start the history from today's balances.
INSERT INTO balance_history (account_id, day, balance_cents)
SELECT id, current_date, balance_cents FROM accounts WHERE balance_cents IS NOT NULL;

-- Interest and minimum payment for credit cards and loans. Banks rarely send
-- these, so the owner (or an agent) fills them in. APR is in basis points:
-- 2499 means 24.99%.
ALTER TABLE accounts
  ADD COLUMN apr_bps integer CHECK (apr_bps BETWEEN 0 AND 10000),
  ADD COLUMN minimum_payment_cents bigint CHECK (minimum_payment_cents >= 0);

-- A merchant name reduced to what stays the same between charges, so
-- "NETFLIX.COM 8473 CA" and "Netflix.com #1192 CA" both read "netflix com ca".
-- Must match merchantKey() in server/src/domain/recurring.ts.
CREATE FUNCTION merchant_key(text) RETURNS text AS $$
  SELECT trim(regexp_replace(regexp_replace(lower($1), '[0-9#*]+', ' ', 'g'), '[^a-z]+', ' ', 'g'))
$$ LANGUAGE sql IMMUTABLE;

-- Bills and subscriptions. Due dates repeat from anchor_date by cadence; a
-- transaction whose merchant or description contains match_pattern (both
-- compared as merchant keys) counts as paying it.
CREATE TABLE bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'bill' CHECK (kind IN ('bill', 'subscription')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  cadence text NOT NULL CHECK (cadence IN ('week', 'biweek', 'semimonth', 'month', 'quarter', 'year')),
  anchor_date date NOT NULL,
  match_pattern text,
  category_id uuid REFERENCES categories (id) ON DELETE SET NULL,
  autopay boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Savings goals. Progress is the linked account's balance, or saved_cents
-- when no account is linked.
CREATE TABLE goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  target_cents bigint NOT NULL CHECK (target_cents > 0),
  target_date date,
  account_id uuid REFERENCES accounts (id) ON DELETE SET NULL,
  saved_cents bigint NOT NULL DEFAULT 0,
  color text NOT NULL DEFAULT '#4f8cff',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Recurring charges the owner dismissed, by their merchant key, so detection
-- stops suggesting them.
CREATE TABLE dismissed_recurring (
  merchant_key text PRIMARY KEY,
  dismissed_at timestamptz NOT NULL DEFAULT now()
);
