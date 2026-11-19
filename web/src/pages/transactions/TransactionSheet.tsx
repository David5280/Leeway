// A transaction's sheet: what it was, where and when, and everything that
// can be changed about it. It has three views in the same dialog: the
// details, the category picker, and a rule that files ones like it.

import { useState } from 'react'
import type { Category, Transaction } from '../../api/client'
import { useActionMutation } from '../../api/hooks'
import { CategoryIcon } from '../../components/design/CategoryIcon'
import { Sheet } from '../../components/design/Sheet'
import { RuleBuilder } from '../../components/rules/RuleBuilder'
import { ErrorNote, Icon } from '../../components/ui'
import { useApp } from '../../lib/app'
import { isoDaysAgo } from '../../lib/dates'
import { relativeDay } from '../../lib/format'
import { byName } from '../../lib/sort'
import { isMove, rulePattern } from '../../lib/transactions'
import { CategoryPicker } from './CategoryPicker'
import { TransactionDetails } from './TransactionDetails'
import { useTransaction } from './useTransaction'

type View = 'details' | 'category' | 'rule'

export function TransactionSheet({
  initial,
  categories,
  onOpen,
  onClose,
}: {
  /** The transaction as the list had it, shown until the fresh copy arrives. */
  initial: Transaction
  categories: Category[]
  /** Opens another transaction in the sheet, like a transfer's other side. */
  onOpen: (tx: Transaction) => void
  onClose: () => void
}) {
  const { settings } = useApp()
  const tx = useTransaction(initial) ?? initial
  const [view, setView] = useState<View>('details')
  const update = useActionMutation('update_transaction')
  // The pick shows at once, and stays until the server's copy agrees; if
  // saving fails, the sheet goes back to what the server has.
  const [picked, setPicked] = useState<{ id: string | null } | null>(null)
  const categoryId = picked && !update.isError ? picked.id : tx.categoryId
  const category = categories.find((c) => c.id === categoryId)
  const moved = isMove(category?.kind ?? null)

  function pick(id: string | null) {
    setPicked({ id })
    setView('details')
    if (id !== tx.categoryId) update.mutate({ id: tx.id, categoryId: id })
  }

  function letRulesDecide() {
    setPicked(null)
    update.mutate({ id: tx.id, categoryId: null })
  }

  const today = isoDaysAgo(0, settings.timeZone)
  return (
    <Sheet
      title={tx.displayName}
      subtitle={`${relativeDay(tx.date, today, settings.locale)} · ${tx.accountName}`}
      leading={<CategoryIcon category={category} transfer={moved} size="lg" />}
      focusKey={view}
      onClose={onClose}
    >
      {view === 'details' && (
        <TransactionDetails
          tx={tx}
          category={category}
          onChangeCategory={() => setView('category')}
          onMakeRule={() => setView('rule')}
          onLetRulesDecide={letRulesDecide}
          onOpen={onOpen}
          onDeleted={onClose}
        />
      )}
      {view === 'category' && (
        <>
          <BackButton label="Back to details" onBack={() => setView('details')} />
          <CategoryPicker
            categories={categories}
            value={categoryId}
            label={`Category for ${tx.displayName}`}
            onPick={pick}
          />
        </>
      )}
      {view === 'rule' && (
        <RuleBuilder
          embedded
          initial={{
            field: 'merchant',
            matchType: 'contains',
            pattern: rulePattern(tx),
            categoryId,
          }}
          categories={byName(categories, settings.locale)}
          onClose={() => setView('details')}
        />
      )}
      <ErrorNote error={update.error} />
    </Sheet>
  )
}

function BackButton({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <button type="button" className="linkbtn sheet-back" onClick={onBack}>
      <Icon name="back" size={16} />
      {label}
    </button>
  )
}
