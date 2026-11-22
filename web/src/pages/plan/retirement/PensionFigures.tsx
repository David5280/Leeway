// The pension form in its card: a new pension typed in by hand, or the
// figures of one already kept, saved through the matching action.

import { useAction, useActionMutation } from '../../../api/hooks'
import { FormCard } from '../FormCard'
import { pensionCandidates, type PlanChange, type RetirementView } from './fields'
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
}: {
  pension: PlanPension | null
  onImport?: () => void
  onClose: () => void
}) {
  const create = useActionMutation('create_pension')
  const attach = useActionMutation('attach_pension')
  const update = useActionMutation('update_pension')
  // A new pension may belong on an account Leeway already has, such as one linked from the bank.
  const accounts = useAction('list_accounts', { includeHidden: false }, { enabled: !pension })
  const close = { onSuccess: onClose }
  function save(change: PlanChange, { accountId, ...created }: NewPensionFields) {
    if (pension) update.mutate({ accountId: pension.accountId, ...change }, close)
    else if (accountId) attach.mutate({ accountId, ...change }, close)
    else create.mutate({ ...created, ...change }, close)
  }
  return (
    <FormCard title={pension ? pension.name : 'Add a pension'}>
      {onImport && <PaystubOffer onImport={onImport} />}
      <PensionForm
        plan={pension?.plan ?? null}
        isNew={!pension}
        candidates={pensionCandidates(accounts.data ?? [])}
        busy={create.isPending || attach.isPending || update.isPending}
        error={create.error ?? attach.error ?? update.error}
        onSubmit={save}
        onCancel={onClose}
      />
    </FormCard>
  )
}
