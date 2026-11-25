// The Payday tab: will I make it to payday? In the order the map gives it:
// this paycheck leads (pay, minus bills before payday, minus what is set
// aside, is the everyday budget), or on payday how the last period closed
// and what to do with what is left. Then cash until payday as a line, then
// the next two weeks of paydays, bills and calendar events. A tap deeper:
// Bills and subscriptions, Your pay, the six weeks ahead, and Goals, where
// what is set aside each paycheck lives.

import { usePaydayPlaybook } from '../api/playbook'
import { LinkRows, type LinkRow } from '../components/LinkRows'
import { Shell } from '../components/Shell'
import { useApp } from '../lib/app'
import { periodWord } from '../lib/format'
import { paths } from '../routes'
import { CashFlowCard } from './plan/CashFlow'
import { NextTwoWeeks } from './plan/payday/NextTwoWeeks'
import { Playbook } from './plan/payday/Playbook'
import { setAsideRow } from './plan/payday/setAside'

/** The pages a tap deeper that belong to Payday itself. */
const DEEPER: LinkRow[] = [
  {
    to: paths.bills(),
    label: 'Bills and subscriptions',
    icon: 'receipt',
    detail: "What's due, and repeating charges found in your history",
  },
  {
    to: paths.pay(),
    label: 'Your pay',
    icon: 'moneyIn',
    detail: 'The pay Leeway found, confirm or change it, and your paystub',
  },
  {
    to: paths.sixWeeks(),
    label: 'Six weeks ahead',
    icon: 'plan',
    detail: "What's ahead, week by week",
  },
]

export function Payday() {
  // The same cached read the lead makes, so the set aside total agrees with it.
  const playbook = usePaydayPlaybook()
  const { money, settings } = useApp()
  return (
    <Shell>
      <h1>Payday</h1>
      <Playbook />
      <CashFlowCard />
      <NextTwoWeeks />
      <LinkRows
        label="More on payday"
        rows={[
          ...DEEPER,
          setAsideRow(playbook.data?.plan, money, periodWord(settings.period.kind)),
        ]}
      />
    </Shell>
  )
}
