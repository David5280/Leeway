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
