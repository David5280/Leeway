// What Goals leads with, answering "am I on track?" at a glance: what is set
// aside each paycheck (the payday playbook's own figure, opening its parts),
// and under it the goal that lands next and when (the goal order's months).

import { useAction } from '../../../../api/hooks'
import { usePaydayPlaybook } from '../../../../api/playbook'
import { Card } from '../../../../components/design/Card'
import { KeyFigure } from '../../../../components/design/KeyFigure'
import { SectionHead } from '../../../../components/design/SectionHead'
import { LoadingOrError } from '../../../../components/ui'
import { useApp } from '../../../../lib/app'
import { setAsideDrill } from '../../../../lib/drills/setAside'
import { monthYear, periodWord } from '../../../../lib/format'
import { setAsideUnit } from '../../payday/setAside'
import type { GoalOrder } from '../orderText'
import { NOTHING_SET_ASIDE, nextToLand, noLandingText } from './leadText'

/** "Next to land: Trip, May 2027.", or why there is no such goal yet. */
function NextGoal({ order }: { order: GoalOrder }) {
  const { settings } = useApp()
  const next = nextToLand(order)
  if (!next) return <>{noLandingText(order)}</>
  return (
    <>
      Next to land: <b>{next.name}</b>, {monthYear(next.landsOn, settings.locale)}.
    </>
  )
}

export function GoalsLead() {
  const playbook = usePaydayPlaybook()
  const order = useAction('get_goal_order')
  const { settings } = useApp()
  if (!playbook.data || !order.data) {
    return (
      <LoadingOrError error={playbook.error ?? order.error} label="Loading what is set aside" />
    )
  }
  const { plan } = playbook.data
  const word = periodWord(settings.period.kind)

  // Nothing set aside means no figure to explain, so the card holds words only.
  if (plan.setAsideCents === 0) {
    return (
      <Card static="words" label="Set aside" className="stack-sm">
        <SectionHead icon="target" title="Set aside" />
        <p className="small muted">{NOTHING_SET_ASIDE}</p>
        <p className="small">
          <NextGoal order={order.data} />
        </p>
      </Card>
    )
  }
  return (
    <Card drill={setAsideDrill(plan, word)} label="Set aside" className="stack-sm">
      <SectionHead icon="target" title="Set aside" />
      <KeyFigure
        label={`Each ${setAsideUnit(plan, word)}`}
        cents={plan.setAsideCents}
        caption={<NextGoal order={order.data} />}
      />
    </Card>
  )
}
