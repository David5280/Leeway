// The Retirement section's paystub card: the newest paystub saved, and the
// way to import one. Shown only when the server has an Anthropic key, since
// nothing else can read a paystub.

import { useState } from 'react'
import { useAction, useActionMutation } from '../../../../api/hooks'
import { Card, ErrorNote } from '../../../../components/ui'
import { useApp } from '../../../../lib/app'
import { longDate } from '../../../../lib/format'
import { FormCard } from '../../FormCard'
import { PaystubImport } from './PaystubImport'
import { CURRENT_LABELS, type PaystubImport as ImportStatus, type PensionChoice } from './review'

type Latest = NonNullable<ImportStatus['latest']>

/** The figures a saved paystub showed for its period, the ones it did not left out. */
function LatestPaystub({ paystub }: { paystub: Latest }) {
  const { exact, settings } = useApp()
  const remove = useActionMutation('delete_paystub')
  const who = paystub.employerName ? `From ${paystub.employerName}` : 'Your latest paystub'
  const when = paystub.payDate ? `, paid ${longDate(paystub.payDate, settings.locale)}` : ''
  const shown = Object.entries(CURRENT_LABELS).flatMap(([field, label]) => {
    const cents = paystub.current[field as keyof Latest['current']]
    return cents === null ? [] : [{ label, cents }]
  })
  return (
    <div className="stack-sm">
      <span className="small">
        {who}
        {when}
      </span>
      <ul className="plain-list small">
        {shown.map(({ label, cents }) => (
          <li key={label} className="row-between">
            <span>{label}</span>
            <span className="num">{exact(cents)}</span>
          </li>
        ))}
      </ul>
      <ErrorNote error={remove.error} />
      <div className="row">
        <button
          type="button"
          className="btn"
          disabled={remove.isPending}
          onClick={() => remove.mutate({ id: paystub.id })}
        >
          Delete this paystub
        </button>
      </div>
    </div>
  )
}

export function PaystubCard({ pensions }: { pensions: PensionChoice[] }) {
  const status = useAction('get_paystub')
  const { settings } = useApp()
  const [importing, setImporting] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  // Without a key nothing can read a paystub, so the card stays out of the way.
  if (!status.data?.available || !status.data.readerName) return null
  const { readerName, latest } = status.data

  function done(payDate: string | null) {
    setImporting(false)
    setSaved(
      payDate
        ? `Saved the paystub paid ${longDate(payDate, settings.locale)}.`
        : 'Saved the paystub.',
    )
  }

  return (
    <>
      <Card label="Paystub" className="stack paystub">
        <div className="row-between wrap">
          <h2>Paystub</h2>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setSaved(null)
              setImporting(true)
            }}
          >
            Import a paystub
          </button>
        </div>
        {saved && (
          <p className="notice" role="status">
            {saved}
          </p>
        )}
        {latest ? (
          <LatestPaystub paystub={latest} />
        ) : (
          <p className="empty">
            Import a paystub to fill in your pension and retirement saving from it, figure by
            figure.
          </p>
        )}
      </Card>
      {importing && (
        <FormCard title="Import a paystub">
          <PaystubImport
            readerName={readerName}
            pensions={pensions}
            onSaved={done}
            onCancel={() => setImporting(false)}
          />
        </FormCard>
      )}
    </>
  )
}
