-- Pensions: a kind of account for a defined-benefit plan, such as Colorado
-- PERA, and the plan details the owner gives for it. A bank never shows a
-- pension's benefit, so every figure here is one the owner typed; Leeway
-- stores no plan rules of its own.

-- 'pension' joins the kinds an owner may pick for an account.
ALTER TABLE accounts DROP CONSTRAINT accounts_kind_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_kind_check
  CHECK (kind IN ('checking', 'savings', 'retirement', 'pension', 'investment', 'credit_card',
    'loan', 'other'));

-- One row per pension account, holding what the owner entered. Every column
-- may stay empty: an empty one is shown as not known yet, never guessed.
CREATE TABLE pension_plans (
  account_id uuid PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  -- What the owner pays in each paycheck: a fixed amount or a share of gross
  -- pay in basis points (11% is 1100). A pension takes one or the other.
  contribution_cents bigint CHECK (contribution_cents >= 0),
  contribution_bps integer CHECK (contribution_bps BETWEEN 0 AND 10000),
  CHECK (contribution_cents IS NULL OR contribution_bps IS NULL),
  -- What the employer pays in on top, as a share of gross pay.
  employer_contribution_bps integer CHECK (employer_contribution_bps BETWEEN 0 AND 10000),
  -- Gross pay per paycheck, which turns a share of pay into an amount.
  gross_pay_cents bigint CHECK (gross_pay_cents > 0),
  pay_cadence text CHECK (pay_cadence IN ('week', 'biweek', 'semimonth', 'month')),
  -- Years of service so far, as the plan's statement gives them.
  service_years numeric(4, 2) CHECK (service_years BETWEEN 0 AND 60),
  -- The monthly salary the plan's formula uses, such as a highest average salary.
  salary_basis_cents bigint CHECK (salary_basis_cents > 0),
  -- The plan's multiplier per year of service, in basis points (2.5% is 250),
  -- only ever as the owner typed it.
  multiplier_bps integer CHECK (multiplier_bps BETWEEN 1 AND 1000),
  -- The monthly benefit the plan's own statement or calculator gives.
  statement_benefit_cents bigint CHECK (statement_benefit_cents >= 0),
  -- The age the benefit starts; NULL means the owner's planned retirement age.
  benefit_age integer CHECK (benefit_age BETWEEN 40 AND 85),
  -- When the owner last checked these figures against the plan.
  checked_on date,
  updated_at timestamptz NOT NULL DEFAULT now()
);
