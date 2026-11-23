// A year's money for tax time: pick a year, download its CSV, and see what it
// added up to (see TaxSummary). A summary of what happened, not tax advice.

import { useState } from 'react'
import { call, type TaxExport } from '../../api/client'
import { ErrorNote } from '../../components/ui'
import { useApp } from '../../lib/app'
import { isoDaysAgo } from '../../lib/dates'
import { downloadCsv } from '../../lib/download'
import { Section } from './Section'
import { TaxSummary } from './TaxSummary'

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
      downloadCsv(exported.csv, exported.filename)
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
        A year of transactions from every account, hidden ones included, as a CSV grouped by
        category with totals, then pay by source with interest and dividends. Transfers between your
        accounts are left out. This is a summary, not tax advice.
      </span>
      <div className="row wrap setting-lists">
        <select
          className="input"
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
          {busy ? 'Preparing...' : `Download ${year} CSV`}
        </button>
      </div>
      {result && <TaxSummary summary={result.summary} />}
      <ErrorNote error={error} />
    </Section>
  )
}
