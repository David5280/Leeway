// What a tax year's export added up to, shown once its CSV has downloaded:
// pay, interest and dividends, any benefits, refunds or rewards, money in that
// has no category yet, pay by who paid it, and the categories that may be
// deductible. Every figure is to the cent, as the CSV is.

import { INCOME_LINES } from '../../../../server/src/domain/tax/classify'
import type { TaxExport } from '../../api/client'
import { Money } from '../../components/design/Money'

type Summary = TaxExport['summary']

/** The income lines that show only in a year that had some, with their figures. */
function occasionalLines(summary: Summary) {
  return [
    { label: INCOME_LINES.unemployment.label, cents: summary.unemploymentCents },
    { label: INCOME_LINES.social_security.label, cents: summary.socialSecurityCents },
    { label: INCOME_LINES.retirement.label, cents: summary.retirementCents },
    { label: INCOME_LINES.tax_refund.label, cents: summary.taxRefundCents },
    { label: INCOME_LINES.rewards.label, cents: summary.rewardsCents },
  ].filter((line) => line.cents !== 0)
}

/** One named amount in a list. */
interface AmountLine {
  key: string
  name: string
  cents: number
}

/** A titled list of named amounts, or nothing when the list is empty. */
function AmountList({ title, lines }: { title: string; lines: AmountLine[] }) {
  if (lines.length === 0) return null
  return (
    <div className="stack-xs">
      <span className="small">{title}</span>
      {lines.map((line) => (
        <div key={line.key} className="list-row">
          <span className="grow ellipsis">{line.name}</span>
          <Money cents={line.cents} precision="cents" />
        </div>
      ))}
    </div>
  )
}

/** One figure in the facts list. */
function Fact({ label, cents }: { label: string; cents: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <Money cents={cents} precision="cents" />
      </dd>
    </div>
  )
}

export function TaxSummary({ summary }: { summary: Summary }) {
  const hasUnfiledIn = summary.unfiledInCents > 0
  const sources = summary.income.map((line) => ({
    key: line.key,
    name: line.source,
    cents: line.cents,
  }))
  const flagged = summary.categories
    .filter((category) => category.mayBeDeductible)
    .map((category) => ({
      key: String(category.id),
      name: category.name,
      cents: category.totalCents,
    }))
  return (
    <div className="stack-sm">
      <dl className="facts">
        <Fact label={INCOME_LINES.pay.label} cents={summary.payCents} />
        <Fact label={INCOME_LINES.interest.label} cents={summary.interestCents} />
        <Fact label={INCOME_LINES.dividends.label} cents={summary.dividendsCents} />
        {occasionalLines(summary).map((line) => (
          <Fact key={line.label} label={line.label} cents={line.cents} />
        ))}
        {hasUnfiledIn && <Fact label="Money in, not categorized" cents={summary.unfiledInCents} />}
      </dl>
      {hasUnfiledIn && (
        <span className="small muted">
          Some money came in with no category. It could be pay, interest or a refund, so categorize
          those rows and each will count on its line.
        </span>
      )}
      <AmountList title="Pay by source:" lines={sources} />
      <AmountList title="May be deductible, check with a tax pro:" lines={flagged} />
    </div>
  )
}
