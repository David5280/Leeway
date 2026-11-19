-- Paystubs the owner imported and confirmed. Only the figures they reviewed
-- are kept: never the file, and nothing that identifies them, such as a
-- Social Security number, an employee ID or an address.

CREATE TABLE paystubs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_name text CHECK (char_length(employer_name) <= 80),
  pay_date date,
  period_start date,
  period_end date,
  pay_cadence text CHECK (pay_cadence IN ('week', 'biweek', 'semimonth', 'month')),
  -- This period's figures and the year-to-date ones, in cents by field name
  -- (domain/paystubs/reading.ts lists the fields). A figure the paystub did
  -- not show is null.
  current_cents jsonb NOT NULL CHECK (jsonb_typeof(current_cents) = 'object'),
  year_to_date_cents jsonb NOT NULL CHECK (jsonb_typeof(year_to_date_cents) = 'object'),
  -- The pension the figures were saved to, if the owner chose one.
  pension_account_id uuid REFERENCES accounts (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The newest paystub first: by the day it was paid, then when it was saved.
CREATE INDEX paystubs_newest ON paystubs (pay_date DESC NULLS LAST, created_at DESC);
