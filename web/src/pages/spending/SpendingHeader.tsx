// Spending's title, the period on screen and the period arrows. Looking back
// happens here and only here: Home is always now. Back steps to the period
// before; forward stops at the current one.

import type { Budget } from '../../api/client'
import { Icon } from '../../components/ui'
import { useApp } from '../../lib/app'
import { periodWord } from '../../lib/format'
import { periodLine } from './leadText'
import { OLDEST_PERIOD, periodDistance } from './period'

interface HeaderProps {
  period: number
  /** The period's budget, once loaded, for its dates and how far through it is. */
  budget: Budget | undefined
  onStep: (period: number) => void
}

export function SpendingHeader({ period, budget, onStep }: HeaderProps) {
  const { settings } = useApp()
  const distance = periodDistance(period, periodWord(settings.period.kind))
  const standing = budget ? periodLine(budget, distance, settings.locale) : distance
  return (
    <div className="row-between">
      <div>
        <h1>Spending</h1>
        {/* Until the period loads, how far back it is stands in for its dates. */}
        <span className="muted">{standing}</span>
      </div>
      <div className="row" role="group" aria-label="Budget period">
        <button
          type="button"
          className="iconbtn"
          aria-label="Previous period"
          disabled={period <= OLDEST_PERIOD}
          onClick={() => onStep(period - 1)}
        >
          <Icon name="back" />
        </button>
        <button
          type="button"
          className="iconbtn"
          aria-label="Next period"
          disabled={period >= 0}
          onClick={() => onStep(period + 1)}
        >
          <Icon name="forward" />
        </button>
      </div>
    </div>
  )
}
