// The review screen: every figure Claude read from a paystub, each one
// editable, with how sure Claude was and the line it came from, then where
// the figures should go: a kept pension, or the new pension being added from
// this paystub. Nothing is saved until the owner confirms.

import { useState, type FormEvent, type ReactNode } from 'react'
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
import { accountChoice, type AccountChoice } from '../fields'
import type { Candidate } from '../PensionFields'
import { FigureGroup, PaystubDetails } from './ReviewFields'
import { NewPensionFields, SavingChoice, UseFigures } from './ReviewUse'

/** The save button's words: a kept pension is saved, a pension made meanwhile updated. */
function confirmLabel(adding: boolean, choice: AccountChoice): string {
  if (!adding) return 'Save'
  return choice.kind === 'kept' ? 'Update pension' : 'Add pension'
}

export function PaystubReview({
  read,
  pensions,
  pensionAccountId,
  adding = false,
  candidates = [],
  busy,
  error,
  loadProblem,
  onSave,
  onCancel,
}: {
  read: PaystubRead
  /**
   * The kept pensions the figures can update; when adding, those an account
   * chosen may have become since it was offered.
   */
  pensions: PensionChoice[]
  /** The pension chosen to start with, as when opened from that pension's form. */
  pensionAccountId: string | null
  /** Adding a new pension from this paystub, named here, instead of updating a kept one. */
  adding?: boolean
  /** When adding: accounts Leeway already has that the new pension could be. */
  candidates?: Candidate[]
  busy: boolean
  error: unknown
  /** Why something the save needs could not load, such as the accounts, with a way to try again. */
  loadProblem: ReactNode
  onSave: (input: Input<'save_paystub'>) => void
  onCancel: () => void
}) {
  const { extraction, readerName } = read
  const [text, setText] = useState<ReviewText>(() => reviewText(extraction))
  const [pension, setPension] = useState(pensionAccountId ?? '')
  // The new pension's name starts as the plan name on the paystub's pension line, if Claude read one.
  const [typed, setCreated] = useState<NewPensionText>({
    accountId: '',
    name: extraction.pensionPlanName ?? '',
    balance: '',
  })
  // An account chosen, then made a pension elsewhere, takes the figures as that pension.
  const choice = accountChoice(typed.accountId, candidates, pensions)
  const [contribution, setContribution] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const set = (change: Partial<ReviewText>) => setText((current) => ({ ...current, ...change }))
  const plans = showsPlanFigures(text)
  const confirm = confirmLabel(adding, choice)

  function submit(event: FormEvent) {
    event.preventDefault()
    // An account that left the list for good waits for the owner to choose again.
    if (choice.kind === 'gone') return
    const reviewed = readReview(text)
    if (!reviewed.ok) {
      setProblem(reviewed.error)
      return
    }
    // A pension made meanwhile is updated, as the server's refusal said; nothing new is added.
    const kept = choice.kind === 'kept' ? choice.accountId : null
    const target = adding && kept === null ? readNewPension(reviewed.paystub, typed) : null
    if (target && !target.ok) {
      setProblem(target.error)
      return
    }
    setProblem(null)
    onSave({
      paystub: reviewed.paystub,
      pensionAccountId: adding ? kept : pension || null,
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
            typed={typed}
            choice={choice}
            confirm={confirm}
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
      {loadProblem}
      <div className="row wrap">
        <button type="submit" className="btn primary" disabled={busy || choice.kind === 'gone'}>
          {confirm}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
