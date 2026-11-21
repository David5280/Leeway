-- The emergency fund goal and the savings accounts it counts. Independent of
-- 025, 026 and 027: it touches only its own column and table, so it runs the
-- same whichever of them an install applies first.

-- How many months of essential spending the fund's target is (one to start,
-- then three, then six). Null for every other goal, and there is never more
-- than one emergency fund.
ALTER TABLE goals ADD COLUMN emergency_months smallint
  CHECK (emergency_months BETWEEN 1 AND 24);
CREATE UNIQUE INDEX goals_one_emergency_fund ON goals ((true)) WHERE emergency_months IS NOT NULL;

-- The accounts the owner marked as holding the emergency fund. None marked
-- counts every savings account (domain/emergencyGoal.ts).
CREATE TABLE goal_accounts (
  goal_id uuid NOT NULL REFERENCES goals (id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  PRIMARY KEY (goal_id, account_id)
);
