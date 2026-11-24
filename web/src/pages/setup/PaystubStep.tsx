// Step 5: a paystub, which is optional and can be skipped. Read after bank
// sync, since a paystub's take-home stands for a paycheck only where a bank
// deposit backs it. The same import as Settings, Paystub, where it can be
// done or redone any time.

import { useState } from 'react'
import { useAction } from '../../api/hooks'
import { Loading } from '../../components/ui'
import { FullPaystubImport } from '../paystub/FullPaystubImport'
import { PaystubInUse } from '../paystub/InUse'
import { NoReader } from '../paystub/NoReader'
import { Frame, Nav } from './Frame'

/** Where the import lives once setup is done, as the step names it. */
const LATER = 'You can do this any time in Settings, under Paystub.'

export function PaystubStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const status = useAction('get_paystub')
  const [importing, setImporting] = useState(false)
  const [saved, setSaved] = useState(false)
  const readerName = status.data?.available ? status.data.readerName : null

  return (
    <Frame step={5}>
      <h1>Add a paystub</h1>
      {importing && readerName ? (
        // The import is a form of its own, so it sits outside the step's form.
        <FullPaystubImport
          readerName={readerName}
          onSaved={() => {
            setImporting(false)
            setSaved(true)
          }}
          onCancel={() => setImporting(false)}
        />
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            onNext()
          }}
        >
          <p className="muted">
            Optional. From a paystub, Leeway learns your yearly pay, taxes and retirement saving,
            and you check every figure first. {LATER}
          </p>
          {saved && <SavedPaystub />}
          {!saved && status.isPending && <Loading />}
          {/* When the server could not say, skipping is still the way on. */}
          {!saved && status.data && (
            <Offer readerName={readerName} onImport={() => setImporting(true)} />
          )}
          <Nav
            onBack={onBack}
            next={saved ? 'Continue' : 'Skip for now'}
            quiet={!saved && readerName !== null}
          />
        </form>
      )}
    </Frame>
  )
}

/** The way to import, or, without a key to read with, what to add; skipping goes on either way. */
function Offer({ readerName, onImport }: { readerName: string | null; onImport: () => void }) {
  if (!readerName) return <NoReader />
  return (
    <div className="row">
      <button type="button" className="btn primary" onClick={onImport}>
        Import a paystub
      </button>
    </div>
  )
}

/** What the paystub just confirmed gives Leeway, read back from the server. */
function SavedPaystub() {
  const use = useAction('get_paystub_use')
  return (
    <div className="stack-sm">
      <p className="notice" role="status">
        Saved. Leeway now uses your paystub.
      </p>
      {use.data && <PaystubInUse use={use.data} />}
    </div>
  )
}
