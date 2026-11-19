-- Account kinds and savings: the kind the owner says an account is, and
-- balance history recorded on the owner's own calendar day.

-- The owner's choice of kind for an account. NULL follows the automatic kind
-- from the bank's type and subtype (domain/accountKinds.ts).
ALTER TABLE accounts ADD COLUMN kind text
  CHECK (kind IN ('checking', 'savings', 'retirement', 'investment', 'credit_card', 'loan', 'other'));

-- Balance history was dated by the database's clock (UTC on most hosts), so a
-- sync on a Denver evening landed on tomorrow. Each balance is now dated by
-- the owner's time zone from settings. An unknown zone falls back to the
-- database's date rather than failing the sync that changed the balance.
CREATE OR REPLACE FUNCTION record_balance() RETURNS trigger AS $$
DECLARE
  zone text;
  local_day date;
BEGIN
  IF NEW.balance_cents IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT coalesce(data->>'timeZone', 'UTC') INTO zone FROM settings;
  BEGIN
    local_day := (now() AT TIME ZONE coalesce(zone, 'UTC'))::date;
  EXCEPTION WHEN invalid_parameter_value THEN
    local_day := current_date;
  END;
  INSERT INTO balance_history (account_id, day, balance_cents)
  VALUES (NEW.id, local_day, NEW.balance_cents)
  ON CONFLICT (account_id, day) DO UPDATE SET balance_cents = EXCLUDED.balance_cents;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- Every account with a balance gets at least one day of history: its balance
-- today. Accounts that already have history keep it as it is.
INSERT INTO balance_history (account_id, day, balance_cents)
SELECT id, current_date, balance_cents FROM accounts a
WHERE balance_cents IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM balance_history h WHERE h.account_id = a.id);
