// The top of the full review: the few figures the paystub adds up to, yearly
// pay, take-home share, taxes and retirement saving, worked out by the
// server's own arithmetic (domain/paystubs/derived.ts) from what is typed,
// so they change as the owner fixes a line below.

import {
  effectiveTaxRate,
  retirementSavingsRate,
  takeHomeShare,
  yearlyGross,
  type Column,
  type SavingsRate,
  type Share,
  type YearlyBasis,
} from '../../../../server/src/domain/paystubs/derived'
import type { ReactNode } from 'react'
import { Money } from '../../components/design/Money'
import { useApp } from '../../lib/app'
import { percentText } from '../../lib/money'
import { CADENCE_WORDS } from '../plan/retirement/paystub/review'
import type { ConfirmedDetail } from './fullReview'

/** Which column a share was read from, in words. */
const BASIS_WORDS: Record<Column, string> = {
  current: 'this paycheck',
  yearToDate: 'the year so far',
}

/** How yearly pay was worked out, in words. */
function yearlyNote(basis: YearlyBasis, detail: ConfirmedDetail): string {
  const cadence = detail.payCadence ? CADENCE_WORDS[detail.payCadence].toLowerCase() : ''
  const notes: Record<YearlyBasis, string> = {
    frequency: `This paycheck, paid ${cadence}`,
    regularPay: `This paycheck less one-off pay, paid ${cadence}`,
    yearToDate: 'The year so far, for a full year',
    salary: 'Your stated salary',
  }
  return notes[basis]
}

/** Who the retirement saving comes from: only those the paystub shows putting money in. */
function savers(saving: SavingsRate | null): string {
  if (saving === null) return 'You and your employer'
  if (saving.employerCents === null) return 'You'
  if (saving.employeeCents === null) return 'Your employer'
  return 'You and your employer'
}

/** One key figure: what it is, the figure in bold, and what it rests on. */
function KeyFigure({
  label,
  note,
  children,
}: {
  label: string
  note: string
  children: ReactNode
}) {
  return (
    <div className="review-key">
      <span className="small muted">{label}</span>
      {children ?? <span className="muted">Not shown</span>}
      <span className="small muted">{note}</span>
    </div>
  )
}

export function KeyFigures({ detail }: { detail: ConfirmedDetail }) {
  const { settings } = useApp()
  // One decimal place: enough to compare, without false precision.
  const percent = (share: Share | null) =>
    share && (
      <span className="review-key-value">
        {percentText(Math.round(share.rate * 1000) / 10, settings.locale)}
      </span>
    )
  const from = (share: Share | null, what: string) =>
    share ? `${what}, from ${BASIS_WORDS[share.basis]}` : what
  const yearly = yearlyGross(detail, detail.payDate)
  const takeHome = takeHomeShare(detail)
  const taxes = effectiveTaxRate(detail)
  const saving = retirementSavingsRate(detail)
  return (
    <section className="review-keys" aria-label="What this paystub adds up to">
      <KeyFigure label="Yearly pay" note={yearly ? yearlyNote(yearly.basis, detail) : 'Before tax'}>
        {yearly && <Money cents={yearly.cents} className="review-key-value" />}
      </KeyFigure>
      <KeyFigure label="Take-home" note={from(takeHome, 'Of gross pay')}>
        {percent(takeHome)}
      </KeyFigure>
      <KeyFigure label="Taxes" note={from(taxes, 'Withheld')}>
        {percent(taxes)}
      </KeyFigure>
      <KeyFigure label="Retirement saving" note={from(saving, savers(saving))}>
        {percent(saving)}
      </KeyFigure>
    </section>
  )
}
