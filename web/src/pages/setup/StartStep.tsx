// Step 5: picking the categories to start with: suggested budgets, a starter set, empty, or a copy.

import { Fragment, useState, type FormEvent } from 'react'
import { call, type Input } from '../../api/client'
import { useAction, useActionMutation } from '../../api/hooks'
import { Money } from '../../components/design/Money'
import { Dot, ErrorNote, Loading } from '../../components/ui'
import { alphabeticalGroups } from '../../lib/alphabetical'
import { useApp } from '../../lib/app'
import { Frame, Nav } from './Frame'
import {
  categoriesToCreate,
  defaultStart,
  starterRows,
  type Edits,
  type Start,
  type StarterRow,
} from './starters'

export function StartStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const hasBank = useAction('list_connections').data?.some((c) => c.accountCount > 0)
  const [picked, setPicked] = useState<Start | null>(null)
  const start = defaultStart(picked, hasBank)
  const [edits, setEdits] = useState<Edits>({})
  const [imported, setImported] = useState<string | null>(null)
  const finish = useActionMutation('complete_setup')
  const listed = start === 'suggest' || start === 'starter'
  const { rows, ready, error } = useStarterRows(start === 'suggest', edits)

  function choose(choice: Start) {
    setPicked(choice)
    setEdits({})
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    // An import has already saved its categories; "empty" makes none.
    finish.mutate({ categories: listed ? categoriesToCreate(rows) : [] }, { onSuccess: onNext })
  }

  const edit = (name: string, change: Edits[string]) =>
    setEdits((current) => ({ ...current, [name]: { ...current[name], ...change } }))

  return (
    <Frame step={5}>
      <form className="stack" onSubmit={submit}>
        <h1>Choose your categories</h1>
        <p className="muted">
          Categories sort your spending, like Groceries or Rent, and each can have a monthly budget.
          Pick a place to start; you can change all of it later.
        </p>
        <StartChoices start={start} hasBank={hasBank ?? false} onChoose={choose} />
        {listed && (ready ? <StarterList rows={rows} onEdit={edit} /> : <Loading />)}
        {start === 'import' && <ImportFile onImported={setImported} />}
        {imported && <p className="notice">{imported}</p>}
        <ErrorNote error={error ?? finish.error} />
        <Nav
          onBack={onBack}
          next="Continue"
          busy={finish.isPending}
          disabled={start === null || (start === 'import' && !imported)}
        />
      </form>
    </Frame>
  )
}

/** The starter categories as rows, with amounts from spending when `fromSpending` is on. */
function useStarterRows(fromSpending: boolean, edits: Edits) {
  const starters = useAction('get_starter_categories')
  const suggestions = useAction(
    'suggest_starter_budgets',
    { categories: starters.data ?? [] },
    { enabled: fromSpending && starters.isSuccess },
  )
  if (!starters.isSuccess || (fromSpending && !suggestions.isSuccess)) {
    return { rows: [], ready: false, error: starters.error ?? suggestions.error }
  }
  const found = fromSpending ? (suggestions.data ?? []) : []
  return { rows: starterRows(starters.data, found, edits), ready: true, error: null }
}

function StartChoices({
  start,
  hasBank,
  onChoose,
}: {
  start: Start | null
  hasBank: boolean
  onChoose: (choice: Start) => void
}) {
  const choices: { id: Start; title: string; text: string; disabled?: boolean }[] = [
    {
      id: 'suggest',
      title: 'Suggest from my spending',
      text: hasBank ? 'Budgets from your last 3 months' : 'Connect a bank first',
      disabled: !hasBank,
    },
    { id: 'starter', title: 'Starter set', text: 'Everyday categories with typical amounts' },
    { id: 'empty', title: 'Start empty', text: 'Make your own categories later' },
    {
      id: 'import',
      title: 'Copy from another Leeway',
      text: 'Use a leeway.json file saved from its Settings (or Customize), then Data',
    },
  ]
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
      {choices.map((choice) => (
        <button
          key={choice.id}
          type="button"
          className="choice"
          aria-pressed={start === choice.id}
          disabled={choice.disabled}
          onClick={() => onChoose(choice.id)}
        >
          {choice.title}
          <span>{choice.text}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * The categories to create, A to Z under their group headings A to Z, so a
 * name is quick to find. They are still created in the starter set's own
 * order, which becomes the budget's.
 */
function StarterList({
  rows,
  onEdit,
}: {
  rows: StarterRow[]
  onEdit: (name: string, change: Edits[string]) => void
}) {
  const { settings } = useApp()
  const named = rows.map((row) => ({
    name: row.category.name,
    group: row.category.group ?? null,
    row,
  }))
  return (
    <div className="stack-sm" aria-label="Categories to create">
      <p className="small muted">
        Monthly budgets. Leave an amount blank for no budget, or untick a category to leave it out.
      </p>
      {alphabeticalGroups(named, settings.locale).map(({ group, categories }) => (
        <Fragment key={group ?? ''}>
          {group && <span className="eyebrow">{group}</span>}
          {categories.map(({ row }) => (
            <StarterItem key={row.category.name} row={row} onEdit={onEdit} />
          ))}
        </Fragment>
      ))}
    </div>
  )
}

/** One category to create: tick to keep, and a monthly amount for spending ones. */
function StarterItem({
  row: { category, include, amount, averageCents },
  onEdit,
}: {
  row: StarterRow
  onEdit: (name: string, change: Edits[string]) => void
}) {
  return (
    <div className="list-row starter-item">
      <label className="check grow">
        <input
          type="checkbox"
          checked={include}
          aria-label={`Include ${category.name}`}
          onChange={(e) => onEdit(category.name, { include: e.target.checked })}
        />
        <Dot color={category.color} />
        <span className="starter-name">
          {category.name}
          {averageCents !== null && (
            <span className="small muted">
              {' '}
              · you average <Money cents={averageCents} />
            </span>
          )}
        </span>
      </label>
      {category.kind === 'expense' ? (
        <input
          className="input num"
          style={{ width: 110 }}
          inputMode="decimal"
          placeholder="No budget"
          aria-label={`${category.name} budget`}
          value={amount}
          disabled={!include}
          onChange={(e) => onEdit(category.name, { amount: e.target.value })}
        />
      ) : (
        // Income and transfers take no budget, so say how each is counted
        // instead of repeating the name.
        <span className="small muted">
          {category.kind === 'income' ? 'Money in' : 'Not counted'}
        </span>
      )}
    </div>
  )
}

/** Imports a leeway.json from another install, replacing what is here. */
function ImportFile({ onImported }: { onImported: (message: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function importFile(file: File) {
    setError(null)
    setBusy(true)
    try {
      const config = JSON.parse(await file.text()) as Input<'import_config'>['config']
      const result = await call('import_config', { config, mode: 'replace' })
      onImported(
        `Imported ${result.categoriesAdded} categories and ${result.rulesAdded} rules from ${file.name}.`,
      )
    } catch (caught) {
      // A file that is not JSON at all gets a plain sentence, not a parser error.
      setError(caught instanceof SyntaxError ? new Error('That file is not valid JSON.') : caught)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <label className="field">
        Leeway setup file
        <input
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void importFile(file)
          }}
        />
      </label>
      <ErrorNote error={error} />
    </>
  )
}
