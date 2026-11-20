-- When the bank stopped sharing an account: the owner un-ticked it in Plaid's
-- window on a reconnect, so Plaid no longer reports it for that login. NULL
-- means the bank still shares it, or that it was added by hand. The account
-- and its history stay until the owner removes them; its balance is left out
-- of every total, since nothing keeps it current (domain/unshared.ts).
--
-- IF NOT EXISTS: this file was first numbered 018 on its branch, and the
-- runner records files by name, so a database that ran it under that name
-- runs it again here and must find nothing left to do.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS unshared_at timestamptz;

-- Until when a transaction may still be matched to the bank's new id for it.
-- Set on an account's history when the account comes back under a new
-- account_id, since Plaid may send that history again under new ids over the
-- following syncs; cleared once matched, so each row is matched at most once.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS adopt_until timestamptz;
CREATE INDEX IF NOT EXISTS transactions_adopt_until_idx ON transactions (account_id)
  WHERE adopt_until IS NOT NULL;

-- A pending charge set aside when its account came back under a new
-- account_id. Plaid sends the account's charges again under new ids, so the
-- pending row goes at once, but what the owner set on it, and the subject of
-- its large-charge notification, wait here for the one charge it can only
-- have become, which may arrive a few syncs later (domain/heldCharges.ts).
-- Nothing that shows money reads this table. A row goes once paired, once
-- its charge cannot be told for sure, or once held_until passes.
CREATE TABLE IF NOT EXISTS held_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  date date NOT NULL,
  amount_cents bigint NOT NULL,
  name text NOT NULL,
  merchant_name text,
  -- Only a category the owner picked by hand.
  category_id uuid REFERENCES categories (id) ON DELETE SET NULL,
  note text,
  excluded boolean NOT NULL,
  -- The large-charge notification's subject (notifications.subject).
  subject text NOT NULL,
  -- When the account came back: only charges in since then can be its successor.
  held_at timestamptz NOT NULL,
  held_until timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS held_charges_account_idx ON held_charges (account_id);
