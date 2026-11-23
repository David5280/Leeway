-- One loan, one home or car: two things each subtracting the whole of one
-- loan would count it twice. The app already refuses a second tie
-- (owned.ts), and this index makes the database refuse it too.
--
-- An install may already hold a loan tied to two things, saved before the
-- app checked. No tie records when it was made, so the one kept is the thing
-- added first (created_at), with the lowest id breaking a tie; every other
-- tie to that loan is undone, leaving those things with no loan, never a
-- wrong one. The owner can tie the loan again wherever it belongs.
UPDATE accounts a
SET loan_account_id = NULL
WHERE a.loan_account_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM accounts kept
    WHERE kept.loan_account_id = a.loan_account_id
      AND (kept.created_at, kept.id) < (a.created_at, a.id)
  );

CREATE UNIQUE INDEX accounts_loan_account_unique ON accounts (loan_account_id)
  WHERE loan_account_id IS NOT NULL;
