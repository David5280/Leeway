// A year's money for tax time: a CSV grouped by category with totals, and a
// short summary of pay, interest, dividends and the categories that may be
// deductible. A summary of what happened, not tax advice.

import { useState } from 'react'
import { call, type TaxExport } from '../../api/client'
import { Money } from '../../components/design/Money'
import { ErrorNote } from '../../components/ui'
import { useApp } from '../../lib/app'
import { isoDaysAgo } from '../../lib/dates'
import { Section } from './Section'

/** Saves text as a file the browser downloads. */
function save(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function Summary({ summary }: { summary: TaxExport['summary'] }) {
  const flagged = summary.categories.filter((category) => category.mayBeDeductible)
  return (
    <div className="stack-sm">
      <dl className="facts">
        <div>
          <dt>Pay</dt>
          <dd>
            <Money cents={summary.payCents} />
          </dd>
        </div>
        <div>
          <dt>Interest</dt>
          <dd>
            <Money cents={summary.interestCents} precision="cents" />
          </dd>
        </div>
        <div>
          <dt>Dividends</dt>
          <dd>
            <Money cents={summary.dividendsCents} precision="cents" />
          </dd>
        </div>
      </dl>
      {summary.income.length > 0 && (
        <div className="stack-sm" style={{ gap: 4 }}>
          <span className="small">Pay by source:</span>
          {summary.income.map((line) => (
            <div key={line.source} className="list-row">
              <span className="grow ellipsis" style={{ minWidth: 0 }}>
                {line.source}
              </span>
              <Money cents={line.cents} />
            </div>
          ))}
        </div>
      )}
      {flagged.length > 0 && (
        <div className="stack-sm" style={{ gap: 4 }}>
          <span className="small">May be deductible, check with a tax pro:</span>
          {flagged.map((category) => (
            <div key={category.name} className="list-row">
              <span className="grow ellipsis" style={{ minWidth: 0 }}>
                {category.name}
              </span>
              <Money cents={category.totalCents} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function TaxSection() {
  const { settings } = useApp()
  const thisYear = Number(isoDaysAgo(0, settings.timeZone).slice(0, 4))
  const [year, setYear] = useState(thisYear - 1)
  const [result, setResult] = useState<TaxExport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function download() {
    setError(null)
    setBusy(true)
    try {
      const exported = await call('export_tax_year', { year })
      save(exported.csv, exported.filename)
      setResult(exported)
    } catch (caught) {
      setError(caught)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section id="taxes" title="Tax export">
      <span className="small muted">
        A year of transactions as a CSV grouped by category with totals, and pay by source with
        interest and dividends. Transfers between your accounts are left out. This is a summary, not
        tax advice.
      </span>
      <div className="row wrap">
        <select
          className="input"
          style={{ width: 'auto' }}
          aria-label="Tax year"
          value={year}
          onChange={(event) => {
            setYear(Number(event.target.value))
            setResult(null)
          }}
        >
          {[thisYear, thisYear - 1, thisYear - 2].map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <button type="button" className="btn" disabled={busy} onClick={() => void download()}>
          Download {year} CSV
        </button>
      </div>
      {result && <Summary summary={result.summary} />}
      <ErrorNote error={error} />
    </Section>
  )
}
