-- When the bank stopped sharing an account: the owner un-ticked it in Plaid's
-- window on a reconnect, so Plaid no longer reports it for that login. NULL
-- means the bank still shares it, or that it was added by hand. The account
-- and its history stay until the owner removes them; its balance is left out
-- of every total, since nothing keeps it current (domain/unshared.ts).
ALTER TABLE accounts ADD COLUMN unshared_at timestamptz;
