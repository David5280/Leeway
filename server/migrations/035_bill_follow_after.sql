-- When following a varying bill's cycles (billChanges.ts) began, for the
-- bills whose amounts were there before it and may be the owner's own:
-- following leaves those amounts alone until a cycle posts after it. 034
-- left amount_set_at null on every bill, and a null lets cycles from before
-- the upgrade move the amount at the first refresh, overwriting a figure the
-- owner typed.
--
-- Its own column, not amount_set_at: that one says the owner set the amount,
-- which also holds back a steady bill's price-change alert from before it.
-- Nothing recorded that for these amounts, so a steady bill keeps its alerts
-- (Netflix charged $22.99 after two $15.49s is still news), and only
-- following waits.
--
-- Which bills: nothing recorded when the owner set an amount before 034,
-- so the columns that show where an amount came from decide.
-- - amount_varies: before following arrived, Leeway never wrote a varying
--   bill's amount, so whatever it holds was the owner's or the one they
--   accepted when tracking it.
-- - account_id IS NULL: added by hand or by an assistant, with an amount the
--   owner gave; its own charges may yet show it varies.
-- A bill tracked in one tap from a recurring charge as steady keeps a null:
-- its amount is Leeway's own estimate.
--
-- Running it again changes nothing: the column is added only once, and only
-- rows still null are marked.
ALTER TABLE bills ADD COLUMN IF NOT EXISTS follow_after timestamptz;

UPDATE bills
SET follow_after = now()
WHERE follow_after IS NULL
  AND (amount_varies OR account_id IS NULL);
