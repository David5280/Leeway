// <Card>: the one surface every screen is built from. A card that shows a
// figure must explain it, so its props demand one of three things:
//   - `drill`: the card is one button that opens the figure's drill-down
//     (lib/drill.ts) in a sheet; a chart with its own readout goes in
//     `below`, after the button, so a finger on it reads the chart;
//   - `to`: the whole card is one link to the figure's own full page, which
//     carries the same drill-down sections (an account's detail page);
//   - `static`: no figure of its own, with the reason why (StaticReason).
// TypeScript refuses a card with none of these, and card.contract.test.tsx
// checks every card on Overview, Accounts and Activity, so no figure ships
// without its explanation. A tappable card holds no buttons or links of its
// own: the drill-down is where its parts are opened.
//
// Any card can also be pressed and held (or right clicked, or given the
// context menu key) to ask Leeway about it (ask/useCardHold.ts).

import { useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { DrillDown } from '../../lib/drill'
import { useCardHold, type HoldHandlers } from '../ask/useCardHold'
import { DrillSheet } from './DrillSheet'

/**
 * Why a card has no drill-down. Each names a kind of card with no figure to
 * explain; a card with a figure has no reason to be static.
 */
export const STATIC_REASONS = {
  form: 'A form or settings: its own controls are what is pressed',
  list: 'A list whose rows each open their own page or sheet',
  words: 'Words or a notice, with no figure',
  empty: 'An empty, loading or error state, with nothing to explain yet',
  chart: 'A chart with its own readout under a finger or pointer',
  pending:
    'A figure on a screen not yet redesigned; its drill-down comes with that screen, and Overview, Accounts and Activity may not use this',
} as const

export type StaticReason = keyof typeof STATIC_REASONS

interface Base {
  children: ReactNode
  className?: string
  /** The card's name for screen readers. A tappable card's button is named by what it shows. */
  label?: string
  style?: CSSProperties
}

/** Exactly one of drill, to or static: a figure card cannot leave its explanation out. */
export type CardProps = Base &
  (
    | {
        drill: DrillDown
        /**
         * What follows the button inside the card: a chart whose readout
         * answers a finger or pointer, so a tap there reads the chart
         * instead of opening the sheet.
         */
        below?: ReactNode
        to?: never
        static?: never
      }
    | { to: string; drill?: never; static?: never }
    | { static: StaticReason; drill?: never; to?: never }
  )

export function Card(props: CardProps) {
  const { children, className = '', label, style } = props
  const hold = useCardHold(label)
  if (props.drill) {
    return (
      <DrillCard
        hold={hold}
        drill={props.drill}
        below={props.below}
        className={className}
        label={label}
        style={style}
      >
        {children}
      </DrillCard>
    )
  }
  if (props.to) {
    return (
      <section className={`card card-tap ${className}`} aria-label={label} style={style} {...hold}>
        <Link to={props.to} className="card-press">
          {children}
          <span className="visually-hidden">, open details</span>
        </Link>
      </section>
    )
  }
  return (
    <section
      className={`card ${className}`}
      aria-label={label}
      style={style}
      data-static={props.static}
      {...hold}
    >
      {children}
    </section>
  )
}

/** A card that is one button, opening its drill-down in a sheet, with any chart after it. */
function DrillCard({
  hold,
  drill,
  below,
  children,
  className,
  label,
  style,
}: Base & { hold: HoldHandlers; drill: DrillDown; below?: ReactNode; className: string }) {
  const [open, setOpen] = useState(false)
  const split = below !== undefined
  return (
    <section
      className={`card card-tap${split ? ' card-split' : ''} ${className}`}
      aria-label={label}
      style={style}
      {...hold}
    >
      <button
        type="button"
        className="card-press"
        aria-haspopup="dialog"
        data-drill={drill.title}
        onClick={() => setOpen(true)}
      >
        {children}
        <span className="visually-hidden">, show how it adds up</span>
      </button>
      {split && <div className="card-below">{below}</div>}
      {open && <DrillSheet drill={drill} onClose={() => setOpen(false)} />}
    </section>
  )
}
