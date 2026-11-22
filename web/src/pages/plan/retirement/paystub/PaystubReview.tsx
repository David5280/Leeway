// The review screen: every figure Claude read from a paystub, each one
// editable, with how sure Claude was and the line it came from, then where
// the figures should go: a kept pension, or the new pension being added from
// this paystub. Nothing is saved until the owner confirms.

import { useState, type FormEvent } from 'react'
import type { Input } from '../../../../api/client'
import { ErrorNote } from '../../../../components/ui'
import {
  CURRENT_LABELS,
  readNewPension,
  readReview,
  reviewText,
  showsPlanFigures,
  YEAR_TO_DATE_LABELS,
  type NewPensionText,
  type PaystubRead,
  type PensionChoice,
  type ReviewText,
} from './review'
import type { Candidate } from '../PensionFields'
import { FigureGroup, PaystubDetails } from './ReviewFields'
import { NewPensionFields, SavingChoice, UseFigures } from './ReviewUse'

export function PaystubReview({
  read,
  pensions,
  pensionAccountId,
  adding = false,
  candidates = [],
  busy,
  error,
  onSave,
  onCancel,
}: {
  read: PaystubRead
  pensions: PensionChoice[]
  /** The pension chosen to start with, as when opened from that pension's form. */
  pensionAccountId: string | null
  /** Adding a new pension from this paystub, named here, instead of updating a kept one. */
  adding?: boolean
  /** When adding: accounts Leeway already has that the new pension could be. */
  candidates?: Candidate[]
  busy: boolean
  error: unknown
  onSave: (input: Input<'save_paystub'>) => void
  onCancel: () => void
}) {
  const { extraction, readerName } = read
  const [text, setText] = useState<ReviewText>(() => reviewText(extraction))
  const [pension, setPension] = useState(pensionAccountId ?? '')
  // The new pension's name starts as the plan name on the paystub's pension line, if Claude read one.
  const [created, setCreated] = useState<NewPensionText>({
    accountId: '',
    name: extraction.pensionPlanName ?? '',
    balance: '',
  })
  const [contribution, setContribution] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const set = (change: Partial<ReviewText>) => setText((current) => ({ ...current, ...change }))
  const plans = showsPlanFigures(text)
  const confirm = adding ? 'Add pension' : 'Save'

  function submit(event: FormEvent) {
    event.preventDefault()
    const reviewed = readReview(text)
    if (!reviewed.ok) {
      setProblem(reviewed.error)
      return
    }
    const target = adding ? readNewPension(reviewed.paystub, created) : null
    if (target && !target.ok) {
      setProblem(target.error)
      return
    }
    setProblem(null)
    onSave({
      paystub: reviewed.paystub,
      pensionAccountId: adding ? null : pension || null,
      newPension: target ? target.target.newPension : null,
      attachAccountId: target ? target.target.attachAccountId : null,
      setRetirementContribution: plans && contribution,
    })
  }

  return (
    <form className="stack paystub" onSubmit={submit} aria-label="Review the paystub">
      <p className="small">
        {readerName} read these figures. Check each one against your paystub and fix any that are
        wrong; a blank one was not on it. Nothing is saved until you choose {confirm}.
      </p>
      <PaystubDetails extraction={extraction} text={text} set={set} />
      <FigureGroup
        legend="This paycheck"
        labels={CURRENT_LABELS}
        figures={extraction.current}
        text={text.current}
        onChange={(field, value) => set({ current: { ...text.current, [field]: value } })}
      />
      <FigureGroup
        legend="Year to date"
        labels={YEAR_TO_DATE_LABELS}
        figures={extraction.yearToDate}
        text={text.yearToDate}
        onChange={(field, value) => set({ yearToDate: { ...text.yearToDate, [field]: value } })}
      />
      {adding ? (
        <>
          <NewPensionFields
            candidates={candidates}
            typed={created}
            onChange={(change) => setCreated((current) => ({ ...current, ...change }))}
          />
          {plans && <SavingChoice checked={contribution} onChange={setContribution} />}
        </>
      ) : (
        <UseFigures
          pensions={pensions}
          pension={pension}
          onPension={setPension}
          plans={plans}
          contribution={contribution}
          onContribution={setContribution}
        />
      )}
      {problem && (
        <p className="notice error" role="alert">
          {problem}
        </p>
      )}
      <ErrorNote error={error} />
      <div className="row wrap">
        <button type="submit" className="btn primary" disabled={busy}>
          {confirm}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
