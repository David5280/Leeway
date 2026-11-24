// The payday notice at the top of the dashboard: for the few days after a
// payday (justPaid on the server), one card says a new paycheck is here,
// with what was left of the last one, and opens Payday, where the playbook
// is. Nothing at all otherwise, and nothing if the playbook cannot be read:
// it is a nudge, not a figure.

import type { Playbook } from '../../api/client'
import { usePaydayPlaybook } from '../../api/playbook'
import { Card } from '../../components/design/Card'
import { Money } from '../../components/design/Money'
import { SectionHead } from '../../components/design/SectionHead'
import { useApp } from '../../lib/app'
import { daysBetween } from '../../lib/dates'
import { weekdayName } from '../../lib/format'
import { paths } from '../../routes'

/** The title for the day it is: "It's payday", then "Payday was yesterday" or "Payday was Friday". */
export function paydayTitle(playbook: Pick<Playbook, 'lastPayday' | 'today'>, locale: string) {
  const { lastPayday, today } = playbook
  if (lastPayday === null) return "It's payday"
  const daysSince = daysBetween(lastPayday, today)
  if (daysSince <= 0) return "It's payday"
  // The notice lasts only a few days, so the weekday alone is never unclear.
  return daysSince === 1 ? 'Payday was yesterday' : `Payday was ${weekdayName(lastPayday, locale)}`
}

export function PaydayNotice() {
  const { settings } = useApp()
  const data = usePaydayPlaybook().data
  if (!data?.justPaid) return null
  const left = data.closeOut?.leftoverCents ?? 0
  return (
    <Card to={paths.payday()} label="Payday" className="stack-xs">
      <SectionHead icon="moneyIn" title={paydayTitle(data, settings.locale)} />
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
