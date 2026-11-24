// Your data: bringing in transaction history from a file, and exporting the
// setup (settings, categories, rules) to a file and importing it back.

import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { call, type Input } from '../../api/client'
import { ErrorNote } from '../../components/ui'
import { downloadText } from '../../lib/download'
import { Section } from './Section'
import { paths } from '../../routes'

export function DataSection() {
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const client = useQueryClient()

  async function download() {
    setError(null)
    try {
      const config = await call('export_config')
      downloadText(JSON.stringify(config, null, 2), 'leeway.json', 'application/json')
    } catch (caught) {
      setError(caught)
    }
  }

  async function upload(file: File) {
    setError(null)
    setMessage(null)
    try {
      const config = JSON.parse(await file.text()) as Input<'import_config'>['config']
      const result = await call('import_config', { config, mode })
      await client.invalidateQueries({ queryKey: ['action'] })
      setMessage(`Added ${result.categoriesAdded} categories and ${result.rulesAdded} rules.`)
    } catch (caught) {
      setError(caught instanceof SyntaxError ? new Error('That file is not valid JSON.') : caught)
    }
  }

  return (
    <Section id="data" title="Data">
      <div className="stack-sm">
        <h3>Import transactions</h3>
        <span className="small muted">
          From a bank&apos;s CSV export or another budgeting app, such as history from before your
          bank was connected.
        </span>
        <div>
          <Link to={paths.importTransactions()} className="btn">
            Import a CSV file
          </Link>
        </div>
      </div>
      <div className="stack-sm">
        <h3>Backup</h3>
        <span className="small muted">
          Settings, categories and rules as one file. Bank data is never included.
        </span>
      </div>
      <div className="row wrap">
        <button type="button" className="btn" onClick={() => void download()}>
          Export leeway.json
        </button>
        <select
          className="input"
          style={{ width: 'auto' }}
          aria-label="Import mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as 'merge' | 'replace')}
        >
          <option value="merge">Import and keep what I have</option>
          <option value="replace">Import and replace my categories and rules</option>
        </select>
        <label className="btn">
          Choose a file
          <input
            type="file"
            accept="application/json,.json"
            className="visually-hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void upload(file)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      {message && <p className="notice">{message}</p>}
      <ErrorNote error={error} />
    </Section>
  )
}
