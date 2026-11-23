-- A trip budget is an ordinary purchase goal; this keeps the parts it was
-- planned from (travel, a place to stay, food per day, things to do), the
-- trip's days, and the calendar events of the trip it was planned for, so
-- the trip can show what is left as it goes.
CREATE TABLE trip_budgets (
  goal_id uuid PRIMARY KEY REFERENCES goals (id) ON DELETE CASCADE,
  -- The ids of the trip's calendar events: how the budget finds its trip
  -- again once the event moves. Trips are worked out from the calendar, so
  -- one budget per trip is kept by the code that matches them (match.ts),
  -- not by a constraint here: back-to-back trips may share a travel day.
  event_uids text[] NOT NULL DEFAULT '{}',
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  travel_cents bigint NOT NULL CHECK (travel_cents >= 0),
  stay_cents bigint NOT NULL CHECK (stay_cents >= 0),
  food_per_day_cents bigint NOT NULL CHECK (food_per_day_cents >= 0),
  activities_cents bigint NOT NULL CHECK (activities_cents >= 0),
  -- False once no trip on the calendar matches it, so its goal can say so.
  on_calendar boolean NOT NULL DEFAULT true,
  CHECK (ends_on >= starts_on)
);
