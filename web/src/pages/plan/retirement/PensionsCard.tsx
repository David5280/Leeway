// The owner's pensions: each with its benefit, where that figure came from,
// and what goes in from pay and the employer, with a form to add one or
// change its figures. A pension is removed like any account added by hand.

import { useState } from 'react'
import { useActionMutation } from '../../../api/hooks'
import { Card } from '../../../components/ui'
import { useApp } from '../../../lib/app'
import { longDate } from '../../../lib/format'
import { FormCard } from '../FormCard'
import type { PlanChange, RetirementView } from './fields'
import { Amount } from './money'
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
      <span className="mid-number num">{card.benefit ?? 'Benefit not known yet'}</span>
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

/** The open form: a new pension, or the figures of one already kept. */
function PensionEditor({ pension, onClose }: { pension: PlanPension | null; onClose: () => void }) {
  const create = useActionMutation('create_pension')
  const update = useActionMutation('update_pension')
  const close = { onSuccess: onClose }
  const save = (change: PlanChange, created: NewPensionFields) =>
    pension
      ? update.mutate({ accountId: pension.accountId, ...change }, close)
      : create.mutate({ ...created, ...change }, close)
  return (
    <FormCard title={pension ? pension.name : 'Add a pension'}>
      <PensionForm
        plan={pension?.plan ?? null}
        isNew={!pension}
        busy={create.isPending || update.isPending}
        error={create.error ?? update.error}
        onSubmit={save}
        onCancel={onClose}
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
      <Card label="Pensions" className="stack">
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
      {editing !== undefined && <PensionEditor pension={editing} onClose={close} />}
    </>
  )
}
