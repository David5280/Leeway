-- The account a bill is paid from, when Leeway knows it: a bill tracked in one
-- tap from a recurring charge takes the account most of its charges came out
-- of. Deleting the account leaves the bill, with no account.
ALTER TABLE bills ADD COLUMN account_id uuid REFERENCES accounts (id) ON DELETE SET NULL;
