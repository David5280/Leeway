// Importing a paystub: choose a PDF or photo, Claude reads its figures, and
// the owner reviews them before anything is saved. The file goes to
// Anthropic as it is, to be counted and then read once, and Leeway never
// keeps it; only the figures the owner saves are kept.

import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { paystubs } from '../../../../api/client'
import { useAction, useActionMutation } from '../../../../api/hooks'
import { ErrorNote, Loading } from '../../../../components/ui'
import { pensionCandidates } from '../fields'
import { PaystubReview } from './PaystubReview'
import { ACCEPT, fileProblem, readsPension, type PensionChoice } from './review'

/** What the owner sees before choosing a file: who reads it, what is sent, and what is kept. */
function ChooseFile({
  readerName,
  reading,
  problem,
  error,
  onFile,
  onCancel,
}: {
  readerName: string
  reading: boolean
  problem: string | null
  error: unknown
  onFile: (file: File) => void
  onCancel: () => void
}) {
  return (
    <div className="stack paystub">
      <p className="small">
        Choose a PDF or a photo of a paystub. {readerName} reads its pay, pension, 401(k), 457,
        403(b) and HSA figures, and you check each one before anything is saved.
      </p>
      <p className="small">
        A paystub is a page or two. A longer file is turned away before it is read, so save just the
        pages with your pay figures.
      </p>
      {/* Plain about what leaves Leeway: the file goes as it is, identifiers and all. */}
      <ul className="plain-list small muted">
        <li>
          The whole file goes to Anthropic as it is, including any Social Security number or address
          printed on it: first to check its length, then to be read once. Nothing else of yours goes
          with it.
        </li>
        <li>Leeway never keeps the file, only the figures you save.</li>
        <li>
          Leeway takes Social Security numbers, labeled IDs and long numbers out of what it shows
          and keeps.
        </li>
      </ul>
      {reading ? (
        <Loading label={`${readerName} is reading your paystub`} />
      ) : (
        <div className="row wrap">
          <label className="btn primary">
            Choose a paystub
            <input
              type="file"
              accept={ACCEPT}
              className="visually-hidden"
              onChange={(e) => {
                const chosen = e.target.files?.[0]
                if (chosen) onFile(chosen)
                e.target.value = ''
              }}
            />
          </label>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
      {problem && (
        <p className="notice error" role="alert">
          {problem}
        </p>
      )}
      <ErrorNote error={error} />
    </div>
  )
}

/**
 * Said plainly when a paystub read to add a pension shows no pension
 * contribution, since an empty pension is never added: typing it in comes
 * first, when offered, then a look at the figures anyway (the review still
 * refuses a pension with no contribution), or another paystub.
 */
function NoPensionFound({
  readerName,
  onManual,
  onRetry,
  onReview,
  onCancel,
}: {
  readerName: string
  onManual?: () => void
  onRetry: () => void
  /** Opens the review anyway, to check a figure Claude may have missed. */
  onReview: () => void
  onCancel: () => void
}) {
  return (
    <div className="stack paystub">
      <p className="notice" role="status">
        {readerName} found no pension contribution on this paystub, so there is no pension to add
        from it.
      </p>
      <div className="row wrap">
        {onManual && (
          <button type="button" className="btn primary" onClick={onManual}>
            Enter it myself
          </button>
        )}
        <button type="button" className="btn" onClick={onReview}>
          Check the figures anyway
        </button>
        <button type="button" className="btn" onClick={onRetry}>
          Try another paystub
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export function PaystubImport({
  readerName,
  pensions = [],
  pensionAccountId = null,
  adding = false,
  onManual,
  onSaved,
  onCancel,
}: {
  readerName: string
  /** The kept pensions the figures can update; none when adding one. */
  pensions?: PensionChoice[]
  /** The pension to update, chosen to start with, as when opened from its form. */
  pensionAccountId?: string | null
  /** Adding a new pension from the paystub, named on the review, instead of updating one. */
  adding?: boolean
  /** Goes on to typing the pension in, when the paystub shows none to add. */
  onManual?: () => void
  onSaved: (payDate: string | null) => void
  onCancel: () => void
}) {
  const read = useMutation({ mutationFn: paystubs.read })
  const save = useActionMutation('save_paystub')
  // A new pension may belong on an account Leeway already has, such as one linked from the bank.
  const accounts = useAction('list_accounts', { includeHidden: false }, { enabled: adding })
  const [problem, setProblem] = useState<string | null>(null)
  // Whether the owner chose to review a paystub that seemed to show no pension.
  const [reviewAnyway, setReviewAnyway] = useState(false)

  function choose(file: File) {
    const found = fileProblem(file)
    setProblem(found)
    setReviewAnyway(false)
    read.reset()
    if (found === null) read.mutate(file)
  }

  if (!read.data) {
    return (
      <ChooseFile
        readerName={readerName}
        reading={read.isPending}
        problem={problem}
        error={read.error}
        onFile={choose}
        onCancel={onCancel}
      />
    )
  }
  if (adding && !reviewAnyway && !readsPension(read.data.extraction)) {
    return (
      <NoPensionFound
        readerName={readerName}
        onManual={onManual}
        onRetry={() => read.reset()}
        onReview={() => setReviewAnyway(true)}
        onCancel={onCancel}
      />
    )
  }
  return (
    <PaystubReview
      read={read.data}
      pensions={pensions}
      pensionAccountId={pensionAccountId}
      adding={adding}
      candidates={pensionCandidates(accounts.data ?? [])}
      busy={save.isPending}
      error={save.error}
      onSave={(input) =>
        save.mutate(input, { onSuccess: ({ paystub }) => onSaved(paystub.payDate) })
      }
      onCancel={onCancel}
    />
  )
}
