import { useState, type FormEvent } from 'react'
import type { Category, Input } from '../api/client'
import { useApp } from '../lib/app'
import { parseMoney } from '../lib/format'
import { CATEGORY_COLORS } from '../lib/theme'
import { ErrorNote, Segmented, Setting, Switch } from './ui'

export type CategoryFields = Required<Omit<Input<'create_category'>, 'icon'>>

const KINDS = [
  { value: 'expense', label: 'Spending' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
] as const

export const CADENCE_LABELS = {
  week: 'a week',
  biweek: 'every 2 weeks',
  semimonth: 'twice a month',
  month: 'a month',
  year: 'a year',
} as const

/** Plaid's top-level categories. Detailed ones (like FOOD_AND_DRINK_GROCERIES) can be typed in. */
export const BANK_CATEGORIES = [
  'FOOD_AND_DRINK',
  'FOOD_AND_DRINK_GROCERIES',
  'FOOD_AND_DRINK_RESTAURANT',
  'FOOD_AND_DRINK_COFFEE',
  'GENERAL_MERCHANDISE',
  'GENERAL_SERVICES',
  'ENTERTAINMENT',
  'TRANSPORTATION',
  'TRAVEL',
  'RENT_AND_UTILITIES',
  'HOME_IMPROVEMENT',
  'MEDICAL',
  'PERSONAL_CARE',
  'GOVERNMENT_AND_NON_PROFIT',
  'BANK_FEES',
  'LOAN_PAYMENTS',
  'INCOME',
  'TRANSFER_IN',
  'TRANSFER_OUT',
]

export const bankCategoryLabel = (code: string) => {
  const text = code.toLowerCase().replaceAll('_', ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function fieldsOf(category?: Category): CategoryFields {
  return {
    name: category?.name ?? '',
    color: category?.color ?? CATEGORY_COLORS[0][1],
    kind: category?.kind ?? 'expense',
    budgetCents: category?.budgetCents ?? null,
    budgetCadence: category?.budgetCadence ?? 'month',
    warnAtPercent: category?.warnAtPercent ?? null,
    trackPace: category?.trackPace ?? true,
    providerCategories: category?.providerCategories ?? [],
  }
}

/** Everything about a category in one form: used to add one and to change one. */
export function CategoryForm({
  category,
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  category?: Category
  submitLabel: string
  busy: boolean
  error: unknown
  onSubmit: (fields: CategoryFields) => void
  onCancel?: () => void
}) {
  const { settings } = useApp()
  const [fields, setFields] = useState(() => fieldsOf(category))
  const [amount, setAmount] = useState(
    category?.budgetCents ? String(category.budgetCents / 100) : '',
  )
  const [bankCode, setBankCode] = useState('')
  const set = (change: Partial<CategoryFields>) => setFields((f) => ({ ...f, ...change }))

  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit({ ...fields, budgetCents: fields.kind === 'transfer' ? null : parseMoney(amount) })
  }

  function addBankCode() {
    const code = bankCode.trim().toUpperCase().replace(/\s+/g, '_')
    if (code && !fields.providerCategories.includes(code)) {
      set({ providerCategories: [...fields.providerCategories, code] })
    }
    setBankCode('')
  }

  const expense = fields.kind === 'expense'
  return (
    <form
      className="stack"
      onSubmit={submit}
      aria-label={category ? 'Category settings' : 'New category'}
    >
      <label className="field">
        Name
        <input
          className="input"
          required
          maxLength={60}
          value={fields.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>
      <Setting label="Kind" hint="Transfers move money between your own accounts and never count">
        <Segmented
          label="Kind"
          value={fields.kind}
          options={KINDS}
          onChange={(kind) => set({ kind })}
        />
      </Setting>
      {fields.kind !== 'transfer' && (
        <Setting label={expense ? 'Budget' : 'Expected'} hint="Leave blank to just track it">
          <div className="row">
            <input
              className="input num"
              style={{ width: 110 }}
              inputMode="decimal"
              placeholder="None"
              aria-label="Budget amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <select
              className="input"
              style={{ width: 'auto' }}
              aria-label="Budget cadence"
              value={fields.budgetCadence}
              onChange={(e) =>
                set({ budgetCadence: e.target.value as CategoryFields['budgetCadence'] })
              }
            >
              {Object.entries(CADENCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </Setting>
      )}
      {expense && (
        <>
          <Setting
            label="Warn me at"
            hint={`Blank uses your default, ${settings.defaultWarnAtPercent}%`}
          >
            <div className="row">
              <input
                className="input num"
                style={{ width: 80 }}
                type="number"
                min={1}
                max={100}
                placeholder={String(settings.defaultWarnAtPercent)}
                aria-label="Warn at percent"
                value={fields.warnAtPercent ?? ''}
                onChange={(e) =>
                  set({
                    warnAtPercent: e.target.value
                      ? Math.min(100, Math.max(1, Number(e.target.value)))
                      : null,
                  })
                }
              />
              %
            </div>
          </Setting>
          <Setting label="Track pace" hint="Turn off for bills paid once a month">
            <Switch
              label="Track pace"
              checked={fields.trackPace}
              onChange={(trackPace) => set({ trackPace })}
            />
          </Setting>
        </>
      )}
      <Setting label="Color">
        <div className="row wrap" role="radiogroup" aria-label="Color">
          {CATEGORY_COLORS.map(([name, hex]) => (
            <button
              key={hex}
              type="button"
              role="radio"
              className="swatch"
              aria-label={name}
              aria-checked={fields.color.toLowerCase() === hex.toLowerCase()}
              style={{ background: hex }}
              onClick={() => set({ color: hex })}
            />
          ))}
        </div>
      </Setting>
      <div className="stack-sm">
        <span className="setting-label">
          Bank categories that land here
          <small>
            Transactions your bank files under these come here unless a rule says otherwise
          </small>
        </span>
        <div className="row wrap">
          {fields.providerCategories.map((code) => (
            <button
              key={code}
              type="button"
              className="chip"
              aria-label={`Remove ${bankCategoryLabel(code)}`}
              onClick={() =>
                set({ providerCategories: fields.providerCategories.filter((c) => c !== code) })
              }
            >
              {bankCategoryLabel(code)} ×
            </button>
          ))}
          <input
            className="input"
            style={{ width: 220 }}
            list="bank-categories"
            placeholder="Add a bank category"
            aria-label="Add a bank category"
            value={bankCode}
            onChange={(e) => setBankCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addBankCode()
              }
            }}
            onBlur={addBankCode}
          />
          <datalist id="bank-categories">
            {BANK_CATEGORIES.map((code) => (
              <option key={code} value={code}>
                {bankCategoryLabel(code)}
              </option>
            ))}
          </datalist>
        </div>
      </div>
      <ErrorNote error={error} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {onCancel && (
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Saving' : submitLabel}
        </button>
      </div>
    </form>
  )
}
