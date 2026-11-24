-- Plaid's id for the business a transaction was with, when it recognised
-- one. Chat shows a two-word merchant name that could be a person's ("Jane
-- Doe") only when Plaid vouched for it as a business this way.
-- Numbered after the migrations other branches hold (029 to 036). A database
-- that ran this file under an earlier name already has the column.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS merchant_entity_id text;
