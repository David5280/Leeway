// What a tax year's export added up to, shown once its CSV has downloaded:
// pay, interest and dividends, money in that has no category yet, pay by who
// paid it, and the categories that may be deductible. Every figure is to the
// cent, as the CSV is.

import type { TaxExport } from '../../api/client'
import { Money } from '../../components/design/Money'

type Summary = TaxExport['summary']

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
    key: line.source,
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
        <Fact label="Pay" cents={summary.payCents} />
        <Fact label="Interest" cents={summary.interestCents} />
        <Fact label="Dividends" cents={summary.dividendsCents} />
        {hasUnfiledIn && <Fact label="Money in, not categorized" cents={summary.unfiledInCents} />}
      </dl>
      {hasUnfiledIn && (
        <span className="small muted">
          Some money came in with no category. Categorize those rows as income so they count as pay.
        </span>
      )}
      <AmountList title="Pay by source:" lines={sources} />
      <AmountList title="May be deductible, check with a tax pro:" lines={flagged} />
    </div>
  )
}
