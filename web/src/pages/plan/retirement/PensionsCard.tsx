// The owner's pensions: each with its benefit, where that figure came from,
// and what goes in from pay and the employer, with a way to add one (from a
// paystub first, when one can be read) or change its figures. A pension is
// removed like any account added by hand.

import { Card } from '../../../components/design/Card'
import { useState } from 'react'
import { useAction } from '../../../api/hooks'
import { Loading } from '../../../components/ui'
import { useApp } from '../../../lib/app'
import { longDate } from '../../../lib/format'
import { FormCard } from '../FormCard'
import type { RetirementView } from './fields'
import { Amount } from './money'
import { NewPension } from './NewPension'
import { PaystubImport } from './paystub/PaystubImport'
import { pensionChoices } from './paystub/review'
import { PensionFigures, type PlanPension } from './PensionFigures'

/** A pension in words, as the server put it. */
type PensionWords = RetirementView['pensions'][number]

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

/** A kept pension's form, or a paystub import chosen in its place when one can be read. */
function KeptPensionEditor({
  pension,
  view,
  readerName,
  onClose,
}: {
  pension: PlanPension
  view: RetirementView
  readerName: string | null
  onClose: () => void
}) {
  const [importing, setImporting] = useState(false)
  if (!readerName) return <PensionFigures pension={pension} onClose={onClose} />
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

/**
 * The open form. A new pension starts from a paystub when one can be read, so
 * adding waits to know; a kept pension's form shows at once, and offers the
 * import when it turns out a paystub can be read.
 */
function PensionEditor({
  pension,
  view,
  onClose,
}: {
  pension: PlanPension | null
  view: RetirementView
  onClose: () => void
}) {
  const reader = useAction('get_paystub')
  const readerName = reader.data?.available ? reader.data.readerName : null
  if (pension) {
    return (
      <KeptPensionEditor pension={pension} view={view} readerName={readerName} onClose={onClose} />
    )
  }
  if (reader.isPending) {
    return (
      <FormCard title="Add a pension">
        <Loading />
      </FormCard>
    )
  }
  if (readerName) return <NewPension readerName={readerName} onClose={onClose} />
  return <PensionFigures pension={null} onClose={onClose} />
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
