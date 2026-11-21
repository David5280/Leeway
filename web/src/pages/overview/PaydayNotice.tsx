// The payday notice at the top of the dashboard: in the first few days after
// a paycheck lands, one card says so, with what was left from the last one,
// and opens Payday, where the plan for it is. Nothing at all otherwise, and
// nothing if the playbook cannot be read: it is a nudge, not a figure.

import { useAction } from '../../api/hooks'
import { Card } from '../../components/design/Card'
import { Money } from '../../components/design/Money'
import { SectionHead } from '../../components/design/SectionHead'

export function PaydayNotice() {
  const playbook = useAction('get_payday_playbook')
  const data = playbook.data
  if (!data?.justPaid || !data.paycheck) return null
  const left = data.closeOut.leftoverCents
  return (
    <Card to="/plan/payday" label="Payday" className="stack-sm">
      <SectionHead icon="sunrise" title="It is payday" />
      <p>
        Your paycheck of <Money cents={data.paycheck.amountCents} tone="in" /> landed.{' '}
        {left > 0 && (
          <>
            You had <Money cents={left} tone="in" /> left from the last one.{' '}
          </>
        )}
        See a plan for it.
      </p>
    </Card>
  )
}
