-- The emergency fund goal and the savings accounts it counts. Independent of
-- 025, 026 and 027: it touches only its own columns and table, so it runs the
-- same whichever of them an install applies first.

-- How many months of essential spending the fund's target is (one to start,
-- then three, then six). Null for every other goal, and there is never more
-- than one emergency fund. A goal the owner named "Emergency fund" before
-- this existed is taken as the fund as it is (domain/emergencyPlan.ts), and
-- only marked here once the owner changes it, so nothing about it changes on
-- its own.
ALTER TABLE goals ADD COLUMN emergency_months smallint
  CHECK (emergency_months BETWEEN 1 AND 24);
CREATE UNIQUE INDEX goals_one_emergency_fund ON goals ((true)) WHERE emergency_months IS NOT NULL;

-- The fund's target is its months of today's essential spending, unless the
-- owner typed their own amount (or kept the one their named goal had).
ALTER TABLE goals ADD COLUMN emergency_own_target boolean NOT NULL DEFAULT false;

-- A fund counted by hand, as the goal it was taken from was, rather than
-- following savings accounts.
ALTER TABLE goals ADD COLUMN emergency_by_hand boolean NOT NULL DEFAULT false;

-- The accounts the owner marked as holding the emergency fund. None marked
-- counts every savings account no other goal follows (domain/emergencyPlan.ts).
CREATE TABLE goal_accounts (
  goal_id uuid NOT NULL REFERENCES goals (id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  PRIMARY KEY (goal_id, account_id)
);
