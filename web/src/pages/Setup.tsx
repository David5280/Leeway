import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactNode } from 'react'
import { auth, call, type Input, type Status } from '../api/client'
import { useAction, useActionMutation } from '../api/hooks'
import { useUpdateSettings } from '../api/settings'
import { BankButton, BankKeysMissing } from '../components/BankButton'
import { PeriodEditor, timeZones, type PeriodSetting } from '../components/PeriodEditor'
import { Dot, ErrorNote, Loading, Logo, Setting } from '../components/ui'
import { useApp } from '../lib/app'
import { parseMoney } from '../lib/format'

const STEPS = ['Your account', 'Budget period', 'Banks', 'Starting point', 'Done']

type StarterCategory = Input<'complete_setup'>['categories'] extends (infer C)[] | undefined
  ? C
  : never

function Frame({ step, children }: { step: number; children: ReactNode }) {
  return (
    <main className="setup">
      <aside className="stack">
        <div className="brand">
          <Logo />
          leeway
        </div>
        <ol className="steps" aria-label="Setup steps">
          {STEPS.map((name, i) => (
            <li
              key={name}
              className={i + 1 === step ? 'step current' : i + 1 < step ? 'step done' : 'step'}
              aria-current={i + 1 === step ? 'step' : undefined}
            >
              <span className="step-badge num">{i + 1 < step ? '✓' : i + 1}</span>
              {name}
            </li>
          ))}
        </ol>
      </aside>
      <section className="card stack" aria-label={STEPS[step - 1]}>
        <div className="eyebrow">
          Step {step} of {STEPS.length}
        </div>
        {children}
      </section>
    </main>
  )
}

function Nav({
  onBack,
  next,
  busy,
  disabled,
}: {
  onBack?: () => void
  next: string
  busy?: boolean
  disabled?: boolean
}) {
  return (
    <div className="row-between">
      {onBack ? (
        <button type="button" className="btn ghost" onClick={onBack}>
          Back
        </button>
      ) : (
        <span />
      )}
      <button type="submit" className="btn primary" disabled={busy || disabled}>
        {busy ? 'Saving' : next}
      </button>
    </div>
  )
}

/**
 * First run. Step 1 makes the owner account and signs in; the rest runs
 * signed in, saving as it goes, so a reload picks up where it left off.
 */
export function Setup({ status, startAt = 1 }: { status: Status; startAt?: 1 | 2 }) {
  if (startAt === 1) return <AccountStep />
  return <SignedInSetup status={status} />
}

function AccountStep() {
  const client = useQueryClient()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await auth.setup({ email, password, name: name.trim() || undefined })
      await client.invalidateQueries()
    } catch (caught) {
      setError(caught)
      setBusy(false)
    }
  }

  return (
    <Frame step={1}>
      <form className="stack" onSubmit={submit}>
        <h1>Create your account</h1>
        <p className="muted">
          This copy of Leeway is yours. Your bank data stays in your own database, and nobody else
          can sign in.
        </p>
        <label className="field">
          Name
          <input
            className="input"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          Email
          <input
            className="input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          Password, at least 10 characters
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <ErrorNote error={error} />
        <Nav next="Continue" busy={busy} />
      </form>
    </Frame>
  )
}

function SignedInSetup({ status }: { status: Status }) {
  const [step, setStep] = useState(2)
  const back = () => setStep((s) => s - 1)
  const next = () => setStep((s) => s + 1)
  if (step === 2) return <PeriodStep onNext={next} />
  if (step === 3) return <BanksStep status={status} onBack={back} onNext={next} />
  if (step === 4) return <StartStep onBack={back} onNext={next} />
  return <DoneStep status={status} />
}

function PeriodStep({ onNext }: { onNext: () => void }) {
  const { settings } = useApp()
  const zones = timeZones()
  const [period, setPeriod] = useState<PeriodSetting>(settings.period)
  const [timeZone, setTimeZone] = useState(
    settings.timeZone === 'UTC' ? zones.current : settings.timeZone,
  )
  const [warnAt, setWarnAt] = useState(settings.defaultWarnAtPercent)
  const update = useUpdateSettings()

  function submit(event: FormEvent) {
    event.preventDefault()
    update.mutate({ period, timeZone, defaultWarnAtPercent: warnAt }, { onSuccess: onNext })
  }

  return (
    <Frame step={2}>
      <form className="stack" onSubmit={submit}>
        <h1>How do you budget?</h1>
        <PeriodEditor value={period} onChange={setPeriod} />
        <Setting label="Time zone">
          <select
            className="input"
            aria-label="Time zone"
            value={timeZone}
            onChange={(e) => setTimeZone(e.target.value)}
          >
            {zones.all.map((zone) => (
              <option key={zone} value={zone}>
                {zone === zones.current ? `${zone} (from your browser)` : zone}
              </option>
            ))}
          </select>
        </Setting>
        <Setting label="Warn me at" hint="Share of a budget used">
          <div className="row">
            <input
              className="input num"
              style={{ width: 80 }}
              type="number"
              min={1}
              max={100}
              aria-label="Warn me at percent"
              value={warnAt}
              onChange={(e) => setWarnAt(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
            />
            %
          </div>
        </Setting>
        <p className="small muted">You can change all of this later in Customize.</p>
        <ErrorNote error={update.error} />
        <Nav next="Continue" busy={update.isPending} />
      </form>
    </Frame>
  )
}

function BanksStep({
  status,
  onBack,
  onNext,
}: {
  status: Status
  onBack: () => void
  onNext: () => void
}) {
  const connections = useAction('list_connections', undefined, { enabled: status.bank !== null })
  const linked = connections.data ?? []
  return (
    <Frame step={3}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          onNext()
        }}
      >
        <h1>Connect your banks</h1>
        {status.bank ? (
          <>
            <p className="muted">
              Plaid opens a secure window from your bank. Leeway only reads balances and
              transactions, and stores the access key encrypted.
            </p>
            {linked.map((c) => (
              <div key={c.id} className="list-row">
                <span className="grow">
                  <strong>{c.institutionName ?? 'Bank'}</strong>
                  <br />
                  <span className="small muted">
                    {c.accountCount} {c.accountCount === 1 ? 'account' : 'accounts'}
                  </span>
                </span>
                <span className="good small">Connected</span>
              </div>
            ))}
            <div>
              <BankButton
                label={linked.length ? 'Connect another bank' : 'Connect a bank'}
                className={linked.length ? 'btn' : 'btn primary'}
              />
            </div>
          </>
        ) : (
          <BankKeysMissing />
        )}
        <Nav onBack={onBack} next={linked.length ? 'Continue' : 'Skip for now'} />
      </form>
    </Frame>
  )
}

type Start = 'suggest' | 'starter' | 'empty' | 'import'

interface Row {
  category: StarterCategory
  include: boolean
  amount: string
  averageCents: number | null
}

type Edits = Record<string, Partial<Pick<Row, 'include' | 'amount'>>>

const toText = (cents: number | null | undefined) => (cents ? String(Math.round(cents / 100)) : '')

/** The starter categories, with spending-based amounts where there are some, and the owner's edits on top. */
export function starterRows(
  starters: StarterCategory[],
  suggestions: { name: string; averageMonthlyCents: number; suggestedMonthlyCents: number }[],
  edits: Edits,
): Row[] {
  const byName = new Map(suggestions.map((s) => [s.name, s]))
  return starters.map((category) => {
    const found = byName.get(category.name)
    return {
      category,
      include: edits[category.name]?.include ?? true,
      amount:
        edits[category.name]?.amount ??
        toText(found ? found.suggestedMonthlyCents : category.budgetCents),
      averageCents: found?.averageMonthlyCents ?? null,
    }
  })
}

function StartStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { money } = useApp()
  const connections = useAction('list_connections')
  const starters = useAction('get_starter_categories')
  const hasBank = (connections.data ?? []).some((c) => c.accountCount > 0)
  const [picked, setPicked] = useState<Start | null>(null)
  // Spending-based suggestions need a bank; without one, the starter set is the default.
  const start = picked ?? (connections.data ? (hasBank ? 'suggest' : 'starter') : null)
  const [edits, setEdits] = useState<Edits>({})
  const suggestions = useAction(
    'suggest_starter_budgets',
    { categories: starters.data ?? [] },
    { enabled: start === 'suggest' && starters.isSuccess },
  )
  const [imported, setImported] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const finish = useActionMutation('complete_setup')

  const listed = start === 'suggest' || start === 'starter'
  const ready = starters.isSuccess && (start !== 'suggest' || suggestions.isSuccess)
  const rows = ready
    ? starterRows(starters.data, start === 'suggest' ? suggestions.data! : [], edits)
    : []

  function choose(choice: Start) {
    setPicked(choice)
    setEdits({})
  }

  async function importFile(file: File) {
    setError(null)
    setBusy(true)
    try {
      const config = JSON.parse(await file.text()) as Input<'import_config'>['config']
      const result = await call('import_config', { config, mode: 'replace' })
      setImported(
        `Imported ${result.categoriesAdded} categories and ${result.rulesAdded} rules from ${file.name}.`,
      )
    } catch (caught) {
      setError(caught instanceof SyntaxError ? new Error('That file is not valid JSON.') : caught)
    } finally {
      setBusy(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const categories = listed
      ? rows
          .filter((r) => r.include)
          .map((r) => ({
            ...r.category,
            budgetCents: r.category.kind === 'expense' ? parseMoney(r.amount) : null,
            budgetCadence: 'month' as const,
          }))
      : []
    finish.mutate({ categories }, { onSuccess: onNext })
  }

  const choices: { id: Start; title: string; text: string; disabled?: boolean }[] = [
    {
      id: 'suggest',
      title: 'Suggest from my spending',
      text: hasBank ? 'Budgets from your last 3 months' : 'Connect a bank first',
      disabled: !hasBank,
    },
    { id: 'starter', title: 'Starter set', text: 'Everyday categories with typical amounts' },
    { id: 'empty', title: 'Start empty', text: 'Make your own categories later' },
    { id: 'import', title: 'Import leeway.json', text: 'Bring a setup from another Leeway' },
  ]

  const edit = (name: string, change: Edits[string]) =>
    setEdits((current) => ({ ...current, [name]: { ...current[name], ...change } }))

  return (
    <Frame step={4}>
      <form className="stack" onSubmit={submit}>
        <h1>Pick a starting point</h1>
        <div
          className="grid"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}
        >
          {choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              className="choice"
              aria-pressed={start === choice.id}
              disabled={choice.disabled}
              onClick={() => choose(choice.id)}
            >
              {choice.title}
              <span>{choice.text}</span>
            </button>
          ))}
        </div>

        {listed &&
          (!ready ? (
            <Loading />
          ) : (
            <div className="stack-sm" aria-label="Categories to create">
              <p className="small muted">
                Monthly amounts. Leave one blank for no budget; untick to skip it.
              </p>
              {rows.map((row) => (
                <div key={row.category.name} className="list-row">
                  <input
                    type="checkbox"
                    checked={row.include}
                    aria-label={`Include ${row.category.name}`}
                    onChange={(e) => edit(row.category.name, { include: e.target.checked })}
                  />
                  <Dot color={row.category.color} />
                  <span className="grow">
                    {row.category.name}
                    {row.averageCents !== null && (
                      <span className="small muted"> · you average {money(row.averageCents)}</span>
                    )}
                  </span>
                  {row.category.kind === 'expense' ? (
                    <input
                      className="input num"
                      style={{ width: 110 }}
                      inputMode="decimal"
                      placeholder="No budget"
                      aria-label={`${row.category.name} budget`}
                      value={row.amount}
                      disabled={!row.include}
                      onChange={(e) => edit(row.category.name, { amount: e.target.value })}
                    />
                  ) : (
                    <span className="small muted">
                      {row.category.kind === 'income' ? 'Income' : 'Transfers'}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}

        {start === 'import' && (
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
        )}
        {imported && <p className="notice">{imported}</p>}
        <ErrorNote error={error ?? suggestions.error ?? finish.error} />
        <Nav
          onBack={onBack}
          next="Continue"
          busy={finish.isPending}
          disabled={start === null || (start === 'import' && !imported) || busy}
        />
      </form>
    </Frame>
  )
}

function DoneStep({ status }: { status: Status }) {
  const client = useQueryClient()
  const create = useActionMutation('create_token')
  const address = `${status.publicUrl ?? window.location.origin}/mcp`
  return (
    <Frame step={5}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          void client.invalidateQueries({ queryKey: ['me'] })
        }}
      >
        <h1>You're set</h1>
        <p className="muted">
          Leeway syncs when your bank has news, and every 6 hours as a backup. One more optional
          thing:
        </p>
        <div className="card soft stack-sm">
          <strong>Let your AI assistant keep an eye on it</strong>
          <span className="small muted">
            Create a read-only key and add this address as a connector. Your assistant can then
            check budgets and warn you.
          </span>
          <code className="code">{address}</code>
          {create.data ? (
            <>
              <span className="small">Your key, shown only once. Copy it now:</span>
              <code className="code">{create.data.token}</code>
            </>
          ) : (
            <div>
              <button
                type="button"
                className="btn"
                disabled={create.isPending}
                onClick={() => create.mutate({ name: 'AI assistant', scope: 'read' })}
              >
                Create a key
              </button>
            </div>
          )}
          <ErrorNote error={create.error} />
        </div>
        <Nav next="Open my overview" />
      </form>
    </Frame>
  )
}
