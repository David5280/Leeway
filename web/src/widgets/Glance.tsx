// Four quick numbers: spent, income, what needs a category, and bank sync.
// Each tile is a card of its own with an icon chip, and each opens the math
// behind its number (lib/drills/).

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Budget } from '../api/client'
import { useAction } from '../api/hooks'
import { Card } from '../components/design/Card'
import { Money } from '../components/design/Money'
import { UsualChip } from '../components/design/UsualChip'
import { Icon, type IconName } from '../components/ui'
import { useApp } from '../lib/app'
import { incomeDrill, spendingUsual, spentDrill, uncategorizedDrill } from '../lib/drills/budget'
import { syncDrill } from '../lib/drills/pace'
import { periodWord, timeAgo } from '../lib/format'
import { settingsPath } from '../pages/settings/paths'
import type { WidgetProps } from './types'

export function GlanceWidget({ budget }: WidgetProps) {
  const { settings } = useApp()
  const word = periodWord(settings.period.kind)
  return (
    <section aria-label="This period at a glance" className="glance">
      <SpentCard budget={budget} word={word} />
      <IncomeCard budget={budget} word={word} />
      <UncategorizedCard budget={budget} />
      <BankSyncCard />
    </section>
  )
}

/** A tile's head: its icon chip, tinted by what it means, and its title. */
function TileHead({ icon, title, tone }: { icon: IconName; title: string; tone?: 'in' | 'warn' }) {
  return (
    <span className="tile-head">
      <span className={`tile-icon ${tone ? `tile-icon-${tone}` : ''}`} aria-hidden="true">
        <Icon name={icon} size={16} />
      </span>
      <span className="eyebrow">{title}</span>
    </span>
  )
}

/** Spending so far, with the usual chip, against the same point in the last period. */
function SpentCard({ budget, word }: { budget: Budget; word: string }) {
  const trends = useAction('get_trends', { periods: 6 })
  return (
    <Card drill={spentDrill(budget, word, trends.data)} label="Spent" className="stack-sm">
      <TileHead icon="moneyOut" title="Spent" />
      <Money cents={budget.totals.spentCents} className="mid-number" />
      {budget.period.offset === 0 && <UsualChip usual={spendingUsual(budget, word)} />}
    </Card>
  )
}

function IncomeCard({ budget, word }: { budget: Budget; word: string }) {
  return (
    <Card drill={incomeDrill(budget, word)} label="Income" className="stack-sm">
      <TileHead icon="moneyIn" title="Income" tone="in" />
      <Money cents={budget.totals.incomeCents} sign="change" tone="in" className="mid-number" />
      <span className="small muted">Money in this {word}</span>
    </Card>
  )
}

function UncategorizedCard({ budget }: { budget: Budget }) {
  const { uncategorizedCount, uncategorizedCents } = budget.totals
  return (
    <Card drill={uncategorizedDrill(budget)} label="Needs a category" className="stack-sm">
      <TileHead
        icon="tag"
        title="Needs a category"
        tone={uncategorizedCount > 0 ? 'warn' : undefined}
      />
      <span className="num mid-number">{uncategorizedCount}</span>
      <span className="small muted">
        {uncategorizedCount > 0 ? (
          <>
            <Money cents={uncategorizedCents} /> of spending to sort
          </>
        ) : (
          'All sorted'
        )}
      </span>
    </Card>
  )
}

/** Whether every bank is syncing, and when the latest sync was. */
function BankSyncCard() {
  const { data: connections, error } = useAction('list_connections')
  // Never claim "up to date" before the banks have been read.
  if (!connections) {
    return (
      <SyncFrame>
        <span className="small muted">{error ? 'Could not check your banks' : 'Checking'}</span>
      </SyncFrame>
    )
  }
  if (connections.length === 0) {
    return (
      <SyncFrame>
        <span style={{ fontSize: 18, fontWeight: 600 }}>No banks yet</span>
        <Link to={settingsPath('banks')} className="linkbtn small tap">
          Connect a bank
        </Link>
      </SyncFrame>
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
    <Card drill={syncDrill(connections, timeAgo)} label="Bank sync" className="stack-sm">
      <TileHead icon="sync" title="Bank sync" tone={needsYou ? 'warn' : 'in'} />
      <span className="tile-status">
        {needsYou ? 'Needs you' : 'Up to date'}
        <Icon name={needsYou ? 'warn' : 'check'} size={16} />
      </span>
      <span className="small muted">
        {count} {count === 1 ? 'bank' : 'banks'}, synced {timeAgo(lastSync ?? null)}
      </span>
    </Card>
  )
}

/** The sync tile before there is a figure to explain: no banks yet, or still checking. */
function SyncFrame({ children }: { children: ReactNode }) {
  return (
    <Card static="empty" label="Bank sync" className="stack-sm">
      <TileHead icon="sync" title="Bank sync" />
      {children}
    </Card>
  )
}
