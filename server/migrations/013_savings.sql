-- Account kinds and savings: the kind the owner says an account is, and
-- balance history recorded on the owner's own calendar day.

-- The owner's choice of kind for an account. NULL follows the automatic kind
-- from the bank's type and subtype (domain/accountKinds.ts).
ALTER TABLE accounts ADD COLUMN kind text
  CHECK (kind IN ('checking', 'savings', 'retirement', 'investment', 'credit_card', 'loan', 'other'));

-- The owner's calendar day, by the time zone in settings. Balance history was
-- dated by the database's clock (UTC on most hosts), so a sync on a Denver
-- evening landed on tomorrow. An unknown zone falls back to the database's
-- date rather than failing whatever asked, such as the sync that changed a
-- balance.
CREATE OR REPLACE FUNCTION owner_today() RETURNS date AS $$
DECLARE
  zone text;
BEGIN
  SELECT data->>'timeZone' INTO zone FROM settings;
  RETURN (now() AT TIME ZONE coalesce(zone, 'UTC'))::date;
EXCEPTION WHEN invalid_parameter_value THEN
  RETURN current_date;
END
$$ LANGUAGE plpgsql STABLE;

-- Each balance is now dated by the owner's day.
CREATE OR REPLACE FUNCTION record_balance() RETURNS trigger AS $$
BEGIN
  IF NEW.balance_cents IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO balance_history (account_id, day, balance_cents)
  VALUES (NEW.id, owner_today(), NEW.balance_cents)
  ON CONFLICT (account_id, day) DO UPDATE SET balance_cents = EXCLUDED.balance_cents;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- Every account with a balance gets at least one day of history: its balance
-- on the owner's today. Accounts that already have history keep it as it is.
INSERT INTO balance_history (account_id, day, balance_cents)
SELECT id, owner_today(), balance_cents FROM accounts a
WHERE balance_cents IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM balance_history h WHERE h.account_id = a.id);
