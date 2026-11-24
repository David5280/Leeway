// The payday notice at the top of the dashboard: for the few days after a
// payday (justPaid on the server), one card says a new paycheck is here,
// with what was left of the last one, and opens Payday, where the playbook
// is. Nothing at all otherwise, and nothing if the playbook cannot be read:
// it is a nudge, not a figure.

import { usePaydayPlaybook } from '../../api/playbook'
import { Card } from '../../components/design/Card'
import { Money } from '../../components/design/Money'
import { SectionHead } from '../../components/design/SectionHead'

export function PaydayNotice() {
  const data = usePaydayPlaybook().data
  if (!data?.justPaid) return null
  const left = data.closeOut?.leftoverCents ?? 0
  return (
    <Card to="/plan/payday" label="Payday" className="stack-xs">
      <SectionHead icon="sunrise" title="It's payday" />
      <p className="small">
        {left > 0 && (
          <>
            You had{' '}
            <b>
              <Money cents={left} tone="in" />
            </b>{' '}
            left from your last paycheck.{' '}
          </>
        )}
        See what this one covers.
      </p>
    </Card>
  )
}
