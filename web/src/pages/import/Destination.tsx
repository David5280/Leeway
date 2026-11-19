// Step four of an import: which account the rows belong to, the choices that
// decide what is skipped, and the button that imports.

import type { Account } from '../../api/client'
import { ErrorNote } from '../../components/ui'
import { ACCOUNT_TYPES, type AccountType } from '../../lib/accounts'

/** Where the rows go: an existing account's id, or "new" for a new manual account. */
export interface Target {
  choice: string
  newName: string
  newType: AccountType
}

export interface ImportChoices {
  /** Of an export holding several accounts, the one to import; null for every row. */
  fileAccount: string | null
  keepRepeats: boolean
  skipBankDays: boolean
}

export const NEW_ACCOUNT = 'new'

export function Destination({
  accounts,
  target,
  onTarget,
  fileAccounts,
  choices,
  onChoices,
  repeats,
  ready,
  blocked,
  pending,
  error,
  onImport,
}: {
  accounts: Account[]
  target: Target
  onTarget: (target: Target) => void
  /** Accounts named in the file's account column, with their row counts. */
  fileAccounts: { name: string; rows: number }[]
  choices: ImportChoices
  onChoices: (choices: ImportChoices) => void
  /** Rows that repeat an earlier row exactly. */
  repeats: number
  /** Rows ready to import. */
  ready: number
  /** Why importing cannot go ahead yet, if it cannot. */
  blocked: string | null
  pending: boolean
  error: unknown
  onImport: () => void
}) {
  const chosen = accounts.find((account) => account.id === target.choice)
  const setChoice = (change: Partial<ImportChoices>) => onChoices({ ...choices, ...change })
  return (
    <section className="card stack" aria-labelledby="import-target-title">
      <h2 id="import-target-title">4. Import into an account</h2>
      {fileAccounts.length > 1 && (
        <label className="field">
          Rows from
          <select
            className="input"
            aria-label="Rows from"
            value={choices.fileAccount ?? ''}
            onChange={(e) => setChoice({ fileAccount: e.target.value || null })}
          >
            {fileAccounts.map(({ name, rows }) => (
              <option key={name} value={name}>
                {name || 'No account named'} ({rows.toLocaleString()})
              </option>
            ))}
            <option value="">Every account in the file</option>
          </select>
        </label>
      )}
      <label className="field">
        Leeway account
        <select
          className="input"
          aria-label="Leeway account"
          value={target.choice}
          onChange={(e) => onTarget({ ...target, choice: e.target.value })}
        >
          <option value="" disabled>
            Choose an account
          </option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
          <option value={NEW_ACCOUNT}>A new account</option>
        </select>
      </label>
      {target.choice === NEW_ACCOUNT && (
        <div className="row wrap">
          <label className="field grow">
            New account name
            <input
              className="input"
              maxLength={80}
              value={target.newName}
              onChange={(e) => onTarget({ ...target, newName: e.target.value })}
            />
          </label>
          <label className="field">
            Kind
            <select
              className="input"
              aria-label="Kind"
              value={target.newType}
              onChange={(e) => onTarget({ ...target, newType: e.target.value as AccountType })}
            >
              {ACCOUNT_TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {chosen && !chosen.manual && (
        <label className="row small">
          <input
            type="checkbox"
            checked={choices.skipBankDays}
            onChange={(e) => setChoice({ skipBankDays: e.target.checked })}
          />
          Skip rows from the day this account's bank history starts (the bank already sent those)
        </label>
      )}
      {repeats > 0 && (
        <label className="row small">
          <input
            type="checkbox"
            checked={choices.keepRepeats}
            onChange={(e) => setChoice({ keepRepeats: e.target.checked })}
          />
          Keep {repeats} {repeats === 1 ? 'row that repeats' : 'rows that repeat'} another exactly,
          such as two equal purchases on one day
        </label>
      )}
      <p className="small muted">
        Rows already in the account (same day, amount and description) are skipped, so importing a
        file twice adds nothing new. You can undo an import afterwards.
      </p>
      {blocked && <p className="notice small">{blocked}</p>}
      <div className="row">
        <button
          type="button"
          className="btn primary"
          disabled={Boolean(blocked) || pending}
          onClick={onImport}
        >
          {pending
            ? 'Importing'
            : `Import ${ready.toLocaleString()} ${ready === 1 ? 'transaction' : 'transactions'}`}
        </button>
      </div>
      <ErrorNote error={error} />
    </section>
  )
}
