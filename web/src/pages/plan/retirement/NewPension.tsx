// Adding a pension. When a paystub can be read, that comes first: a paystub
// already shows what goes in, so the owner checks figures instead of hunting
// for them. Typing it in is the quiet second choice, and the only one when
// nothing can read a paystub.

import { useState } from 'react'
import { FormCard } from '../FormCard'
import { PaystubImport } from './paystub/PaystubImport'
import { PensionFigures } from './PensionFigures'

/** Where adding stands: choosing how, reading a paystub, or typing it in. */
type Step = 'choose' | 'paystub' | 'manual'

/** The two ways to add a pension, the paystub first. */
function HowToAdd({
  readerName,
  onPaystub,
  onManual,
  onCancel,
}: {
  readerName: string
  onPaystub: () => void
  onManual: () => void
  onCancel: () => void
}) {
  return (
    <div className="stack">
      <p>
        Your paystub already shows what you pay into your pension. {readerName} reads it, and you
        check every figure before anything is saved.
      </p>
      <div className="row wrap">
        <button type="button" className="btn primary" onClick={onPaystub}>
          Fill it from a paystub
        </button>
        <button type="button" className="btn" onClick={onManual}>
          Enter it myself
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/** Adding a pension, one step at a time: how, then the paystub's review or the form. */
export function NewPension({ readerName, onClose }: { readerName: string; onClose: () => void }) {
  const [step, setStep] = useState<Step>('choose')
  if (step === 'manual') return <PensionFigures pension={null} onClose={onClose} />
  if (step === 'paystub') {
    return (
      <FormCard title="Add a pension from a paystub">
        <PaystubImport
          readerName={readerName}
          adding
          onManual={() => setStep('manual')}
          onSaved={onClose}
          onCancel={() => setStep('choose')}
        />
      </FormCard>
    )
  }
  return (
    <FormCard title="Add a pension">
      <HowToAdd
        readerName={readerName}
        onPaystub={() => setStep('paystub')}
        onManual={() => setStep('manual')}
        onCancel={onClose}
      />
    </FormCard>
  )
}
