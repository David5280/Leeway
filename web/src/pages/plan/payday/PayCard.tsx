// "What do I get paid?": the paycheck Leeway found (or the owner entered),
// how often it lands and the next payday, labelled an estimate until the
// owner says it looks right. Under it, one tap confirms it, and Change opens
// the owner's own pay in its place (pay/given.ts on the server).

import { useState } from 'react'
import type { PayView } from '../../../api/client'
import { useAction, useActionMutation } from '../../../api/hooks'
import { Card } from '../../../components/design/Card'
import { KeyFigure } from '../../../components/design/KeyFigure'
import { SectionHead } from '../../../components/design/SectionHead'
import { StatusPill } from '../../../components/design/StatusPill'
import { ErrorNote, LoadingOrError } from '../../../components/ui'
import { useApp } from '../../../lib/app'
import { payDrill } from '../../../lib/drills/pay'
import { dayLabel } from '../../../lib/format'
import { PayForm } from './PayForm'
import { isEstimate, payLine } from './payText'

type PayInUse = NonNullable<PayView['pay']>

/** The paycheck, large and green, with how often and the next payday under it. */
function PayFigure({ view, pay }: { view: PayView; pay: PayInUse }) {
  const { settings } = useApp()
  const date = (iso: string) => dayLabel(iso, settings.locale)
  return (
    <Card drill={payDrill(view, pay, date)} label="Your pay" className="stack-sm">
      <SectionHead
        icon="wallet"
        title="Your pay"
        aside={isEstimate(pay) ? <StatusPill status="info" label="Estimate" /> : undefined}
      />
      <KeyFigure
        label="Each paycheck"
        cents={pay.paycheckCents}
        tone="in"
        caption={
          <>
            {payLine(view, pay)} Next payday <b>{date(pay.nextPayday)}</b>.
          </>
        }
      />
    </Card>
  )
}

/** Under the figure: confirm it, change it, or go back to what the paychecks show. */
function PayChoices({
  view,
  pay,
  onChange,
}: {
  view: PayView
  pay: PayInUse
  onChange: () => void
}) {
  const confirm = useActionMutation('confirm_pay')
  const reset = useActionMutation('set_pay')
  return (
    <Card static="form" label="Is this right?" className="stack-sm">
      <div className="row wrap">
        {pay.source === 'found' && (
          <button
            type="button"
            className="btn primary"
            disabled={confirm.isPending}
            onClick={() => confirm.mutate({})}
          >
            Looks right
          </button>
        )}
        <button type="button" className="btn" onClick={onChange}>
          {pay.source === 'found' ? 'Not quite' : 'Change my pay'}
        </button>
        {pay.source === 'yours' && view.found && (
          <button
            type="button"
            className="btn ghost"
            disabled={reset.isPending}
            onClick={() => reset.mutate({ pay: null })}
          >
            Use my paychecks
          </button>
        )}
      </div>
      <ErrorNote error={confirm.error ?? reset.error} />
    </Card>
  )
}

/** No paycheck found and none entered: say so, and take the owner's word for it. */
function NoPay({ view }: { view: PayView }) {
  return (
    <Card static="form" label="Your pay" className="stack">
      <SectionHead icon="wallet" title="Your pay" />
      <p className="muted">
        Leeway has not found a paycheck yet. It shows here once one lands, or you can enter yours
        now.
      </p>
      <PayForm view={view} />
    </Card>
  )
}

export function PayCard() {
  const view = useAction('get_pay')
  const [editing, setEditing] = useState(false)
  if (!view.data) return <LoadingOrError error={view.error} label="Loading your pay" />
  const { pay } = view.data
  if (!pay) return <NoPay view={view.data} />
  return (
    <>
      <PayFigure view={view.data} pay={pay} />
      {editing ? (
        <Card static="form" label="Your own pay" className="stack">
          <h2>Your own pay</h2>
          <PayForm view={view.data} onDone={() => setEditing(false)} />
        </Card>
      ) : (
        <PayChoices view={view.data} pay={pay} onChange={() => setEditing(true)} />
      )}
    </>
  )
}
