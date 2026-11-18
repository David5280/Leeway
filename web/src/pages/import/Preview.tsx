// Step three of an import: the first rows exactly as they will be saved, and
// the rows that cannot be read, with why.

import { useApp } from '../../lib/app'
import { longDate } from '../../lib/format'
import type { PreparedRows } from '../../lib/csv/rows'

/** Enough rows to check the columns and signs at a glance. */
const PREVIEW_ROWS = 8
/** Problems listed by row; past this, only their count. */
const LISTED_PROBLEMS = 5

export function Preview({ prepared, missing }: { prepared: PreparedRows; missing: string | null }) {
  const { settings, signed } = useApp()
  const { rows, problems } = prepared
  return (
    <section className="card stack" aria-labelledby="import-preview-title">
      <div>
        <h2 id="import-preview-title">3. Check the preview</h2>
        <span className="small muted">
          Spending shows plain and money in shows with a plus, as everywhere in Leeway.
        </span>
      </div>
      {missing ? (
        <p className="notice">{missing}</p>
      ) : (
        <>
          <p className="small" role="status">
            <strong>{rows.length.toLocaleString()}</strong> {rows.length === 1 ? 'row' : 'rows'}{' '}
            ready to import
            {problems.length > 0 &&
              `, ${problems.length.toLocaleString()} cannot be read and will be skipped`}
            .
          </p>
          {rows.length > 0 && (
            <div className="table-scroll">
              <table className="data-table" aria-label="Rows as they will be saved">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Description</th>
                    <th scope="col">Category</th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, PREVIEW_ROWS).map((row, index) => (
                    <tr key={index}>
                      <td>{longDate(row.date, settings.locale)}</td>
                      <td>{row.name}</td>
                      <td className="muted">{row.category ?? 'By your rules'}</td>
                      <td className="num">{signed(row.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {problems.length > 0 && (
            <ul className="small warn plain-list" aria-label="Rows that cannot be read">
              {problems.slice(0, LISTED_PROBLEMS).map((problem) => (
                <li key={problem.row}>
                  Row {problem.row} {problem.reason}.
                </li>
              ))}
              {problems.length > LISTED_PROBLEMS && (
                <li>And {(problems.length - LISTED_PROBLEMS).toLocaleString()} more.</li>
              )}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
