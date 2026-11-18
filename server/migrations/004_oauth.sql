-- OAuth sign-in for the MCP endpoint, so an assistant like Claude can connect
-- with the owner's approval instead of a pasted key. Like sessions and keys,
-- every secret (codes and tokens) is stored only as a SHA-256 hash.

-- Apps that registered themselves (OAuth dynamic client registration). Apps
-- that identify with a metadata document URL, like Claude, need no row here.
CREATE TABLE oauth_clients (
  client_id text PRIMARY KEY,
  name text NOT NULL,
  redirect_uris text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A sign-in waiting on the owner's yes or no in the consent screen.
-- Everything the screen and the final redirect need is checked and saved here
-- when the app asks, so the owner's answer cannot change what was asked.
CREATE TABLE oauth_requests (
  id text PRIMARY KEY,
  client_id text NOT NULL,
  client_name text NOT NULL,
  client_host text NOT NULL,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  state text,
  scope text NOT NULL CHECK (scope IN ('read', 'write')),
  resource text NOT NULL,
  issuer text NOT NULL,
  expires_at timestamptz NOT NULL
);

-- One connected app: what the owner approved, until they disconnect it.
-- Approving the same app again updates its row instead of adding another.
CREATE TABLE oauth_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL UNIQUE,
  client_name text NOT NULL,
  client_host text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('read', 'write')),
  resource text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

-- Authorization codes: single use, short lived, exchanged for tokens.
CREATE TABLE oauth_codes (
  code_hash text PRIMARY KEY,
  client_id text NOT NULL,
  client_name text NOT NULL,
  client_host text NOT NULL,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('read', 'write')),
  resource text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

-- Access tokens (short lived) and refresh tokens (rotated on every use).
CREATE TABLE oauth_tokens (
  token_hash text PRIMARY KEY,
  grant_id uuid NOT NULL REFERENCES oauth_grants (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('access', 'refresh')),
  expires_at timestamptz NOT NULL,
  -- Set when a refresh token is swapped for a new one.
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oauth_tokens_grant ON oauth_tokens (grant_id);
