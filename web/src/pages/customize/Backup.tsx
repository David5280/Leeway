// Exporting everything to a file, and importing it back.

import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { call, type Input } from '../../api/client'
import { ErrorNote } from '../../components/ui'
import { Section } from './Section'

export function BackupSection() {
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const client = useQueryClient()

  async function download() {
    setError(null)
    try {
      const config = await call('export_config')
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' }),
      )
      const link = document.createElement('a')
      link.href = url
      link.download = 'leeway.json'
      link.click()
      URL.revokeObjectURL(url)
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
    <Section
      id="backup"
      title="Backup"
      hint="Settings, categories and rules as one file. Bank data is never included."
    >
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
