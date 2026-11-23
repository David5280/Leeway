// Importing a paystub: choose a PDF or photo, Claude reads its figures, and
// the owner reviews them before anything is saved. The file goes to
// Anthropic as it is, to be counted and then read once, and Leeway never
// keeps it; only the figures the owner saves are kept.

import { useMutation } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { paystubs, type Input } from '../../../../api/client'
import { useActionMutation } from '../../../../api/hooks'
import { RetryNote } from '../../../../components/ui'
import { usePensionCandidates } from '../pensionCandidates'
import { ChooseFile } from './ChooseFile'
import { PaystubReview } from './PaystubReview'
import { fileProblem, readsPension, type PensionChoice } from './review'

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
  // A new pension may belong on an account Leeway already has, so it is not counted twice.
  const accounts = usePensionCandidates(adding)
  // Set the moment a save starts, before React shows it as busy, so a double click saves once.
  const saving = useRef(false)
  const [problem, setProblem] = useState<string | null>(null)
  // Whether the owner chose to review a paystub that seemed to show no pension.
  const [reviewAnyway, setReviewAnyway] = useState(false)

  function saveOnce(input: Input<'save_paystub'>) {
    if (saving.current) return
    saving.current = true
    save.mutate(input, {
      onSuccess: ({ paystub }) => onSaved(paystub.payDate),
      // A refusal may name an account made a pension since the list was shown.
      onError: accounts.refresh,
      onSettled: () => {
        saving.current = false
      },
    })
  }

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
      // When adding, the pensions an account chosen may have become since it was offered.
      pensions={adding ? accounts.pensions : pensions}
      pensionAccountId={pensionAccountId}
      adding={adding}
      candidates={accounts.candidates}
      // Add pension waits for the accounts, and while they load again after Try again.
      busy={save.isPending || accounts.pending || accounts.error !== null}
      error={save.error}
      loadProblem={<RetryNote error={accounts.error} onRetry={accounts.retry} />}
      onSave={saveOnce}
      onCancel={onCancel}
    />
  )
}
