// Reading a whole paystub: choose a PDF or photo, the AI reads every line,
// and the owner checks each one before it is saved. Saving keeps the figures
// only; applying them across Leeway (pay, taxes, savings, budgets) is a step
// of its own. Ready for setup and Settings to open.

import { useMutation } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { paystubs, type Output } from '../../api/client'
import { useActionMutation } from '../../api/hooks'
import { ChooseFile } from '../plan/retirement/paystub/ChooseFile'
import { fileProblem } from '../plan/retirement/paystub/review'
import { FullReview } from './FullReview'
import type { ConfirmedDetail } from './fullReview'

export type DetailSaved = Output<'save_paystub_detail'>

export function FullPaystubImport({
  readerName,
  onSaved,
  onCancel,
}: {
  readerName: string
  onSaved: (saved: DetailSaved) => void
  onCancel: () => void
}) {
  const read = useMutation({ mutationFn: paystubs.read })
  const save = useActionMutation('save_paystub_detail')
  // Set the moment a save starts, before React shows it as busy, so a double click saves once.
  // It stays set after a save succeeds, so the same paystub is never saved twice.
  const saving = useRef(false)
  const [problem, setProblem] = useState<string | null>(null)

  function choose(file: File) {
    const found = fileProblem(file)
    setProblem(found)
    read.reset()
    if (found === null) read.mutate(file)
  }

  function confirm(detail: ConfirmedDetail) {
    if (saving.current) return
    saving.current = true
    save.mutate(
      { detail },
      {
        onSuccess: onSaved,
        onError: () => {
          saving.current = false
        },
      },
    )
  }

  if (!read.data) {
    return (
      <ChooseFile
        readerName={readerName}
        reads="every line on it: pay, taxes, deductions and what your employer adds"
        reading={read.isPending}
        problem={problem}
        error={read.error}
        onFile={choose}
        onCancel={onCancel}
      />
    )
  }
  return (
    <FullReview
      extraction={read.data.extraction}
      readerName={read.data.readerName}
      busy={save.isPending}
      error={save.error}
      onConfirm={confirm}
      onCancel={onCancel}
    />
  )
}
