-- Saving for a purchase, holding a goal's share back from the budget, a
-- history of what was put toward each goal, and budgets that roll over.

-- A goal is general savings or a purchase (an item, its price and when it is
-- wanted). With set_aside on, what the goal needs each budget period is held
-- back from what is safe to spend. Existing goals stay plain savings, held
-- back from nothing, so they read exactly as before.
ALTER TABLE goals
  ADD COLUMN kind text NOT NULL DEFAULT 'savings' CHECK (kind IN ('savings', 'purchase')),
  ADD COLUMN set_aside boolean NOT NULL DEFAULT false;

-- Every amount recorded toward a goal counted by hand (negative for money
-- taken back), on the day it was put aside. Recent entries show progress and
-- project when the goal is reached. Nothing here moves money.
CREATE TABLE goal_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES goals (id) ON DELETE CASCADE,
  amount_cents bigint NOT NULL CHECK (amount_cents <> 0),
  day date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX goal_contributions_goal_day ON goal_contributions (goal_id, day);

-- With rollover on, what a category leaves unspent (or overspends) each period
-- carries into the next. rollover_since is the day it was turned on, so
-- carrying starts with that day's period rather than with all of history.
ALTER TABLE categories
  ADD COLUMN rollover boolean NOT NULL DEFAULT false,
  ADD COLUMN rollover_since date,
  ADD CONSTRAINT categories_rollover_since CHECK (rollover = (rollover_since IS NOT NULL));
