// The warning on Payday's cash until payday and the Home widget: the day
// checking first goes below $0, and the move that would cover it. Both come
// from the server's cash flow (belowZero on get_cash_flow), the same figures
// as safe to spend and the line to payday, so the three always agree. Red
// only for a real problem (shortTone). Leeway never moves the money itself.

import type { CashFlow } from '../../api/client'
import { Money } from '../../components/design/Money'
import { useApp } from '../../lib/app'
import { shortTone } from '../../lib/cashPath'
import { shortDate } from '../../lib/format'

/** Checking going below $0 before payday, and what would keep it above. */
export function BelowZeroWarning({ flow }: { flow: CashFlow }) {
  const { settings } = useApp()
  const warning = flow.belowZero
  if (!warning) return null
  const on = (iso: string, word: string) =>
    iso === flow.today ? 'today' : `${word} ${shortDate(iso, settings.locale)}`
  const zero = <Money cents={0} />
  const { cover } = warning
  const verb = warning.bills.length === 1 ? 'comes' : 'come'
  return (
    <div className="stack-xs" role="note" aria-label="Below zero before payday">
      <p className={`small ${shortTone(flow) === 'problem' ? 'over' : 'warn'}`}>
        {warning.now ? (
          <>Checking is already below {zero}.</>
        ) : (
          <>
            Checking goes below {zero} {on(warning.date, 'on')}, when {warning.bills.join(' and ')}{' '}
            {verb} out.
          </>
        )}
      </p>
      <p className="small">
        Moving <Money cents={cover.amountCents} />{' '}
        {cover.fromAccountName ? (
          <>
            from <b>{cover.fromAccountName}</b>
          </>
        ) : (
          'into checking'
        )}{' '}
        {on(cover.byDate, 'by')} would cover it.
      </p>
    </div>
  )
}
