// "Where did your money go?": one bar per category on a shared scale, each
// with its budget as a line, so how much and how close to the limit read at
// a glance. Amounts are written on every row, so there is nothing to decode;
// color only says what is wrong (amber near the limit, red past it), and a
// word says it too.

import type { CategoryBudget } from '../../api/client'
import { CategoryIcon } from '../design/CategoryIcon'
import { Money } from '../design/Money'
import { barScale, barShape } from './categoryBars'

/** A row's state in a word, when it needs one: past its budget or close to it. */
function rowWord(row: CategoryBudget): { text: string; tone: 'over' | 'warn' } | null {
  if (row.status === 'over') return { text: 'Over', tone: 'over' }
  if (row.status === 'warning') return { text: 'Close', tone: 'warn' }
  return null
}

export function CategoryBars({ rows }: { rows: readonly CategoryBudget[] }) {
  const scale = barScale(rows)
  return (
    <ul className="cbars">
      {rows.map((row, index) => {
        const shape = barShape(row, scale)
        const word = rowWord(row)
        return (
          <li key={row.categoryId} className="cbar">
            <CategoryIcon
              category={{ name: row.name, color: row.color, icon: row.icon, kind: row.kind }}
              size="sm"
            />
            <span className="cbar-body">
              <span className="cbar-top">
                <span className="cbar-name">{row.name}</span>
                <span className="cbar-figures">
                  {word && <span className={`cbar-word ${word.tone}`}>{word.text}</span>}
                  <Money cents={row.spentCents} />
                  {row.budgetCents !== null && (
                    <span className="muted">
                      {' '}
                      of <Money cents={row.budgetCents} />
                    </span>
                  )}
                </span>
              </span>
              <span className="cbar-track" aria-hidden="true">
                <span
                  className={`cbar-fill bar-grow ${word ? `cbar-${word.tone}` : ''}`}
                  style={{ width: `${shape.within}%`, ['--i' as string]: index }}
                />
                {shape.over > 0 && (
                  <span
                    className="cbar-fill cbar-past bar-grow"
                    style={{
                      left: `${shape.within}%`,
                      width: `${shape.over}%`,
                      ['--i' as string]: index,
                    }}
                  />
                )}
                {shape.limit !== null && (
                  <span className="cbar-limit" style={{ left: `${shape.limit}%` }} />
                )}
              </span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
