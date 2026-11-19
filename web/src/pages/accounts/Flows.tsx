// Money in and out of the picked accounts, period by period, newest first.

import { Card } from '../../components/design/Card'
import type { AccountsView } from '../../api/client'
import { Progress } from '../../components/ui'
import { useApp } from '../../lib/app'
import { periodLabel } from '../../lib/format'
import { Money } from '../../components/design/Money'

export function Flows({ flows }: { flows: AccountsView['flows'] }) {
  const { money, settings } = useApp()
  // Every bar is measured against the biggest amount, in or out, so periods compare.
  const biggest = Math.max(1, ...flows.flatMap((f) => [f.inCents, f.outCents]))
  return (
    <Card static="pending" label="Money in and out" className="span-half stack">
      <div className="stack-sm" style={{ gap: 2 }}>
        <h2>Money in and out</h2>
        <p className="small muted">Transfers between your accounts are left out.</p>
      </div>
      {[...flows].reverse().map((flow, index) => {
        const label = periodLabel(flow.start, flow.end, settings.locale)
        return (
          <div key={flow.start} className="stack-sm">
            <span className="strong">{index === 0 ? `${label}, so far` : label}</span>
            <FlowBar label={`In, ${label}`} cents={flow.inCents} of={biggest} money={money} good />
            <FlowBar label={`Out, ${label}`} cents={flow.outCents} of={biggest} money={money} />
          </div>
        )
      })}
    </Card>
  )
}

function FlowBar({
  label,
  cents,
  of,
  money,
  good = false,
}: {
  label: string
  cents: number
  of: number
  money: (cents: number) => string
  good?: boolean
}) {
  return (
    <div className="row" style={{ gap: 10 }}>
      <span className="small muted" style={{ width: 28, flex: 'none' }}>
        {good ? 'In' : 'Out'}
      </span>
      <span className="grow">
        <Progress
          percent={(cents / of) * 100}
          color={good ? 'var(--good)' : 'var(--accent)'}
          aria-label={`${label}: ${money(cents)}`}
        />
      </span>
      <span
        className={good ? 'num small good' : 'num small'}
        style={{ minWidth: 72, textAlign: 'right' }}
      >
        <Money cents={cents} />
      </span>
    </div>
  )
}
