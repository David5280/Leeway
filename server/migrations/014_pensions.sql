-- Defined-benefit pensions, such as Colorado PERA, entered by the owner. A bank
-- never shows a pension, so every figure here is the owner's own, or an
-- estimate they chose to save, and Leeway labels it that way.
CREATE TABLE pensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_name text NOT NULL CHECK (length(plan_name) BETWEEN 1 AND 80),
  -- What the owner pays in each paycheck: a fixed amount or a share of gross
  -- pay (in basis points: 11% is 1100), or neither while it is not known yet.
  contribution_cents bigint CHECK (contribution_cents >= 0),
  contribution_bps integer CHECK (contribution_bps BETWEEN 0 AND 10000),
  CHECK (contribution_cents IS NULL OR contribution_bps IS NULL),
  -- Gross pay per paycheck, which turns a percent into an amount.
  gross_pay_cents bigint CHECK (gross_pay_cents > 0),
  pay_cadence text CHECK (pay_cadence IN ('week', 'biweek', 'semimonth', 'month')),
  service_years numeric(4, 2) CHECK (service_years BETWEEN 0 AND 60),
  -- The monthly benefit in today's dollars, from a statement or an estimate.
  monthly_benefit_cents bigint CHECK (monthly_benefit_cents >= 0),
  benefit_source text CHECK (benefit_source IN ('statement', 'estimate')),
  -- The age the benefit starts; NULL means the owner's retirement age.
  benefit_age integer CHECK (benefit_age BETWEEN 40 AND 85),
  checked_on date,
  created_at timestamptz NOT NULL DEFAULT now()
);
