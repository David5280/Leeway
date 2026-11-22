-- Marks the amounts bills already had as set by the owner, as of this
-- upgrade, so following a varying bill's cycles (billChanges.ts) leaves
-- them alone until a cycle posts after it. 034 left amount_set_at null on
-- every bill, and a null lets cycles from before the upgrade move the
-- amount at the first refresh, overwriting a figure the owner typed.
--
-- Which bills: nothing recorded when the owner set an amount before 034,
-- so the columns that show where an amount came from decide.
-- - amount_varies: before following arrived, Leeway never wrote a varying
--   bill's amount, so whatever it holds was the owner's or the one they
--   accepted when tracking it.
-- - account_id IS NULL: added by hand or by an assistant, with an amount the
--   owner gave. A bill tracked in one tap from a recurring charge keeps the
--   account it is paid from.
-- A steady bill tracked in one tap keeps a null: its amount is Leeway's own
-- estimate, settling it works as it did before 034, and marking it would
-- hold back a price change already half seen.
--
-- Only rows still null change, so an amount the owner set after 034 keeps
-- its own time, and running this again changes nothing.
UPDATE bills
SET amount_set_at = now()
WHERE amount_set_at IS NULL
  AND (amount_varies OR account_id IS NULL);
