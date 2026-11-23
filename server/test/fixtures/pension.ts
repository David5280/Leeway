// A pension the retirement tests share, with made-up figures of the kind an
// owner reads off a plan's statement and a paystub.

/** A pension with a statement benefit and a contribution of $423 every two weeks. */
export const PERA = {
  name: 'Colorado PERA',
  balanceCents: 4_500_000,
  contribution: { kind: 'amount', cents: 42_300 },
  employerContributionPercent: 21.4,
  grossPayCents: 384_500,
  payCadence: 'biweek',
  serviceYears: 9.5,
  statementBenefitMonthlyCents: 218_000,
  checkedOn: '2026-10-01',
}

const { name: _name, balanceCents: _balance, ...figures } = PERA

/** The same pension's plan figures alone, as attach_pension and update_pension take them. */
export const PERA_FIGURES = figures
