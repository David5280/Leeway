// A screen's one hero number: a label, the amount large and heavy in tabular
// figures counting up to its value, a chip comparing it with the usual, and a
// caption saying what it means ("About $44 a day for the next 8 days").

import type { ReactNode } from 'react'
import type { DrillUsual } from '../../lib/drill'
import type { MoneyProps } from './Money'
import { CountUp } from './CountUp'
import { UsualChip } from './UsualChip'

export function HeroFigure({
  label,
  caption,
  usual,
  aside,
  ...money
}: {
  label: string
  caption?: ReactNode
  /** Compared with the usual in a chip beside the number. */
  usual?: DrillUsual
  /** Drawn at the end of the figure's row, like a ring. */
  aside?: ReactNode
} & Omit<MoneyProps, 'size' | 'as' | 'onOpen' | 'openLabel'>) {
  return (
    <div className="hero-figure">
      <div className="hero-figure-main">
        <span className="hero-figure-label">{label}</span>
        <span className="hero-figure-line">
          <CountUp {...money} className="hero-figure-number" />
          {usual && <UsualChip usual={usual} />}
        </span>
        {caption && <p className="hero-figure-caption">{caption}</p>}
      </div>
      {aside && <div className="hero-figure-aside">{aside}</div>}
    </div>
  )
}
