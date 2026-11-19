// Step two of an import: which column holds what, and how the file writes
// dates and money. Leeway's guess fills it in; the owner fixes what is wrong.

import type { ReactNode } from 'react'
import { Segmented } from '../../components/ui'
import { DECIMAL_MARKS, type DecimalMark } from '../../lib/csv/amounts'
import { DATE_FORMATS, type DateFormat } from '../../lib/csv/dates'
import type { AmountColumns, AmountKind, ColumnMapping } from '../../lib/csv/mapping'
import type { CsvTable } from '../../lib/csv/parse'

const AMOUNT_KINDS: readonly { value: AmountKind; label: string }[] = [
  { value: 'signed', label: 'One amount' },
  { value: 'split', label: 'Money out and in' },
  { value: 'direction', label: 'Amount and type' },
]

/** A column picker; `optional` adds a "None" choice. */
function ColumnSelect({
  label,
  columns,
  value,
  optional = false,
  onChange,
}: {
  label: string
  columns: string[]
  value: number | null
  optional?: boolean
  onChange: (column: number | null) => void
}) {
  return (
    <label className="field">
      {label}
      <select
        className="input"
        aria-label={label}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      >
        <option value="" disabled={!optional}>
          {optional ? 'None' : 'Choose a column'}
        </option>
        {columns.map((name, index) => (
          <option key={index} value={index}>
            {name}
          </option>
        ))}
      </select>
    </label>
  )
}

/** The columns of a new amount layout, reusing the current amount column where there is one. */
function amountOfKind(kind: AmountKind, current: AmountColumns | null): AmountColumns {
  const column = current?.kind === 'split' ? current.debit : (current?.column ?? 0)
  if (kind === 'split') return { kind, debit: column, credit: column }
  if (kind === 'direction') return { kind, column, direction: column }
  return { kind, column }
}

function Grid({ children }: { children: ReactNode }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
      {children}
    </div>
  )
}

export function MappingForm({
  table,
  mapping,
  datesAmbiguous,
  onChange,
}: {
  table: CsvTable
  mapping: ColumnMapping
  /** The dates read both month first and day first, so the owner should check. */
  datesAmbiguous: boolean
  onChange: (mapping: ColumnMapping) => void
}) {
  const set = (change: Partial<ColumnMapping>) => onChange({ ...mapping, ...change })
  const setAmount = (amount: AmountColumns) => set({ amount })
  const { columns } = table
  const amount = mapping.amount

  return (
    <section className="card stack" aria-labelledby="import-mapping-title">
      <div>
        <h2 id="import-mapping-title">2. Match the columns</h2>
        <span className="small muted">Leeway guessed these. Check the preview below.</span>
      </div>
      <Grid>
        <ColumnSelect
          label="Date"
          columns={columns}
          value={mapping.date}
          onChange={(date) => set({ date })}
        />
        <ColumnSelect
          label="Description"
          columns={columns}
          value={mapping.description}
          onChange={(description) => set({ description })}
        />
        <ColumnSelect
          label="Category (optional)"
          columns={columns}
          value={mapping.category}
          optional
          onChange={(category) => set({ category })}
        />
        <ColumnSelect
          label="Account (optional)"
          columns={columns}
          value={mapping.account}
          optional
          onChange={(account) => set({ account })}
        />
      </Grid>

      <Segmented
        label="Amount columns"
        value={amount?.kind ?? 'signed'}
        options={AMOUNT_KINDS}
        onChange={(kind) => setAmount(amountOfKind(kind, amount))}
      />
      <Grid>
        {amount?.kind === 'split' ? (
          <>
            <ColumnSelect
              label="Money out"
              columns={columns}
              value={amount.debit}
              onChange={(debit) => setAmount({ ...amount, debit: debit! })}
            />
            <ColumnSelect
              label="Money in"
              columns={columns}
              value={amount.credit}
              onChange={(credit) => setAmount({ ...amount, credit: credit! })}
            />
          </>
        ) : (
          <ColumnSelect
            label="Amount"
            columns={columns}
            value={amount?.column ?? null}
            onChange={(column) =>
              setAmount(
                amount?.kind === 'direction'
                  ? { ...amount, column: column! }
                  : { kind: 'signed', column: column! },
              )
            }
          />
        )}
        {amount?.kind === 'direction' && (
          <ColumnSelect
            label="Type (debit or credit)"
            columns={columns}
            value={amount.direction}
            onChange={(direction) => setAmount({ ...amount, direction: direction! })}
          />
        )}
        <SignChoice mapping={mapping} onChange={(flip) => set({ flip })} />
      </Grid>

      <Grid>
        <label className="field">
          Date order
          <select
            className="input"
            aria-label="Date order"
            value={mapping.dateFormat}
            onChange={(e) => set({ dateFormat: e.target.value as DateFormat })}
          >
            {DATE_FORMATS.map((format) => (
              <option key={format.value} value={format.value}>
                {format.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Decimal mark
          <select
            className="input"
            aria-label="Decimal mark"
            value={mapping.decimalMark}
            onChange={(e) => set({ decimalMark: e.target.value as DecimalMark })}
          >
            {DECIMAL_MARKS.map((mark) => (
              <option key={mark.value} value={mark.value}>
                {mark.label}
              </option>
            ))}
          </select>
        </label>
      </Grid>
      {datesAmbiguous && (
        <p className="notice small">
          These dates read either way, month first or day first. Check the preview and pick the
          order your bank uses.
        </p>
      )}
    </section>
  )
}

/**
 * How the file shows spending. One signed column says it with its signs, so
 * the owner names which sign spending has; with separate columns or a type
 * column the file already says, and a swap fixes a file that has them backwards.
 */
function SignChoice({
  mapping,
  onChange,
}: {
  mapping: ColumnMapping
  onChange: (flip: boolean) => void
}) {
  if (mapping.amount?.kind !== 'signed') {
    return (
      <label className="check small" style={{ alignSelf: 'end', minHeight: 44 }}>
        <input
          type="checkbox"
          checked={mapping.flip}
          onChange={(e) => onChange(e.target.checked)}
        />
        Swap money out and money in
      </label>
    )
  }
  return (
    <label className="field">
      Spending shows as
      <select
        className="input"
        aria-label="Spending shows as"
        value={mapping.flip ? 'negative' : 'positive'}
        onChange={(e) => onChange(e.target.value === 'negative')}
      >
        <option value="negative">Negative numbers (-4.50)</option>
        <option value="positive">Positive numbers (4.50)</option>
      </select>
    </label>
  )
}
