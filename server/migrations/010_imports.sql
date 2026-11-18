-- Transactions brought in from a CSV file (a bank's export or another
-- budgeting app). Each import is one row here, and the transactions it added
-- point back at it, so a whole import can be told apart from bank-synced and
-- hand-entered rows, and undone at once if the file was read wrongly.
CREATE TABLE imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  -- The name of the file, as the owner's browser reported it; for display only.
  file_name text,
  added integer NOT NULL CHECK (added >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX imports_account_idx ON imports (account_id);

-- Deleting an import deletes the transactions it added.
ALTER TABLE transactions ADD COLUMN import_id uuid REFERENCES imports (id) ON DELETE CASCADE;

-- Serves that cascade and the undo; most transactions are not imported, so
-- only imported ones are indexed.
CREATE INDEX transactions_import_idx ON transactions (import_id) WHERE import_id IS NOT NULL;
