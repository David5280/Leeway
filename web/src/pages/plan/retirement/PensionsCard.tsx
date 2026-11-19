// The owner's pensions: each with its benefit, where that figure came from,
// and what goes in from pay and the employer, with a form to add one or
// change its figures, or to fill them from a paystub. A pension is removed
// like any account added by hand.

import { Card } from '../../../components/design/Card'
import { useState } from 'react'
import { useAction, useActionMutation } from '../../../api/hooks'

import { useApp } from '../../../lib/app'
import { longDate } from '../../../lib/format'
import { FormCard } from '../FormCard'
import { pensionCandidates, type PlanChange, type RetirementView } from './fields'
import { Amount } from './money'
import { PaystubImport } from './paystub/PaystubImport'
import { pensionChoices } from './paystub/review'
import { PensionForm, type NewPensionFields } from './PensionForm'

/** A pension in words, as the server put it. */
type PensionWords = RetirementView['pensions'][number]
/** A pension with its figures, as the projection counted it. */
type PlanPension = RetirementView['plan']['pensions'][number]

/** One pension, as the server put it in words. */
function PensionRow({
  card,
  pension,
  onEdit,
}: {
  card: PensionWords
  pension: PlanPension
  onEdit: () => void
}) {
  const { settings } = useApp()
  return (
    <div className="stack-sm" role="group" aria-label={card.name}>
      <div className="row-between wrap">
        <strong>{card.name}</strong>
        <span className="small muted">{card.label}</span>
      </div>
      <span className="mid-number num range">{card.benefit ?? 'Benefit not known yet'}</span>
      <span className="small">{card.benefitDetail}</span>
      {card.benefitNote && <span className="small muted">{card.benefitNote}</span>}
      <span className="small">{card.contribution}</span>
      {card.employer && <span className="small">{card.employer}</span>}
      {pension.balanceCents !== null && (
        <span className="small muted">
          Member balance <Amount cents={pension.balanceCents} />, which pays the benefit, so it is
          not counted again as savings.
        </span>
      )}
      {card.checkedOn && (
        <span className="small muted">Checked {longDate(card.checkedOn, settings.locale)}</span>
      )}
      <div className="row">
        <button type="button" className="btn" onClick={onEdit}>
          Edit figures
        </button>
      </div>
    </div>
  )
}

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
function PensionFigures({
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

/** The open form, or, for a kept pension, a paystub import chosen in its place. */
function PensionEditor({
  pension,
  view,
  onClose,
}: {
  pension: PlanPension | null
  view: RetirementView
  onClose: () => void
}) {
  const [importing, setImporting] = useState(false)
  // A paystub can fill a kept pension's figures, when the server can read one.
  const reader = useAction('get_paystub', undefined, { enabled: pension !== null })
  const readerName = reader.data?.available ? reader.data.readerName : null
  if (!pension || !readerName) return <PensionFigures pension={pension} onClose={onClose} />
  if (!importing) {
    return (
      <PensionFigures pension={pension} onImport={() => setImporting(true)} onClose={onClose} />
    )
  }
  return (
    <FormCard title={`Import a paystub for ${pension.name}`}>
      <PaystubImport
        readerName={readerName}
        pensions={pensionChoices(view)}
        pensionAccountId={pension.accountId}
        onSaved={onClose}
        onCancel={() => setImporting(false)}
      />
    </FormCard>
  )
}

export function PensionsCard({ view }: { view: RetirementView }) {
  // undefined: no form open; null: adding a pension; otherwise the pension being changed.
  const [editing, setEditing] = useState<PlanPension | null | undefined>(undefined)
  const close = () => setEditing(undefined)
  return (
    <>
      <Card static="list" label="Pensions" className="stack">
        <div className="row-between wrap">
          <h2>Pensions</h2>
          <button type="button" className="btn" onClick={() => setEditing(null)}>
            Add a pension
          </button>
        </div>
        {view.pensions.length === 0 ? (
          <p className="empty">
            A pension, such as Colorado PERA, pays a benefit for life. Add yours to count it in your
            retirement income.
          </p>
        ) : (
          view.pensions.map((card) => {
            const pension = view.plan.pensions.find((p) => p.accountId === card.accountId)!
            return (
              <PensionRow
                key={card.accountId}
                card={card}
                pension={pension}
                onEdit={() => setEditing(pension)}
              />
            )
          })
        )}
      </Card>
      {editing !== undefined && <PensionEditor pension={editing} view={view} onClose={close} />}
    </>
  )
}
