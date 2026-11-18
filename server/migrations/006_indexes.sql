-- Indexes for the queries that grow with transaction history. Indexes only:
-- no table or data changes.

-- A category's transactions, newest first: the category page and the
-- transaction list filtered by category. The old single-column index is a
-- prefix of this one, so it goes (this one still serves the foreign key and
-- the uncategorized count).
CREATE INDEX transactions_category_date_idx ON transactions (category_id, date DESC);
DROP INDEX transactions_category_idx;

-- An account's transactions, newest first: the account page and the
-- transaction list filtered by account. The unique key on (account_id,
-- provider_transaction_id) finds the rows but cannot return them in date order.
CREATE INDEX transactions_account_date_idx ON transactions (account_id, date DESC);

-- The accounts of a connection: the account count on the banks list, and the
-- cascade when a connection is removed.
CREATE INDEX accounts_connection_idx ON accounts (connection_id);

-- The sweep of expired tokens that runs each time an app gets new tokens.
CREATE INDEX oauth_tokens_expires_idx ON oauth_tokens (expires_at);
