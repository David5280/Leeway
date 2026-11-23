-- Every line of a paystub the owner reviewed in full and confirmed: pay,
-- earnings, taxes, deductions before and after tax, and what the employer
-- adds, each with this period's amount and the year-to-date one, in cents
-- (domain/paystubs/lines.ts names the lines). A line the paystub did not show
-- is null, never 0. Like paystubs, nothing here identifies the owner, and the
-- file itself is never kept.
--
-- One row per paystub, going with it when the paystub is deleted or let go.

CREATE TABLE paystub_details (
  paystub_id uuid PRIMARY KEY REFERENCES paystubs (id) ON DELETE CASCADE,
  -- Gross and take-home pay as lines, with hours, the hourly rate in cents
  -- and the yearly salary in cents as single figures.
  pay jsonb NOT NULL CHECK (jsonb_typeof(pay) = 'object'),
  -- Each group of lines by line name: {"regular": {"current": 384500, "yearToDate": null}, ...}.
  earnings jsonb NOT NULL CHECK (jsonb_typeof(earnings) = 'object'),
  taxes jsonb NOT NULL CHECK (jsonb_typeof(taxes) = 'object'),
  pre_tax jsonb NOT NULL CHECK (jsonb_typeof(pre_tax) = 'object'),
  post_tax jsonb NOT NULL CHECK (jsonb_typeof(post_tax) = 'object'),
  employer jsonb NOT NULL CHECK (jsonb_typeof(employer) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
