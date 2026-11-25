// Home's Due by payday card: the next few bills due by payday (those due on
// payday itself included), soonest
// first, each with its date and amount, and the whole card opens Payday's
// bills. The bills are the server's own list behind cash to payday
// (get_cash_flow's billsDue), so a bill already paid is never here and the
// two can never disagree. With nothing due, one calm line says so instead of
// an empty card.

import { Link } from 'react-router-dom'
import type { CashFlow } from '../api/client'
import { useAction } from '../api/hooks'
import { Card } from '../components/design/Card'
import { Money } from '../components/design/Money'
import { SectionHead } from '../components/design/SectionHead'
import { LoadingOrError } from '../components/ui'
import { useApp } from '../lib/app'
import { dayLabel, shortDate } from '../lib/format'
import { paths } from '../routes'

const NAME = 'Due by payday'

/** Bills shown at most: the rest are a tap away on Payday's bills. */
export const COMING_UP_LIMIT = 3

type BillDue = CashFlow['billsDue'][number]

export function ComingUpWidget() {
  const cash = useAction('get_cash_flow')
  const { settings } = useApp()
  if (!cash.data) {
    return (
      <Card static="empty" label={NAME} className="stack-sm">
        <SectionHead icon="receipt" title={NAME} />
        <LoadingOrError error={cash.error} />
      </Card>
    )
  }
  const payday = dayLabel(cash.data.nextPayday, settings.locale)
  const bills = cash.data.billsDue.slice(0, COMING_UP_LIMIT)
  if (bills.length === 0) {
    return (
      <Link to={paths.bills()} className="home-calm-line small muted">
        No bills due by payday, {payday}
      </Link>
    )
  }
  const more = cash.data.billsDue.length - bills.length
  return (
    <Card to={paths.bills()} label={NAME} className="stack-sm">
      <SectionHead icon="receipt" title={NAME} />
      {bills.map((bill) => (
        <BillLine key={`${bill.billId}-${bill.dueDate}`} bill={bill} />
      ))}
      <span className="small muted">
        {more > 0 ? `${more} more by payday, ${payday}` : `Payday ${payday}`}
      </span>
    </Card>
  )
}

/** One bill: its date, its name (and, when its date passed, that no payment was found) and amount. */
function BillLine({ bill }: { bill: BillDue }) {
  const { settings } = useApp()
  return (
    <span className="list-row coming-up-row">
      <span className="num small muted coming-up-date">
        {shortDate(bill.dueDate, settings.locale)}
      </span>
      <span className="grow coming-up-name">
        <span className="ellipsis">{bill.name}</span>
        {/* A bill past its date with no payment found is the one problem here, so the one red. */}
        {bill.overdue && <span className="small over">No payment found</span>}
      </span>
      <Money cents={bill.amountCents} precision="cents" className="strong" />
    </span>
  )
}
