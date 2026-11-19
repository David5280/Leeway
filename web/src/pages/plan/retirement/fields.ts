// The Retirement section's forms as text and back: the figures a pension plan
// and the retirement assumptions hold, turned into what the inputs show and
// read back into what the server takes. Pure, so every rule is tested alone.
// A blank field means "not known" (null), never zero.

import type { Input, Output } from '../../../api/client'
import { parseMoney } from '../../../lib/format'

export type RetirementView = Output<'project_retirement'>
export type PensionPlan = RetirementView['plan']['pensions'][number]['plan']
export type PlanChange = Omit<Input<'update_pension'>, 'accountId'>
export type Assumptions = RetirementView['plan']['assumptions']
export type AssumptionsChange = NonNullable<Input<'update_settings'>['retirement']>

/** How the contribution is given: not yet, a fixed amount, or a share of gross pay. */
export type ContributionKind = 'none' | 'amount' | 'percent'

/** Every plan field as the form's text. */
export interface PlanText {
  contributionKind: ContributionKind
  contribution: string
  grossPay: string
  /** '' follows the pay schedule Leeway found. */
  payCadence: '' | NonNullable<PensionPlan['payCadence']>
  employerPercent: string
  serviceYears: string
  salaryBasis: string
  multiplier: string
  statementBenefit: string
  benefitAge: string
  checkedOn: string
}

/** Every assumption as the form's text. */
export interface AssumptionsText {
  birthYear: string
  retirementAge: string
  returnPercent: string
  inflationPercent: string
  withdrawalPercent: string
  monthlyContribution: string
  targetIncome: string
}

/** A form read back: the change to send, or the first field that is not a number. */
export type ReadBack<T> = { ok: true; value: T } | { ok: false; error: string }

/** Cents as the dollars a person types: 42300 is "423", 42350 is "423.5". */
export function centsText(cents: number | null): string {
  return cents === null ? '' : String(cents / 100)
}

const numberText = (value: number | null) => (value === null ? '' : String(value))

/** A new pension's figures: nothing known yet. */
const NO_FIGURES: PensionPlan = {
  contribution: null,
  grossPayCents: null,
  payCadence: null,
  employerContributionPercent: null,
  serviceYears: null,
  salaryBasisMonthlyCents: null,
  multiplierPercent: null,
  statementBenefitMonthlyCents: null,
  benefitAge: null,
  checkedOn: null,
}

function contributionText(contribution: PensionPlan['contribution']): string {
  if (contribution === null) return ''
  return contribution.kind === 'amount'
    ? centsText(contribution.cents)
    : String(contribution.percent)
}

/** The form's text for a plan's figures; every field blank for a new pension (null). */
export function planText(plan: PensionPlan | null): PlanText {
  const figures = plan ?? NO_FIGURES
  return {
    contributionKind: figures.contribution?.kind ?? 'none',
    contribution: contributionText(figures.contribution),
    grossPay: centsText(figures.grossPayCents),
    payCadence: figures.payCadence ?? '',
    employerPercent: numberText(figures.employerContributionPercent),
    serviceYears: numberText(figures.serviceYears),
    salaryBasis: centsText(figures.salaryBasisMonthlyCents),
    multiplier: numberText(figures.multiplierPercent),
    statementBenefit: centsText(figures.statementBenefitMonthlyCents),
    benefitAge: numberText(figures.benefitAge),
    checkedOn: figures.checkedOn ?? '',
  }
}

export function assumptionsText(assumptions: Assumptions): AssumptionsText {
  return {
    birthYear: numberText(assumptions.birthYear),
    retirementAge: String(assumptions.retirementAge),
    returnPercent: String(assumptions.returnPercent),
    inflationPercent: String(assumptions.inflationPercent),
    withdrawalPercent: String(assumptions.withdrawalPercent),
    monthlyContribution: centsText(assumptions.monthlyContributionCents),
    targetIncome: centsText(assumptions.targetMonthlyIncomeCents),
  }
}

/**
 * Reads a form's fields one by one. A field that is not a number reads as
 * null and leaves its message, and the first message is the one kept, so a
 * read-back names the first field to fix.
 */
class FieldReader {
  error: string | null = null

  private fail(message: string): null {
    this.error ??= message
    return null
  }

  /** A typed number, or null for a blank field. */
  number(text: string, field: string): number | null {
    const trimmed = text.trim()
    if (trimmed === '') return null
    const value = Number(trimmed)
    return Number.isFinite(value) ? value : this.fail(`Enter ${field} as a number.`)
  }

  /** A typed amount in cents, or null for a blank field. */
  cents(text: string, field: string): number | null {
    if (text.trim() === '') return null
    return parseMoney(text) ?? this.fail(`Enter ${field} as an amount.`)
  }

  /** A number the form requires: blank is as wrong as text. */
  required(text: string, field: string): number {
    if (text.trim() === '') this.fail(`Enter ${field}.`)
    // Once a field has failed the read-back is dropped, so 0 only stands in for the type.
    return this.number(text, field) ?? 0
  }

  /** The contribution, read the way its type says; none when not chosen or blank. */
  contribution(text: PlanText): PensionPlan['contribution'] {
    if (text.contributionKind === 'amount') {
      const cents = this.cents(text.contribution, 'the contribution')
      return cents === null ? null : { kind: 'amount', cents }
    }
    if (text.contributionKind === 'percent') {
      const percent = this.number(text.contribution, 'the contribution')
      return percent === null ? null : { kind: 'percent', percent }
    }
    return null
  }
}

/** Runs a read-back, giving the value only when every field was a number. */
function readBack<T>(read: (fields: FieldReader) => T): ReadBack<T> {
  const fields = new FieldReader()
  const value = read(fields)
  return fields.error === null ? { ok: true, value } : { ok: false, error: fields.error }
}

/** The message of the first read-back that failed, or null when every one worked. */
export function firstError(...reads: ReadBack<unknown>[]): string | null {
  for (const read of reads) if (!read.ok) return read.error
  return null
}

/** One amount from the form, such as a pension's member balance; null when blank. */
export function readAmount(text: string, field: string): ReadBack<number | null> {
  return readBack((fields) => fields.cents(text, field))
}

/** The whole plan, from the form; the server checks each value's range. */
export function readPlan(text: PlanText): ReadBack<PlanChange> {
  return readBack((fields) => ({
    contribution: fields.contribution(text),
    grossPayCents: fields.cents(text.grossPay, 'gross pay'),
    payCadence: text.payCadence || null,
    employerContributionPercent: fields.number(text.employerPercent, "the employer's share"),
    serviceYears: fields.number(text.serviceYears, 'years of service'),
    salaryBasisMonthlyCents: fields.cents(text.salaryBasis, 'the salary'),
    multiplierPercent: fields.number(text.multiplier, 'the multiplier'),
    statementBenefitMonthlyCents: fields.cents(text.statementBenefit, 'the benefit'),
    benefitAge: fields.number(text.benefitAge, 'the benefit age'),
    checkedOn: text.checkedOn || null,
  }))
}

/** Every assumption, from the form; the server checks each value's range. */
export function readAssumptions(text: AssumptionsText): ReadBack<AssumptionsChange> {
  return readBack((fields) => ({
    birthYear: fields.number(text.birthYear, 'your birth year'),
    retirementAge: fields.required(text.retirementAge, 'a retirement age'),
    returnPercent: fields.required(text.returnPercent, 'a yearly return'),
    inflationPercent: fields.required(text.inflationPercent, 'inflation'),
    withdrawalPercent: fields.required(text.withdrawalPercent, 'a withdrawal rate'),
    monthlyContributionCents: fields.cents(text.monthlyContribution, 'what you add each month'),
    targetMonthlyIncomeCents: fields.cents(text.targetIncome, 'the income you want'),
  }))
}
