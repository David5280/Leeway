// The Import screen: bring in transaction history from a bank's CSV export or
// another budgeting app. The file is read and checked in the browser; only
// the rows the owner confirms are sent, and the server checks them again.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Input, Output } from '../api/client'
import { useAction, useActionMutation } from '../api/hooks'
import { Shell } from '../components/Shell'
import { Icon } from '../components/ui'
import { useApp } from '../lib/app'
import { guessDateFormat, regionDateFormat } from '../lib/csv/dates'
import { guessMapping, type ColumnMapping } from '../lib/csv/mapping'
import { parseCsv } from '../lib/csv/parse'
import { accountsInFile, countRepeats, missingColumn, prepareRows } from '../lib/csv/rows'
import { Destination, NEW_ACCOUNT, type ImportChoices, type Target } from './import/Destination'
import { FileStep, type LoadedFile } from './import/FileStep'
import { ImportDone } from './import/ImportDone'
import { MappingForm } from './import/MappingForm'
import { PastImports } from './import/PastImports'
import { Preview } from './import/Preview'

/** The server's limit on one import (MAX_IMPORT_ROWS). */
const MAX_ROWS = 20_000

/** The file name without its extension, as a starting name for a new account. */
function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').slice(0, 80)
}

/** Why the import button cannot be pressed yet, or null when it can. */
function blockedReason(ready: number, target: Target): string | null {
  if (ready === 0) return 'There are no rows to import yet.'
  if (ready > MAX_ROWS) {
    return `This file has ${ready.toLocaleString()} rows; Leeway imports up to ${MAX_ROWS.toLocaleString()} at once. Export a shorter stretch of time, or import one account at a time.`
  }
  if (!target.choice) return 'Choose the account these rows belong to.'
  if (target.choice === NEW_ACCOUNT && !target.newName.trim()) return 'Name the new account.'
  return null
}

export function ImportTransactions() {
  const { settings } = useApp()
  const preferredDates = regionDateFormat(settings.locale)
  const accounts = useAction('list_accounts', { includeHidden: true })
  const importRows = useActionMutation('import_transactions')

  const [file, setFile] = useState<LoadedFile | null>(null)
  const [hasHeader, setHasHeader] = useState<boolean | undefined>(undefined)
  const [mapping, setMapping] = useState<ColumnMapping | null>(null)
  const [target, setTarget] = useState<Target>({ choice: '', newName: '', newType: 'depository' })
  const [choices, setChoices] = useState<ImportChoices>({
    fileAccount: null,
    keepRepeats: false,
    skipBankDays: true,
  })
  const [result, setResult] = useState<Output<'import_transactions'> | null>(null)

  const table = useMemo(() => (file ? parseCsv(file.text, hasHeader) : null), [file, hasHeader])
  const fileAccounts = useMemo(
    () => (table && mapping ? accountsInFile(table, mapping.account) : []),
    [table, mapping],
  )
  const prepared = useMemo(
    () => (table && mapping ? prepareRows(table, mapping, choices.fileAccount) : null),
    [table, mapping, choices.fileAccount],
  )
  const dateColumn = mapping?.date ?? null
  const datesAmbiguous = useMemo(() => {
    if (!table || dateColumn === null) return false
    return guessDateFormat(
      table.rows.map((row) => row[dateColumn]!),
      preferredDates,
    ).ambiguous
  }, [table, dateColumn, preferredDates])

  /** Reads a table and starts from Leeway's guess at its columns. */
  function start(next: LoadedFile, header: boolean | undefined) {
    const parsed = parseCsv(next.text, header)
    const guess = guessMapping(parsed, preferredDates)
    // An export of several accounts starts on the one with the most rows.
    const named = accountsInFile(parsed, guess.account)
    setFile(next)
    setHasHeader(header)
    setMapping(guess)
    setChoices((current) => ({ ...current, fileAccount: named.length > 1 ? named[0]!.name : null }))
    setTarget((current) => ({ ...current, newName: current.newName || baseName(next.name) }))
    setResult(null)
    importRows.reset()
  }

  function submit() {
    if (!prepared) return
    const destination: Pick<
      Input<'import_transactions'>,
      'accountId' | 'newAccount'
    > = target.choice === NEW_ACCOUNT
      ? { newAccount: { name: target.newName.trim(), type: target.newType } }
      : { accountId: target.choice }
    importRows.mutate(
      {
        ...destination,
        fileName: file?.name,
        rows: prepared.rows,
        keepRepeats: choices.keepRepeats,
        skipBankDays: choices.skipBankDays,
      },
      {
        onSuccess: (done) => {
          setResult(done)
          setFile(null)
          setMapping(null)
          setTarget({ choice: '', newName: '', newType: 'depository' })
        },
      },
    )
  }

  const ready = prepared?.rows.length ?? 0
  return (
    <Shell>
      <div className="stack-sm">
        <Link
          to="/transactions"
          className="linkbtn small row"
          style={{ gap: 4 }}
          aria-label="Back to transactions"
        >
          <Icon name="back" size={14} /> Transactions
        </Link>
        <h1>Import transactions</h1>
        <span className="muted">
          Bring in history from a bank&apos;s CSV export or another budgeting app.
        </span>
      </div>

      {result && <ImportDone key={result.importId ?? 'none'} result={result} />}

      <FileStep
        file={file}
        rowCount={table?.rows.length ?? 0}
        hasHeader={table?.hasHeader ?? true}
        onFile={(next) => start(next, undefined)}
        onHeaderChange={(header) => file && start(file, header)}
      />

      {table && mapping && prepared && (
        <>
          <MappingForm
            table={table}
            mapping={mapping}
            datesAmbiguous={datesAmbiguous}
            onChange={setMapping}
          />
          <Preview prepared={prepared} missing={missingColumn(mapping)} />
          <Destination
            accounts={accounts.data ?? []}
            target={target}
            onTarget={setTarget}
            fileAccounts={fileAccounts}
            choices={choices}
            onChoices={setChoices}
            repeats={countRepeats(prepared.rows)}
            ready={ready}
            blocked={blockedReason(ready, target)}
            pending={importRows.isPending}
            error={importRows.error}
            onImport={submit}
          />
        </>
      )}

      <PastImports />
    </Shell>
  )
}
