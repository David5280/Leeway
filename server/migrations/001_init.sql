-- Leeway schema. One install belongs to one person, so rows carry no user id.
--
-- Money is stored as integer cents (bigint) to avoid floating point drift.
-- Positive transaction amounts are money leaving an account, matching Plaid.

-- The single owner of this install. The CHECK keeps it to one row.
CREATE TABLE owner (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  email text NOT NULL,
  name text,
  password_hash text NOT NULL,
  onboarded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Only a SHA-256 hash of each session token is stored, so a database leak
-- does not hand out live sessions.
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

-- Every preference (budget period, theme, dashboard layout, locale) lives in
-- one JSON document validated by the server, so adding a setting never needs
-- a migration and the whole thing exports as one file.
CREATE TABLE settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  data jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO settings (id) VALUES (true);

-- Tokens for the MCP endpoint. Like sessions, only a hash is stored.
CREATE TABLE api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  scope text NOT NULL CHECK (scope IN ('read', 'write')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

-- A connection is one login at one bank (Plaid calls it an Item).
CREATE TABLE connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_item_id text NOT NULL,
  access_token_encrypted text NOT NULL,
  institution_id text,
  institution_name text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'needs_reauth', 'error')),
  -- Where the last successful sync stopped. NULL means "from the beginning".
  sync_cursor text,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_item_id)
);

-- Bank accounts come from connections; manual accounts (a house, a car, a
-- loan the bank feed misses) have no connection and are edited by hand.
CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid REFERENCES connections (id) ON DELETE CASCADE,
  provider_account_id text,
  name text NOT NULL,
  -- The owner's own label; shown instead of name when set.
  display_name text,
  official_name text,
  mask text,
  type text NOT NULL CHECK (type IN ('depository', 'credit', 'loan', 'investment', 'property', 'other')),
  subtype text,
  balance_cents bigint,
  available_cents bigint,
  credit_limit_cents bigint,
  currency text NOT NULL DEFAULT 'USD',
  hidden boolean NOT NULL DEFAULT false,
  balance_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, provider_account_id),
  CHECK ((connection_id IS NULL) = (provider_account_id IS NULL))
);

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) > 0),
  color text NOT NULL,
  icon text,
  kind text NOT NULL CHECK (kind IN ('expense', 'income', 'transfer')),
  -- A budget is entered for a cadence ("$600 a month") and converted to
  -- whatever budget period the owner picks.
  budget_cents bigint CHECK (budget_cents >= 0),
  budget_cadence text NOT NULL DEFAULT 'month'
    CHECK (budget_cadence IN ('week', 'biweek', 'semimonth', 'month', 'year')),
  -- Warn when spending passes this share of the budget. NULL uses the default.
  warn_at_percent integer CHECK (warn_at_percent BETWEEN 1 AND 100),
  -- Bank category codes (Plaid's personal_finance_category) that land here
  -- when no rule matches.
  provider_categories text[] NOT NULL DEFAULT '{}',
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX categories_name_key ON categories (lower(name));

-- Rules run top to bottom; the first match decides a transaction's category.
CREATE TABLE rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field text NOT NULL CHECK (field IN ('merchant', 'description')),
  match_type text NOT NULL CHECK (match_type IN ('contains', 'equals', 'starts_with')),
  pattern text NOT NULL CHECK (length(pattern) > 0),
  -- Optional amount bounds in cents (inclusive), e.g. only charges over $50.
  min_amount_cents bigint,
  max_amount_cents bigint,
  category_id uuid NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  -- NULL for transactions entered by hand.
  provider_transaction_id text,
  -- Set on a posted transaction that replaced a pending one, so a category
  -- picked while it was pending carries over.
  pending_provider_transaction_id text,
  date date NOT NULL,
  name text NOT NULL,
  merchant_name text,
  amount_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  pending boolean NOT NULL DEFAULT false,
  provider_category_primary text,
  provider_category_detailed text,
  category_id uuid REFERENCES categories (id) ON DELETE SET NULL,
  category_source text CHECK (category_source IN ('manual', 'rule', 'provider')),
  note text,
  -- Hidden transactions (a duplicate, a reimbursed expense) count toward nothing.
  excluded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, provider_transaction_id)
);
CREATE INDEX transactions_date_idx ON transactions (date DESC);
CREATE INDEX transactions_category_idx ON transactions (category_id);
