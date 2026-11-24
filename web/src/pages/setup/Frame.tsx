// The frame every setup step sits in, and the buttons at its foot.

import type { ReactNode } from 'react'
import { AUTH_LOGO_SIZE, Logo } from '../../components/ui'

/** The steps in order, as the step list names them. Step numbers count from 1. */
export const STEPS = [
  'Setup code',
  'Your sign-in',
  'Budget period',
  'Bank sync',
  'Paystub',
  'Categories',
  'Done',
] as const

/** The step list beside the current step's card; on a phone, only the current name shows. */
export function Frame({ step, children }: { step: number; children: ReactNode }) {
  return (
    <main className="setup">
      <aside className="stack">
        <div className="brand">
          <Logo size={AUTH_LOGO_SIZE} />
          leeway
        </div>
        <ol className="steps" aria-label="Setup steps">
          {STEPS.map((name, i) => (
            <li
              key={name}
              className={stepClass(i + 1, step)}
              aria-current={i + 1 === step ? 'step' : undefined}
            >
              <span className="step-badge num" aria-hidden="true">
                {i + 1 < step ? '✓' : i + 1}
              </span>
              <span className="step-name">{name}</span>
              {i + 1 < step && <span className="visually-hidden"> (done)</span>}
            </li>
          ))}
        </ol>
      </aside>
      {/* "step" keeps the region's name apart from a field named the same, like Setup code. */}
      <section className="card stack" aria-label={`${STEPS[step - 1]} step`}>
        <div className="eyebrow">
          Step {step} of {STEPS.length}
        </div>
        {children}
      </section>
    </main>
  )
}

/**
 * Back and the step's main button. `busyLabel` replaces the button's words
 * while it works; `quiet` drops its emphasis when another button on the step
 * is the one to press, like Connect a bank beside Skip for now.
 */
export function Nav({
  onBack,
  next,
  busy,
  busyLabel = 'Saving',
  disabled,
  quiet = false,
}: {
  onBack?: () => void
  next: string
  busy?: boolean
  busyLabel?: string
  disabled?: boolean
  quiet?: boolean
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
      <button type="submit" className={quiet ? 'btn' : 'btn primary'} disabled={busy || disabled}>
        {busy ? busyLabel : next}
      </button>
    </div>
  )
}

function stepClass(index: number, current: number): string {
  if (index === current) return 'step current'
  if (index < current) return 'step done'
  return 'step'
}
