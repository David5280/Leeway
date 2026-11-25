// One line of a sum under a card's figure: a name over a short reason, and
// its amount lined up at the end. A run of them reads as the sum's terms, and
// the last, given the total's class, as what they come to (styles/playbook.css).
// Payday's paycheck and Spending's lead both add up this way.

import type { ReactNode } from 'react'
import type { MoneyTone } from '../../lib/money'
import { Money } from './Money'

export interface SumRowProps {
  name: string
  detail?: ReactNode
  cents: number
  /** In a sum, what is added reads "+" and what comes out of it "−"; otherwise a plain figure. */
  sum?: 'plus' | 'minus'
  tone?: MoneyTone
  className?: string
}

export function SumRow({ name, detail, cents, sum, tone, className = '' }: SumRowProps) {
  return (
    <span className={`list-row ${className}`}>
      <span className="grow playbook-row-words">
        <span className="playbook-row-name">{name}</span>
        {detail && <span className="small muted">{detail}</span>}
      </span>
      <b className="num">
        <Money
          cents={sum === 'minus' ? -cents : cents}
          sign={sum ? 'change' : 'plain'}
          tone={tone}
        />
      </b>
    </span>
  )
}
