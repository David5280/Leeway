-- When the owner last set a bill's amount themselves (update_bill, from the
-- app or an assistant). A varying bill's amount follows its recent cycles,
-- but an amount the owner sets stands until a cycle posts after it. Leeway's
-- own writes (settling a new amount) never set it. Null when the owner has
-- not changed the amount since tracking the bill. Independent of 025 to 033:
-- it touches only its own column, so it runs the same whichever of them an
-- install applies first.
ALTER TABLE bills ADD COLUMN amount_set_at timestamptz;
