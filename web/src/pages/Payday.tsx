// The Payday tab: will I make it to payday, and what's due before then? What
// the new paycheck covers and what pay brings in come first (the payday
// section), then whether the cash lasts until payday, then the way to Bills
// and subscriptions, and, with a calendar linked, the weeks coming up.

import { useAction } from '../api/hooks'
import { LinkRows } from '../components/LinkRows'
import { Shell } from '../components/Shell'
import { paths } from '../routes'
import { AheadSection } from './plan/Ahead'
import { CashFlowCard } from './plan/CashFlow'
import { PaydaySection } from './plan/payday/PaydaySection'

export function Payday() {
  const calendar = useAction('calendar_status')
  return (
    <Shell>
      <h1>Payday</h1>
      <PaydaySection />
      <CashFlowCard />
      <LinkRows
        label="More on payday"
        rows={[
          {
            to: paths.bills(),
            label: 'Bills and subscriptions',
            icon: 'receipt',
            detail: "What's due, and repeating charges found in your history",
          },
        ]}
      />
      {/* Coming up needs a calendar's events, so without one it stays out of sight. */}
      {calendar.data?.connected && (
        <section className="stack" aria-label="Coming up">
          <h2>Coming up</h2>
          <AheadSection />
        </section>
      )}
    </Shell>
  )
}
