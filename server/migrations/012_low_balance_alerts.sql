-- Each account's own low-balance warning: Leeway warns when the money
-- available in the account drops below this amount. NULL follows the default
-- (domain/accountAlerts.ts: on for checking accounts, off for the rest), and
-- 0 turns the warning off. An overdrawn account is always flagged either way.
ALTER TABLE accounts ADD COLUMN low_balance_cents bigint CHECK (low_balance_cents >= 0);
