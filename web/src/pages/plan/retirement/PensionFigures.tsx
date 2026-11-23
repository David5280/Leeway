// The pension form in its card: a new pension typed in by hand, or the
// figures of one already kept, saved through the matching action.

import { useActionMutation } from '../../../api/hooks'
import { RetryNote } from '../../../components/ui'
import { FormCard } from '../FormCard'
import type { PlanChange, RetirementView } from './fields'
import { usePensionCandidates } from './pensionCandidates'
import { PensionForm, type NewPensionFields } from './PensionForm'

/** A pension with its figures, as the projection counted it. */
export type PlanPension = RetirementView['plan']['pensions'][number]

/** The offer to fill a kept pension's figures from a paystub instead of typing them. */
function PaystubOffer({ onImport }: { onImport: () => void }) {
  return (
    <div className="row-between wrap paystub">
      <span className="small">Have a paystub? Fill these figures from it.</span>
      <button type="button" className="btn" onClick={onImport}>
        Import a paystub
      </button>
    </div>
  )
}

/**
 * The pension form: a new pension, or the figures of one already kept.
 * onImport, when given, offers to fill them from a paystub instead.
 */
export function PensionFigures({
  pension,
  onImport,
  onClose,
  onCancel = onClose,
  focusHeading = false,
}: {
  pension: PlanPension | null
  onImport?: () => void
  /** Closes the form once saved, and on cancel unless onCancel says otherwise. */
  onClose: () => void
  /** Where Cancel goes, such as back to the choice of how to add a pension. */
  onCancel?: () => void
  /** Moves focus to the card's heading, when the form is the next step of adding a pension. */
  focusHeading?: boolean
}) {
  const create = useActionMutation('create_pension')
  const attach = useActionMutation('attach_pension')
  const update = useActionMutation('update_pension')
  // A new pension may belong on an account Leeway already has, so it is not counted twice.
  const accounts = usePensionCandidates(!pension)
  // A refusal may name an account made a pension since the list was shown, so both are read again.
  const settle = { onSuccess: onClose, onError: accounts.refresh }
  function save(change: PlanChange, { accountId, ...created }: NewPensionFields) {
    if (pension) update.mutate({ accountId: pension.accountId, ...change }, settle)
    else if (accountId) attach.mutate({ accountId, ...change }, settle)
    else create.mutate({ ...created, ...change }, settle)
  }
  return (
    <FormCard title={pension ? pension.name : 'Add a pension'} focusHeading={focusHeading}>
      {onImport && <PaystubOffer onImport={onImport} />}
      {/* Without the accounts, Add pension waits, so it never adds a second account by mistake. */}
      <RetryNote error={accounts.error} onRetry={accounts.retry} />
      <PensionForm
        plan={pension?.plan ?? null}
        isNew={!pension}
        candidates={accounts.candidates}
        busy={
          create.isPending ||
          attach.isPending ||
          update.isPending ||
          accounts.pending ||
          accounts.error !== null
        }
        error={create.error ?? attach.error ?? update.error}
        onSubmit={save}
        onCancel={onCancel}
      />
    </FormCard>
  )
}
