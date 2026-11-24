// What Leeway uses from the newest paystub (get_paystub_use), in a few
// bold figures: yearly pay, take-home per paycheck, retirement saving and
// taxes withheld. When the paystub is too old, was saved for a pension only,
// or its take-home does not stand for a paycheck, one plain line says so.
// Totals only: never who paid, or any number that names someone.

import { Money } from '../../components/design/Money'
import type { Output } from '../../api/client'
import { useApp } from '../../lib/app'
import { todayIn } from '../../lib/dates'
import { longDate } from '../../lib/format'
import { percentText } from '../../lib/money'
import { KeyFigure } from './KeyFigures'

export type PaystubUse = Output<'get_paystub_use'>
type Figures = NonNullable<PaystubUse['figures']>

/** A share of gross pay to one decimal place: enough to compare, without false precision. */
function useShare(): (rate: number) => string {
  const { settings } = useApp()
  return (rate) => percentText(Math.round(rate * 1000) / 10, settings.locale)
}

/** "federal $7,350 and state $3,147", bold, leaving out what the paystub does not show. */
function Withheld({ taxes, thisYear }: { taxes: Figures['taxes']; thisYear: boolean }) {
  const parts = [
    { name: 'federal', cents: taxes.federalWithheldCents },
    { name: 'state', cents: taxes.stateWithheldCents },
  ].filter((part): part is { name: string; cents: number } => part.cents !== null)
  if (parts.length === 0) return null
  return (
    <p className="small">
      Income tax withheld {thisYear ? 'so far this year' : `in ${taxes.year}`}:{' '}
      {parts.map((part, i) => (
        <span key={part.name}>
          {i > 0 && ' and '}
          {part.name} <Money cents={part.cents} className="strong" />
        </span>
      ))}
      .
    </p>
  )
}

/** The four figures Leeway uses, and the withholding behind the tax rate. */
function Used({ use, figures }: { use: PaystubUse; figures: Figures }) {
  const { settings } = useApp()
  const share = useShare()
  const { yearlyGross, retirement, taxes, matchMonthlyCents } = figures
  // Last year's totals (a December paystub read in January) are named by their year.
  const thisYear = taxes.year === Number(todayIn(settings.timeZone, new Date()).slice(0, 4))
  const value = (text: string) => <span className="review-key-value">{text}</span>
  return (
    <>
      <section className="review-keys" aria-label="What Leeway uses from your paystub">
        <KeyFigure label="Yearly pay" note="Before tax">
          {yearlyGross && <Money cents={yearlyGross.cents} className="review-key-value" />}
        </KeyFigure>
        <KeyFigure
          label="Take-home per paycheck"
          note={use.appliedToPay ? 'Used for your paychecks' : 'Not used for pay'}
        >
          {use.takeHomeCents !== null && (
            <Money cents={use.takeHomeCents} precision="cents" className="review-key-value" />
          )}
        </KeyFigure>
        <KeyFigure label="Retirement saving" note="Of gross, with your employer's part">
          {retirement && value(share(retirement.rate))}
        </KeyFigure>
        <KeyFigure label="Taxes withheld" note="Of gross; not what you finally owe">
          {taxes.effectiveRate && value(share(taxes.effectiveRate.rate))}
        </KeyFigure>
      </section>
      {matchMonthlyCents !== null && (
        <p className="small">
          Your employer adds <Money cents={matchMonthlyCents} className="strong" /> a month to your
          retirement.
        </p>
      )}
      <Withheld taxes={taxes} thisYear={thisYear} />
      {!use.appliedToPay && use.takeHomeCents !== null && (
        <p className="small muted">
          Your pay still follows your bank deposits, since none matches this take-home. That happens
          when pay is split between accounts or has changed since.
        </p>
      )}
    </>
  )
}

export function PaystubInUse({ use }: { use: PaystubUse }) {
  const { settings } = useApp()
  const paid = use.paidOn ? longDate(use.paidOn, settings.locale) : ''
  if (use.state === 'none') {
    return (
      <p className="empty">
        No paystub yet. Import one and Leeway works out your yearly pay, taxes and retirement saving
        from it, after you check each figure.
      </p>
    )
  }
  if (use.state === 'stale') {
    return (
      <p className="notice">
        Your latest paystub, paid {paid}, is over six months old, so Leeway no longer uses it.
        Import a recent one to bring your pay, taxes and retirement saving up to date.
      </p>
    )
  }
  if (use.state === 'partial' || !use.figures) {
    return (
      <p className="notice">
        Your latest paystub, paid {paid}, was saved for your pension only, so Leeway uses just its
        retirement figures. Import it here to use all of it.
      </p>
    )
  }
  return (
    <div className="stack-sm">
      <p className="small">
        From your paystub paid <strong>{paid}</strong>.
      </p>
      <Used use={use} figures={use.figures} />
    </div>
  )
}
