// Cash that could earn more: shown under "Will the cash last until payday?"
// only when checking holds well more than it needs before payday, saying how
// much could sit in savings and roughly what it would earn there. The
// assumed savings rate is in the words, since the figure means nothing
// without it. The card opens the math; it never moves money.

import { useAction } from '../../api/hooks'
import { Card } from '../../components/design/Card'
import { Money } from '../../components/design/Money'
import { useApp } from '../../lib/app'
import { IDLE_CASH_TITLE, idleCashDrill } from '../../lib/drills/idleCash'
import { dayLabel } from '../../lib/format'

export function IdleCashCard() {
  const { settings } = useApp()
  const idle = useAction('get_idle_cash')
  // Saying nothing is the answer when no cash is spare, or it is not the time.
  if (!idle.data?.suggested) return null
  const check = idle.data
  return (
    <Card
      drill={idleCashDrill(check, (iso) => dayLabel(iso, settings.locale))}
      label={IDLE_CASH_TITLE}
      className="stack-sm"
    >
      <h2>{IDLE_CASH_TITLE}</h2>
      <p style={{ fontSize: 17 }}>
        <Money cents={check.idleCents} className="mid-number" /> in checking isn&apos;t needed
        before payday.
      </p>
      <span className="small muted">
        In savings at an assumed {check.apyPercent}% APY, it would earn about{' '}
        <Money cents={check.yearlyInterestCents} /> a year.
      </span>
    </Card>
  )
}
