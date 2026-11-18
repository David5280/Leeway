// Step one of an import: choosing the CSV file.

import { useState } from 'react'
import { ErrorNote } from '../../components/ui'

/** Far beyond any one account's history as CSV; a bigger file is not a bank export. */
const MAX_FILE_BYTES = 25 * 1024 * 1024

export interface LoadedFile {
  name: string
  text: string
}

/**
 * Picks a file and reads it as text right here in the browser; nothing is
 * sent anywhere until the owner imports the rows they have checked.
 */
export function FileStep({
  file,
  rowCount,
  hasHeader,
  onFile,
  onHeaderChange,
}: {
  file: LoadedFile | null
  rowCount: number
  hasHeader: boolean
  onFile: (file: LoadedFile) => void
  onHeaderChange: (hasHeader: boolean) => void
}) {
  const [error, setError] = useState<Error | null>(null)

  async function read(chosen: File) {
    setError(null)
    if (chosen.size > MAX_FILE_BYTES) {
      setError(
        new Error('That file is over 25 MB. Export a shorter stretch of time and try again.'),
      )
      return
    }
    onFile({ name: chosen.name, text: await chosen.text() })
  }

  return (
    <section className="card stack" aria-labelledby="import-file-title">
      <div>
        <h2 id="import-file-title">1. Choose a file</h2>
        <span className="small muted">
          A CSV export from your bank or another budgeting app. It is read here in your browser;
          only the rows you import are sent to your Leeway.
        </span>
      </div>
      <div className="row wrap">
        <label className="btn">
          {file ? 'Choose another file' : 'Choose a CSV file'}
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="visually-hidden"
            onChange={(e) => {
              const chosen = e.target.files?.[0]
              if (chosen) void read(chosen)
              e.target.value = ''
            }}
          />
        </label>
        {file && (
          <span className="small">
            <strong>{file.name}</strong>, {rowCount.toLocaleString()}{' '}
            {rowCount === 1 ? 'row' : 'rows'}
          </span>
        )}
      </div>
      {file && (
        <label className="row small">
          <input
            type="checkbox"
            checked={hasHeader}
            onChange={(e) => onHeaderChange(e.target.checked)}
          />
          The first row holds column names
        </label>
      )}
      <ErrorNote error={error} />
    </section>
  )
}
