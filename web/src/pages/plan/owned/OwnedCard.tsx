// "Entered by you": the home, car, other things owned and the loans the owner
// keeps by hand, which count in net worth beside the bank's balances. Each row
// opens its form; nothing here is read from a bank, and the card says so.

import { useState } from 'react'
import { useAction } from '../../../api/hooks'
import { Card } from '../../../components/design/Card'
import { Money } from '../../../components/design/Money'
import { LoadingOrError } from '../../../components/ui'
import { useApp } from '../../../lib/app'
import { isoDaysAgo } from '../../../lib/dates'
import { FormCard } from '../FormCard'
import { OwnedForm } from './OwnedForm'
import { itemDetail, updatedWords, type OwnedItem } from './ownedText'

/** What the form is open on: an item, or a new one. */
type Editing = { item: OwnedItem | null }

/** One thing entered by hand, as a row that opens its form, saying how old its amount is. */
function ItemRow({ item, onOpen }: { item: OwnedItem; onOpen: () => void }) {
  const { settings } = useApp()
  const updated = updatedWords(item.updatedOn, isoDaysAgo(0, settings.timeZone), settings.locale)
  return (
    <button type="button" className="clickrow owned-row" onClick={onOpen}>
      <span className="row-between wrap">
        <span>{item.name}</span>
        {item.amountCents !== null && <Money cents={item.amountCents} className="num" />}
      </span>
      <span className="row-between wrap small muted">
        <span>{updated ? `${itemDetail(item)}. ${updated}` : itemDetail(item)}</span>
        {item.equityCents !== null && (
          <span>
            Yours after the loan:{' '}
            <Money cents={item.equityCents} tone={item.equityCents < 0 ? 'problem' : undefined} />
          </span>
        )}
      </span>
    </button>
  )
}

/** A heading over a group of rows, with what the group comes to. */
function Group({
  title,
  items,
  totalCents,
  onOpen,
}: {
  title: string
  items: OwnedItem[]
  totalCents: number
  onOpen: (item: OwnedItem) => void
}) {
  if (items.length === 0) return null
  return (
    <div className="stack-sm" role="group" aria-label={title}>
      <span className="row-between eyebrow">
        <span>{title}</span>
        <Money cents={totalCents} />
      </span>
      {items.map((item) => (
        <ItemRow key={item.id} item={item} onOpen={() => onOpen(item)} />
      ))}
    </div>
  )
}

export function OwnedCard() {
  const list = useAction('list_owned_and_owed')
  const [editing, setEditing] = useState<Editing | null>(null)
  if (!list.data) return <LoadingOrError error={list.error} />
  const { owned, owed, ownedCents, owedCents } = list.data
  const empty = owned.length === 0 && owed.length === 0
  return (
    <>
      {editing && (
        // Keyed by what is open, so moving to another row brings the form into view again.
        <FormCard
          key={editing.item?.id ?? 'new'}
          title={editing.item?.name ?? 'Add something you own or owe'}
        >
          <OwnedForm item={editing.item ?? undefined} onClose={() => setEditing(null)} />
        </FormCard>
      )}
      <Card static="list" label="Entered by you" className="stack">
        <div className="row-between wrap">
          <h2>Entered by you</h2>
          <button type="button" className="btn" onClick={() => setEditing({ item: null })}>
            Add
          </button>
        </div>
        {empty ? (
          <p className="small muted">
            Add a home, a car or a loan your bank link does not cover, so your net worth counts it.
          </p>
        ) : (
          <>
            <p className="small muted">Not from your bank. Update them now and then.</p>
            <Group
              title="You own"
              items={owned}
              totalCents={ownedCents}
              onOpen={(item) => setEditing({ item })}
            />
            <Group
              title="You owe"
              items={owed}
              totalCents={owedCents}
              onOpen={(item) => setEditing({ item })}
            />
          </>
        )}
      </Card>
    </>
  )
}
