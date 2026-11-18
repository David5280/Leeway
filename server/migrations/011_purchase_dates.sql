-- Bank sync now dates a transaction by the day it was bought, not the day it
-- posted. Banks linked before that still hold some posted dates, which the
-- server corrects once on its own (domain/purchaseDates.ts). This column
-- records when each bank's dates were corrected, so it happens only once.
--
-- The column is added without a default, so banks linked before this
-- migration start empty and get corrected. The default is set afterwards, so
-- banks linked from now on, whose dates are already right, start filled in.
ALTER TABLE connections ADD COLUMN purchase_dates_at timestamptz;
ALTER TABLE connections ALTER COLUMN purchase_dates_at SET DEFAULT now();
