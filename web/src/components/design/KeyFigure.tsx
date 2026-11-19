// A card's one focal point: a label, the big number, and a plain-language
// caption under it that says what the number means for the owner ("$36 left
// for the next 4 days"). Important words in the caption go in <b>.

import type { ReactNode } from 'react'
import { Money, type MoneyProps } from './Money'

export function KeyFigure({
  label,
  caption,
  ...money
}: {
  label: string
  caption?: ReactNode
} & Omit<MoneyProps, 'size' | 'as'>) {
  return (
    <div className="key-figure">
      <span className="key-figure-label">{label}</span>
      <Money {...money} size="xl" />
      {caption && <p className="key-figure-caption">{caption}</p>}
    </div>
  )
}
