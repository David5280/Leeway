// The frame every setup step sits in, and the buttons at its foot.

import type { ReactNode } from 'react'
import { Logo } from '../../components/ui'

const STEPS = ['Your account', 'Budget period', 'Banks', 'Starting point', 'Done']

/** The step list beside the current step's card. */
export function Frame({ step, children }: { step: number; children: ReactNode }) {
  return (
    <main className="setup">
      <aside className="stack">
        <div className="brand">
          <Logo />
          leeway
        </div>
        <ol className="steps" aria-label="Setup steps">
          {STEPS.map((name, i) => (
            <li
              key={name}
              className={stepClass(i + 1, step)}
              aria-current={i + 1 === step ? 'step' : undefined}
            >
              <span className="step-badge num">{i + 1 < step ? '✓' : i + 1}</span>
              {name}
            </li>
          ))}
        </ol>
      </aside>
      <section className="card stack" aria-label={STEPS[step - 1]}>
        <div className="eyebrow">
          Step {step} of {STEPS.length}
        </div>
        {children}
      </section>
    </main>
  )
}

/** Back and the step's main button. */
export function Nav({
  onBack,
  next,
  busy,
  disabled,
}: {
  onBack?: () => void
  next: string
  busy?: boolean
  disabled?: boolean
}) {
  return (
    <div className="row-between">
      {onBack ? (
        <button type="button" className="btn ghost" onClick={onBack}>
          Back
        </button>
      ) : (
        <span />
      )}
      <button type="submit" className="btn primary" disabled={busy || disabled}>
        {busy ? 'Saving' : next}
      </button>
    </div>
  )
}

function stepClass(index: number, current: number): string {
  if (index === current) return 'step current'
  if (index < current) return 'step done'
  return 'step'
}
