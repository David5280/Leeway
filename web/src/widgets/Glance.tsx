// Four quick numbers: spent, income, what needs a category, and bank sync.

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Budget } from '../api/client'
import { useAction } from '../api/hooks'
import { Money } from '../components/design/Money'
import { SpentComparison } from '../components/SpentComparison'
import { Dot } from '../components/ui'
import { useApp } from '../lib/app'
import { periodWord, timeAgo } from '../lib/format'
import { settingsPath } from '../pages/settings/paths'
import type { WidgetProps } from './types'

export function GlanceWidget({ budget }: WidgetProps) {
  const { settings } = useApp()
  const word = periodWord(settings.period.kind)
  return (
    <section aria-label="This period at a glance" className="glance">
      <SpentCard budget={budget} word={word} />
      <GlanceCard title="Income">
        <Money cents={budget.totals.incomeCents} className="mid-number" />
        <span className="small muted">Money in this {word}</span>
      </GlanceCard>
      <UncategorizedCard budget={budget} />
      <BankSyncCard />
    </section>
  )
}

function GlanceCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card stack-sm">
      <p className="eyebrow">{title}</p>
      {children}
    </div>
  )
}

/** Spending so far, compared with the same point in the last period. */
function SpentCard({ budget, word }: { budget: Budget; word: string }) {
  return (
    <GlanceCard title="Spent">
      <Money cents={budget.totals.spentCents} className="mid-number" />
      <span className="small muted">
        <SpentComparison totals={budget.totals} previous={budget.previous} word={word} />
      </span>
    </GlanceCard>
  )
}

function UncategorizedCard({ budget }: { budget: Budget }) {
  const { uncategorizedCount, uncategorizedCents } = budget.totals
  return (
    <GlanceCard title="Needs a category">
      <span className="num mid-number">{uncategorizedCount}</span>
      {uncategorizedCount > 0 ? (
        <Link to="/transactions?category=uncategorized" className="linkbtn small">
          Sort <Money cents={uncategorizedCents} /> of spending
        </Link>
      ) : (
        <span className="small muted">All sorted</span>
      )}
    </GlanceCard>
  )
}

/** Whether every bank is syncing, and when the latest sync was. */
function BankSyncCard() {
  const { data: connections, error } = useAction('list_connections')
  // Never claim "up to date" before the banks have been read.
  if (!connections) {
    return (
      <GlanceCard title="Bank sync">
        <span className="small muted">{error ? 'Could not check your banks' : 'Checking'}</span>
      </GlanceCard>
    )
  }
  if (connections.length === 0) {
    return (
      <GlanceCard title="Bank sync">
        <span style={{ fontSize: 18, fontWeight: 600 }}>No banks yet</span>
        <Link to={settingsPath('banks')} className="linkbtn small">
          Connect a bank
        </Link>
      </GlanceCard>
    )
  }
  const count = connections.length
  const needsYou = connections.some((c) => c.status !== 'active')
  // ISO timestamps sort as text, so the last one is the newest.
  const lastSync = connections
    .map((c) => c.lastSyncedAt)
    .filter((at): at is string => at !== null)
    .sort()
    .at(-1)
  return (
    <GlanceCard title="Bank sync">
      <span className="row" style={{ fontSize: 18, fontWeight: 600, gap: 8 }}>
        <Dot color={needsYou ? 'var(--warn)' : 'var(--good)'} />
        {needsYou ? 'Needs you' : 'Up to date'}
      </span>
      <span className="small muted">
        {count} {count === 1 ? 'bank' : 'banks'}, synced {timeAgo(lastSync ?? null)}
      </span>
    </GlanceCard>
  )
}
