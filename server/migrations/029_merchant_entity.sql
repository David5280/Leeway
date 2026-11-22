-- Plaid's id for the business a transaction was with, when it recognised
-- one. Chat shows a two-word merchant name that could be a person's ("Jane
-- Doe") only when Plaid vouched for it as a business this way.
ALTER TABLE transactions ADD COLUMN merchant_entity_id text;
