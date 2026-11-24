// What an import did: how many rows were added and skipped, and why, with a
// way to undo it straight away.

import { Link } from 'react-router-dom'
import type { Output } from '../../api/client'
import { useActionMutation } from '../../api/hooks'
import { ErrorNote } from '../../components/ui'
import { useApp } from '../../lib/app'
import { longDate } from '../../lib/format'
import { paths } from '../../routes'

type ImportResult = Output<'import_transactions'>

/** "1 transaction" or "12 transactions". */
export function transactionCount(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? 'transaction' : 'transactions'}`
}

/** The skipped rows, one clause per reason, or nothing when none were skipped. */
function skippedText(result: ImportResult, locale: string): string | null {
  const parts: string[] = []
  if (result.alreadyThere) parts.push(`${result.alreadyThere.toLocaleString()} already in Leeway`)
  if (result.repeatsInFile) {
    parts.push(`${result.repeatsInFile.toLocaleString()} repeated in the file`)
  }
  if (result.skippedByDate) {
    const since = result.bankHistoryStarts
      ? ` (from ${longDate(result.bankHistoryStarts, locale)})`
      : ''
    parts.push(`${result.skippedByDate.toLocaleString()} the bank already sent${since}`)
  }
  return parts.length ? `Skipped as duplicates: ${parts.join(', ')}.` : null
}

export function ImportDone({ result }: { result: ImportResult }) {
  const { settings } = useApp()
  const undo = useActionMutation('undo_import')
  const skipped = skippedText(result, settings.locale)
  const where = result.account.name

  if (undo.data) {
    return (
      <section className="card stack" aria-label="Import undone">
        <p className="notice">
          Undone. Removed {transactionCount(undo.data.removed)} from {where}.
        </p>
      </section>
    )
  }
  return (
    <section className="card stack" aria-label="Import finished">
      <p className="notice">
        Added {transactionCount(result.added)} to {where}.{skipped && ` ${skipped}`}
      </p>
      {result.unknownCategories.length > 0 && (
        <p className="small muted">
          These categories from the file are not in Leeway, so your rules filed those rows:{' '}
          {result.unknownCategories.join(', ')}.
        </p>
      )}
      <div className="row wrap">
        <Link className="btn" to={paths.activity()}>
          See transactions
        </Link>
        {result.importId && (
          <button
            type="button"
            className="btn ghost"
            disabled={undo.isPending}
            onClick={() => undo.mutate({ id: result.importId! })}
          >
            Undo this import
          </button>
        )}
      </div>
      <ErrorNote error={undo.error} />
    </section>
  )
}
