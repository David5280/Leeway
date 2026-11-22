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
  type PaystubRead,
  type PensionChoice,
  type ReviewText,
} from './review'
import { FigureGroup, PaystubDetails } from './ReviewFields'
import { NewPensionFields, UseFigures } from './ReviewUse'

export function PaystubReview({
  read,
  pensions,
  pensionAccountId,
  adding = false,
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
  busy: boolean
  error: unknown
  onSave: (input: Input<'save_paystub'>) => void
  onCancel: () => void
}) {
  const { extraction, readerName } = read
  const [text, setText] = useState<ReviewText>(() => reviewText(extraction))
  const [pension, setPension] = useState(pensionAccountId ?? '')
  // The new pension's name starts as the plan name on the paystub's pension line, if Claude read one.
  const [name, setName] = useState(extraction.pensionPlanName ?? '')
  const [balance, setBalance] = useState('')
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
    const created = adding ? readNewPension(reviewed.paystub, name, balance) : null
    if (created && !created.ok) {
      setProblem(created.error)
      return
    }
    setProblem(null)
    onSave({
      paystub: reviewed.paystub,
      pensionAccountId: adding ? null : pension || null,
      newPension: created ? created.pension : null,
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
        <NewPensionFields
          name={name}
          onName={setName}
          balance={balance}
          onBalance={setBalance}
          plans={plans}
          contribution={contribution}
          onContribution={setContribution}
        />
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
