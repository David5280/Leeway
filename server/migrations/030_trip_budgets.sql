-- A trip budget is an ordinary purchase goal; this keeps the parts it was
-- planned from (travel, a place to stay, food per day, things to do) and the
-- trip's days, so the trip can show what is left as it goes.
CREATE TABLE trip_budgets (
  goal_id uuid PRIMARY KEY REFERENCES goals (id) ON DELETE CASCADE,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  travel_cents bigint NOT NULL CHECK (travel_cents >= 0),
  stay_cents bigint NOT NULL CHECK (stay_cents >= 0),
  food_per_day_cents bigint NOT NULL CHECK (food_per_day_cents >= 0),
  activities_cents bigint NOT NULL CHECK (activities_cents >= 0),
  CHECK (ends_on >= starts_on)
);

CREATE INDEX trip_budgets_days ON trip_budgets (starts_on, ends_on);
