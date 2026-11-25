// The top of the Inbox: everything that needs the owner now, worst first, in
// one card. Account alerts lead, then banks that stopped syncing, budgets,
// transactions to sort (which opens Activity showing just those) and this
// month's AI spending alert. Heads up on Home shows the first few of these.

import { useAction } from '../../api/hooks'
import { AlertRows } from '../../components/AccountAlerts'
import { AiSpendAlert } from '../../components/AiSpendAlert'
import { Card } from '../../components/design/Card'
import { LoadingOrError } from '../../components/ui'
import { useApp } from '../../lib/app'
import { HeadsUpRows } from '../../widgets/Alerts'
import { headsUpItems } from '../../widgets/headsUp'

export function NeedsYouNow() {
  const { money } = useApp()
  const alerts = useAction('list_alerts')
  const budget = useAction('get_budget', { offset: 0 })
  const connections = useAction('list_connections')
  const aiAlert = useAction('get_ai_usage').data?.alert
  if (!alerts.data || !budget.data) {
    return (
      <Card static="empty" label="Needs you now" className="tight">
        <div className="empty">
          <LoadingOrError error={alerts.error ?? budget.error} label="Loading what needs you" />
        </div>
      </Card>
    )
  }
  // Every account alert, hidden from Home or not, comes first (AlertRows).
  const others = headsUpItems({
    accountAlerts: [],
    connections: connections.data ?? [],
    budget: budget.data,
    money,
  })
  const empty = alerts.data.length === 0 && others.length === 0 && !aiAlert
  return (
    <Card static="list" label="Needs you now" className="tight">
      {empty ? (
        <p className="empty">Nothing needs you right now.</p>
      ) : (
        <>
          <AlertRows alerts={alerts.data} />
          <HeadsUpRows items={others} />
          {aiAlert && <AiSpendAlert alert={aiAlert} linked />}
        </>
      )}
    </Card>
  )
}
