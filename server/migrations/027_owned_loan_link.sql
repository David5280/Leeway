-- The loan that goes with a home or car entered by hand. Independent of 025,
-- 026 and 028: it touches only its own column, so it runs the same whichever
-- of them an install applies first.

-- A home or car entered by hand can name the loan against it, so what it is
-- worth to the owner (its value less that loan) can be shown.
ALTER TABLE accounts
  ADD COLUMN loan_account_id uuid REFERENCES accounts (id) ON DELETE SET NULL,
  ADD CONSTRAINT accounts_loan_not_itself CHECK (loan_account_id <> id);
