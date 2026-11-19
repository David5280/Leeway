// Money in and out of the accounts shown, period by period, newest first,
// answering one question: did more come in than went out? Each period is a
// pair of labelled bars against the biggest amount, so periods compare; the
// card opens the math for this period (lib/drills/accountView.ts).

import type { AccountsView } from '../../api/client'
import { Card } from '../../components/design/Card'
import { Money } from '../../components/design/Money'
import { SectionHead } from '../../components/design/SectionHead'
import { Progress } from '../../components/ui'
import { useApp } from '../../lib/app'
import { flowsDrill, leftOver } from '../../lib/drills/accountView'
import { periodLabel } from '../../lib/format'

export function Flows({ flows }: { flows: AccountsView['flows'] }) {
  const { money, settings } = useApp()
  const range = (start: string, end: string) => periodLabel(start, end, settings.locale)
  const drill = flowsDrill(flows, range, money)
  if (!drill) return null
  // Every bar is measured against the biggest amount, in or out, so periods compare.
  const biggest = Math.max(1, ...flows.flatMap((f) => [f.inCents, f.outCents]))
  const current = flows.at(-1)!
  const ahead = leftOver(current) >= 0
  return (
    <Card drill={drill} label="Money in and out" className="span-half stack">
      <SectionHead icon="moneyIn" title="Did more come in than went out?" />
      <p className="small muted">
        {ahead ? (
          <>
            Yes so far: <Money cents={leftOver(current)} sign="change" tone="in" /> left over this
            period.
          </>
        ) : (
          <>
            Not so far: <Money cents={-leftOver(current)} /> more went out than came in this period.
          </>
        )}{' '}
        Transfers between your accounts are left out.
      </p>
      {[...flows].reverse().map((flow, index) => {
        const label = range(flow.start, flow.end)
        return (
          <div key={flow.start} className="stack-sm">
            <span className="strong small">{index === 0 ? `${label}, so far` : label}</span>
            <FlowBar label={label} cents={flow.inCents} of={biggest} money={money} cameIn />
            <FlowBar label={label} cents={flow.outCents} of={biggest} money={money} />
          </div>
        )
      })}
    </Card>
  )
}

/** One labelled bar: money in is green with a +, money out is the plain accent. */
function FlowBar({
  label,
  cents,
  of,
  money,
  cameIn = false,
}: {
  label: string
  cents: number
  of: number
  money: (cents: number) => string
  cameIn?: boolean
}) {
  const word = cameIn ? 'In' : 'Out'
  return (
    <div className="flow-bar">
      <span className="small muted flow-word">{word}</span>
      <span className="grow">
        <Progress
          percent={(cents / of) * 100}
          color={cameIn ? 'var(--good)' : 'var(--accent)'}
          aria-label={`${word}, ${label}: ${money(cents)}`}
        />
      </span>
      <Money
        cents={cents}
        sign={cameIn ? 'change' : undefined}
        tone={cameIn && cents > 0 ? 'in' : undefined}
        className="small flow-amount"
      />
    </div>
  )
}
