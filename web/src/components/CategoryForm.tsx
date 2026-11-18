// The form for adding or changing a category.

import { useState, type FormEvent } from 'react'
import type { Category, Input } from '../api/client'
import { useApp } from '../lib/app'
import { parseMoney } from '../lib/format'
import { CATEGORY_COLORS } from '../lib/theme'
import { ColorPicker } from './ColorPicker'
import { PercentInput } from './PercentInput'
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

/**
 * Plaid's top-level categories and the detailed ones people reach for most.
 * Any other detailed code (see Plaid's taxonomy) can be typed in.
 */
export const BANK_CATEGORIES = [
  'FOOD_AND_DRINK',
  'FOOD_AND_DRINK_GROCERIES',
  'FOOD_AND_DRINK_RESTAURANT',
  'FOOD_AND_DRINK_FAST_FOOD',
  'FOOD_AND_DRINK_COFFEE',
  'FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR',
  'GENERAL_MERCHANDISE',
  'GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES',
  'GENERAL_SERVICES',
  'ENTERTAINMENT',
  'TRANSPORTATION',
  'TRAVEL',
  'RENT_AND_UTILITIES',
  'HOME_IMPROVEMENT',
  'MEDICAL',
  'PERSONAL_CARE',
  'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS',
  'GOVERNMENT_AND_NON_PROFIT',
  'BANK_FEES',
  'LOAN_PAYMENTS',
  'LOAN_PAYMENTS_CAR_PAYMENT',
  'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
  'INCOME',
  'TRANSFER_IN',
  'TRANSFER_OUT',
]

export const bankCategoryLabel = (code: string) => {
  const text = code.toLowerCase().replaceAll('_', ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** What a brand new category starts with. */
const NEW_CATEGORY: CategoryFields = {
  name: '',
  color: CATEGORY_COLORS[0][1],
  kind: 'expense',
  budgetCents: null,
  budgetCadence: 'month',
  warnAtPercent: null,
  trackPace: true,
  providerCategories: [],
  group: null,
}

/** The editable fields of a category, or the defaults for a new one. */
export function fieldsOf(category?: Category): CategoryFields {
  if (!category) return { ...NEW_CATEGORY, providerCategories: [] }
  const { name, color, kind, budgetCents, budgetCadence, warnAtPercent, trackPace, group } =
    category
  return {
    name,
    group,
    color,
    kind,
    budgetCents,
    budgetCadence,
    warnAtPercent,
    trackPace,
    providerCategories: [...category.providerCategories],
  }
}

/** Everything about a category in one form: used to add one and to change one. */
export function CategoryForm({
  category,
  groups = [],
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  category?: Category
  /** Group names already in use, offered while typing one. */
  groups?: string[]
  submitLabel: string
  busy: boolean
  error: unknown
  onSubmit: (fields: CategoryFields) => void
  onCancel?: () => void
}) {
  const { settings } = useApp()
  const [fields, setFields] = useState(() => fieldsOf(category))
  const [amount, setAmount] = useState(
    // A $0 budget is a real budget, so only null means none.
    category && category.budgetCents !== null ? String(category.budgetCents / 100) : '',
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
      <label className="field">
        Group
        <input
          className="input"
          maxLength={40}
          list="category-groups"
          placeholder="None, like Food and drink"
          value={fields.group ?? ''}
          // A blank group means none, so the category is listed on its own.
          onChange={(e) => set({ group: e.target.value.trim() ? e.target.value : null })}
        />
        <datalist id="category-groups">
          {groups.map((group) => (
            <option key={group} value={group} />
          ))}
        </datalist>
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
              <PercentInput
                label="Warn at percent"
                placeholder={String(settings.defaultWarnAtPercent)}
                value={fields.warnAtPercent}
                optional
                onChange={(warnAtPercent) => set({ warnAtPercent })}
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
        <ColorPicker value={fields.color} onChange={(color) => set({ color })} />
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
