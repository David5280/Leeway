-- What a rule reads. 'bank_text' is the bank's own text, as every rule has
-- read so far. 'shown_name' is only the transaction's own name as the app
-- shows it, which never holds an account number (domain/safeName.ts). Rules
-- an AI assistant makes or rewrites read that, so a rule can never find out
-- which transactions hold an account's digits (domain/ruleText.ts).
ALTER TABLE rules ADD COLUMN reads text NOT NULL DEFAULT 'bank_text'
  CHECK (reads IN ('bank_text', 'shown_name'));
