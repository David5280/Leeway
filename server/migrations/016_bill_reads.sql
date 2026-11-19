-- What a bill's pattern reads, as a rule's does (015_rule_reads.sql).
-- 'bank_text' is the bank's own text, as every bill has read so far.
-- 'shown_name' is only the transaction's own name as the app shows it, which
-- never holds an account number. Bills an AI assistant adds or re-patterns
-- read that, so whether a bill was paid can never show which transactions
-- hold an account's digits or letters (domain/bills.ts).
ALTER TABLE bills ADD COLUMN reads text NOT NULL DEFAULT 'bank_text'
  CHECK (reads IN ('bank_text', 'shown_name'));
