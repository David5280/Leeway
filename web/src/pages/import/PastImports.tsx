// Earlier imports, each with a way to undo it.

import { useState } from 'react'
import { useAction, useActionMutation } from '../../api/hooks'
import { ErrorNote } from '../../components/ui'
import { timeAgo } from '../../lib/format'
import { transactionCount } from './ImportDone'

export function PastImports() {
  const imports = useAction('list_imports')
  const undo = useActionMutation('undo_import')
  // Undoing deletes transactions, so it asks once more first.
  const [confirming, setConfirming] = useState<string | null>(null)

  if (!imports.data?.length) return null
  return (
    <section className="card stack" aria-labelledby="past-imports-title">
      <div>
        <h2 id="past-imports-title">Past imports</h2>
        <span className="small muted">
          Undoing one deletes every transaction it added, even ones you have changed since.
        </span>
      </div>
      {imports.data.map((past) => (
        <div key={past.id} className="list-row wrap">
          <span className="grow">
            <strong>{past.fileName ?? 'Imported file'}</strong>
            <br />
            <span className="small muted">
              {transactionCount(past.added)} into {past.accountName}, {timeAgo(past.createdAt)}
            </span>
          </span>
          {confirming === past.id ? (
            <>
              <button
                type="button"
                className="btn danger small"
                disabled={undo.isPending}
                onClick={() =>
                  undo.mutate({ id: past.id }, { onSuccess: () => setConfirming(null) })
                }
              >
                Delete its {transactionCount(past.added)}
              </button>
              <button type="button" className="btn ghost small" onClick={() => setConfirming(null)}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" className="linkbtn small" onClick={() => setConfirming(past.id)}>
              Undo
            </button>
          )}
        </div>
      ))}
      <ErrorNote error={undo.error} />
    </section>
  )
}
