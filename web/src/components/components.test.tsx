import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import type { PlaidLinkOnExitMetadata, PlaidLinkOptions } from 'react-plaid-link'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Rule, Transaction } from '../api/client'
import { category, fakeServer, renderSignedIn, transaction } from '../test/fake'
import { BankButton, BankKeysMissing } from './BankButton'
import { bankCategoryLabel, CategoryForm, fieldsOf } from './CategoryForm'
import { CategorySelect } from './CategorySelect'
import { defaultPeriod, PeriodEditor, timeZones, type PeriodSetting } from './PeriodEditor'
import { RuleBuilder } from './rules/RuleBuilder'
import { RulesList } from './rules/RulesList'

// Plaid's window is a third-party script; the fake hands back whatever the button gave it.
const plaid = vi.hoisted(() => ({ open: vi.fn(), options: null as PlaidLinkOptions | null }))

vi.mock('react-plaid-link', () => ({
  usePlaidLink: (options: PlaidLinkOptions) => {
    plaid.options = options
    return { open: plaid.open, ready: true }
  },
}))

afterEach(() => vi.unstubAllGlobals())

const groceries = category('Groceries', { budgetCents: 60000, color: '#2E9E3A' })
const dining = category('Dining out', { budgetCents: 20000 })
const categories = [groceries, dining]

/** An action that answers with an error, as the real server does. */
function failing(name: string, message: string, status = 400) {
  return {
    [`/api/actions/${name}`]: () => Response.json({ error: 'bad_request', message }, { status }),
  }
}

/**
 * Holds back one action's reply until the returned function is called, so the
 * busy state while it runs can be seen. Call after fakeServer.
 */
function holdAction(name: string): () => void {
  const reply = globalThis.fetch
  let release = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  vi.stubGlobal('fetch', async (path: string, init?: RequestInit) => {
    if (path === `/api/actions/${name}`) await gate
    return reply(path, init)
  })
  return release
}

describe('BankButton', () => {
  const connectionId = '5f0c2a8e-1b7d-4c5e-9a3f-2d6b8e4c1a70'
  const synced = {
    connectionId,
    institutionName: 'Chase',
    added: 12,
    modified: 0,
    removed: 0,
    error: null,
  }

  beforeEach(() => {
    plaid.open.mockClear()
    plaid.options = null
  })

  function plaidSucceeds(publicToken: string | null) {
    const metadata = { institution: null, accounts: [], link_session_id: 'session' }
    act(() => plaid.options!.onSuccess(publicToken, metadata))
  }

  function plaidExits() {
    const metadata: PlaidLinkOnExitMetadata = {
      institution: null,
      status: null,
      link_session_id: 'session',
      request_id: 'request',
    }
    act(() => plaid.options!.onExit!(null, metadata))
  }

  it('connects a bank with the token Plaid hands back', async () => {
    const server = fakeServer({
      create_link_token: () => ({ linkToken: 'link-token-1' }),
      link_bank: () => synced,
    })
    const onDone = vi.fn()
    renderSignedIn(<BankButton onDone={onDone} />)
    const button = screen.getByRole('button', { name: 'Connect a bank' })
    await userEvent.setup().click(button)

    await waitFor(() => expect(plaid.open).toHaveBeenCalledTimes(1))
    expect(plaid.options?.token).toBe('link-token-1')
    expect(server.actions('create_link_token')).toEqual([{}])
    // The button waits while Plaid's window is open.
    expect(button).toBeDisabled()

    plaidSucceeds('public-abc')
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(server.actions('link_bank')).toEqual([{ publicToken: 'public-abc' }])
    expect(server.actions('bank_reconnected')).toEqual([])
    expect(screen.getByRole('button', { name: 'Connect a bank' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says it is pulling in accounts while the bank is saved', async () => {
    fakeServer({
      create_link_token: () => ({ linkToken: 'link-token-1' }),
      link_bank: () => synced,
    })
    const release = holdAction('link_bank')
    renderSignedIn(<BankButton />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Connect a bank' }))
    await waitFor(() => expect(plaid.open).toHaveBeenCalled())

    plaidSucceeds('public-abc')
    expect(await screen.findByRole('button', { name: 'Pulling in your accounts' })).toBeDisabled()
    release()
    expect(await screen.findByRole('button', { name: 'Connect a bank' })).toBeEnabled()
  })

  it('repairs a bank login instead of linking a new bank', async () => {
    const server = fakeServer({
      create_link_token: () => ({ linkToken: 'repair-token' }),
      bank_reconnected: () => synced,
    })
    const onDone = vi.fn()
    renderSignedIn(<BankButton connectionId={connectionId} label="Log in again" onDone={onDone} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Log in again' }))
    await waitFor(() => expect(plaid.open).toHaveBeenCalled())
    expect(server.actions('create_link_token')).toEqual([{ connectionId }])
    expect(plaid.options?.token).toBe('repair-token')

    plaidSucceeds('public-abc')
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(server.actions('bank_reconnected')).toEqual([{ connectionId }])
    expect(server.actions('link_bank')).toEqual([])
  })

  it('does nothing more when the window is closed without linking', async () => {
    const server = fakeServer({ create_link_token: () => ({ linkToken: 'link-token-1' }) })
    const onDone = vi.fn()
    renderSignedIn(<BankButton onDone={onDone} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Connect a bank' }))
    await waitFor(() => expect(plaid.open).toHaveBeenCalled())

    plaidExits()
    const button = screen.getByRole('button', { name: 'Connect a bank' })
    expect(button).toBeEnabled()
    expect(server.actions('link_bank')).toEqual([])
    expect(onDone).not.toHaveBeenCalled()

    // Trying again asks for a fresh token.
    await user.click(button)
    await waitFor(() => expect(plaid.open).toHaveBeenCalledTimes(2))
    expect(server.actions('create_link_token')).toHaveLength(2)
  })

  it('ignores a success that carries no public token', async () => {
    const server = fakeServer({ create_link_token: () => ({ linkToken: 'link-token-1' }) })
    renderSignedIn(<BankButton />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Connect a bank' }))
    await waitFor(() => expect(plaid.open).toHaveBeenCalled())
    plaidSucceeds(null)
    await act(() => Promise.resolve())
    expect(server.actions('link_bank')).toEqual([])
    // The window is done, so the button is free to try again.
    expect(screen.getByRole('button', { name: 'Connect a bank' })).toBeEnabled()
  })

  it('is busy while it fetches a token', async () => {
    fakeServer({ create_link_token: () => ({ linkToken: 'link-token-1' }) })
    const release = holdAction('create_link_token')
    renderSignedIn(<BankButton />)
    const button = screen.getByRole('button', { name: 'Connect a bank' })
    await userEvent.setup().click(button)
    expect(button).toBeDisabled()
    expect(plaid.open).not.toHaveBeenCalled()
    release()
    await waitFor(() => expect(plaid.open).toHaveBeenCalled())
  })

  it('shows why it could not start, and clears that on a new try', async () => {
    let tries = 0
    fakeServer(
      {},
      {
        '/api/actions/create_link_token': () =>
          ++tries === 1
            ? Response.json(
                { error: 'bank_not_configured', message: 'Bank sync is not set up.' },
                { status: 400 },
              )
            : Response.json({ result: { linkToken: 'link-token-2' } }),
      },
    )
    renderSignedIn(<BankButton />)
    const user = userEvent.setup()
    const button = screen.getByRole('button', { name: 'Connect a bank' })
    await user.click(button)

    expect(await screen.findByRole('alert')).toHaveTextContent('Bank sync is not set up.')
    expect(button).toBeEnabled()
    expect(plaid.open).not.toHaveBeenCalled()

    await user.click(button)
    await waitFor(() => expect(plaid.open).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows why linking failed and does not report it done', async () => {
    fakeServer(
      { create_link_token: () => ({ linkToken: 'link-token-1' }) },
      failing('link_bank', 'The bank did not answer.', 502),
    )
    const onDone = vi.fn()
    renderSignedIn(<BankButton onDone={onDone} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Connect a bank' }))
    await waitFor(() => expect(plaid.open).toHaveBeenCalled())

    plaidSucceeds('public-abc')
    expect(await screen.findByRole('alert')).toHaveTextContent('The bank did not answer.')
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Connect a bank' })).toBeEnabled()
  })

  it('explains which keys to set when the server has none', () => {
    render(<BankKeysMissing />)
    expect(screen.getByText('Bank sync is not set up on this server yet.')).toBeInTheDocument()
    expect(screen.getByText('PLAID_CLIENT_ID')).toBeInTheDocument()
    expect(screen.getByText('PLAID_SECRET')).toBeInTheDocument()
  })
})

describe('CategoryForm', () => {
  function renderForm(props: Partial<ComponentProps<typeof CategoryForm>> = {}) {
    const onSubmit = vi.fn()
    renderSignedIn(
      <CategoryForm
        submitLabel="Add category"
        busy={false}
        error={null}
        onSubmit={onSubmit}
        {...props}
      />,
    )
    return { onSubmit, user: userEvent.setup() }
  }

  const save = (user: ReturnType<typeof userEvent.setup>, name = 'Add category') =>
    user.click(screen.getByRole('button', { name }))

  it('starts a new category with sensible defaults', async () => {
    const { onSubmit, user } = renderForm()
    expect(screen.getByRole('form', { name: 'New category' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Spending' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Budget amount')).toHaveValue('')
    expect(screen.getByLabelText('Budget cadence')).toHaveValue('month')
    expect(screen.getByLabelText('Warn at percent')).toHaveAttribute('placeholder', '80')
    expect(screen.getByText('Blank uses your default, 80%')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Track pace' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Blue' })).toBeChecked()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Name'), 'Rent')
    await save(user)
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Rent',
      color: '#3987E5',
      kind: 'expense',
      budgetCents: null,
      budgetCadence: 'month',
      warnAtPercent: null,
      trackPace: true,
      providerCategories: [],
      group: null,
    })
  })

  it('sends every field the owner filled in', async () => {
    const { onSubmit, user } = renderForm()
    await user.type(screen.getByLabelText('Name'), 'Coffee')
    await user.type(screen.getByLabelText('Group'), 'Food and drink')
    await user.type(screen.getByLabelText('Budget amount'), '$1,200.50')
    await user.selectOptions(screen.getByLabelText('Budget cadence'), 'a week')
    await user.type(screen.getByLabelText('Warn at percent'), '90')
    await user.click(screen.getByRole('switch', { name: 'Track pace' }))
    await user.click(screen.getByRole('radio', { name: 'Orange' }))
    await user.type(screen.getByLabelText('Add a bank category'), 'food and drink coffee{Enter}')
    await save(user)

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Coffee',
      color: '#E0622D',
      kind: 'expense',
      budgetCents: 120050,
      budgetCadence: 'week',
      warnAtPercent: 90,
      trackPace: false,
      providerCategories: ['FOOD_AND_DRINK_COFFEE'],
      group: 'Food and drink',
    })
    expect(screen.getByRole('radio', { name: 'Orange' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Blue' })).not.toBeChecked()
  })

  it('offers the groups already in use, and sends a cleared group as none', async () => {
    const { onSubmit, user } = renderForm({
      category: category('Coffee', { group: 'Food and drink' }),
      groups: ['Food and drink', 'Home'],
    })
    const group = screen.getByLabelText('Group')
    expect(group).toHaveValue('Food and drink')
    const suggestions = document.querySelectorAll('#category-groups option')
    expect([...suggestions].map((option) => option.getAttribute('value'))).toEqual([
      'Food and drink',
      'Home',
    ])

    await user.clear(group)
    await user.type(group, '   ')
    await save(user)

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ group: null }))
  })

  it('does not send a category without a name', async () => {
    const { onSubmit, user } = renderForm()
    await save(user)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('treats a budget that is not a number as no budget', async () => {
    const { onSubmit, user } = renderForm()
    await user.type(screen.getByLabelText('Name'), 'Fun')
    await user.type(screen.getByLabelText('Budget amount'), 'lots')
    await save(user)
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ budgetCents: null }))
  })

  it('asks what is expected for income, with no warning or pace', async () => {
    const { onSubmit, user } = renderForm()
    await user.type(screen.getByLabelText('Name'), 'Paycheck')
    await user.click(screen.getByRole('button', { name: 'Income' }))
    expect(screen.getByText('Expected')).toBeInTheDocument()
    expect(screen.queryByText('Budget')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Warn at percent')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Track pace' })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Budget amount'), '5000')
    await save(user)
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'income', budgetCents: 500000 }),
    )
  })

  it('never sends a budget for a transfer, even one typed earlier', async () => {
    const { onSubmit, user } = renderForm()
    await user.type(screen.getByLabelText('Name'), 'Savings')
    await user.type(screen.getByLabelText('Budget amount'), '50')
    await user.click(screen.getByRole('button', { name: 'Transfer' }))
    expect(screen.queryByLabelText('Budget amount')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Warn at percent')).not.toBeInTheDocument()
    await save(user)
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'transfer', budgetCents: null }),
    )

    // The typed amount comes back if it turns out not to be a transfer.
    await user.click(screen.getByRole('button', { name: 'Spending' }))
    expect(screen.getByLabelText('Budget amount')).toHaveValue('50')
  })

  it('sends no warning level once the box is emptied, and caps one above 100', async () => {
    const { onSubmit, user } = renderForm({
      category: category('Fun', { warnAtPercent: 90 }),
      submitLabel: 'Save',
    })
    const warn = screen.getByLabelText('Warn at percent')
    expect(warn).toHaveValue(90)
    await user.clear(warn)
    await save(user, 'Save')
    expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ warnAtPercent: null }))

    await user.type(warn, '150')
    await save(user, 'Save')
    expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ warnAtPercent: 100 }))
  })

  it('adds bank categories once each and lets them be removed', async () => {
    const { onSubmit, user } = renderForm()
    const input = screen.getByLabelText('Add a bank category')
    await user.type(input, '  travel {Enter}')
    await user.type(input, 'TRAVEL{Enter}')
    await user.type(input, '   {Enter}')
    // Leaving the box adds what was typed, too.
    await user.type(input, 'bank fees')
    await user.tab()

    expect(screen.getByRole('button', { name: 'Remove Travel' })).toHaveTextContent('Travel ×')
    expect(screen.getAllByRole('button', { name: /^Remove/ })).toHaveLength(2)
    expect(input).toHaveValue('')

    await user.click(screen.getByRole('button', { name: 'Remove Travel' }))
    await user.type(screen.getByLabelText('Name'), 'Fees')
    await save(user)
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ providerCategories: ['BANK_FEES'] }),
    )
  })

  it('does not send the form when Enter adds a bank category', async () => {
    const { onSubmit, user } = renderForm()
    await user.type(screen.getByLabelText('Name'), 'Travel')
    await user.type(screen.getByLabelText('Add a bank category'), 'travel{Enter}')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('fills in an existing category and sends it back unchanged', async () => {
    const existing = category('Groceries', {
      budgetCents: 60050,
      budgetCadence: 'week',
      warnAtPercent: 90,
      trackPace: false,
      color: '#2e9e3a',
      providerCategories: ['FOOD_AND_DRINK_GROCERIES'],
    })
    const { onSubmit, user } = renderForm({ category: existing, submitLabel: 'Save' })
    expect(screen.getByRole('form', { name: 'Category settings' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Groceries')
    expect(screen.getByLabelText('Budget amount')).toHaveValue('600.5')
    expect(screen.getByLabelText('Budget cadence')).toHaveValue('week')
    expect(screen.getByRole('switch', { name: 'Track pace' })).not.toBeChecked()
    // Colors match whatever their case.
    expect(screen.getByRole('radio', { name: 'Green' })).toBeChecked()
    expect(
      screen.getByRole('button', { name: 'Remove Food and drink groceries' }),
    ).toBeInTheDocument()

    await save(user, 'Save')
    expect(onSubmit).toHaveBeenCalledWith({ ...fieldsOf(existing), budgetCents: 60050 })
  })

  it('leaves the category it was given untouched', async () => {
    const existing = category('Groceries', { providerCategories: ['FOOD_AND_DRINK_GROCERIES'] })
    const { user } = renderForm({ category: existing, submitLabel: 'Save' })
    await user.click(screen.getByRole('button', { name: 'Remove Food and drink groceries' }))
    await user.type(screen.getByLabelText('Add a bank category'), 'travel{Enter}')
    expect(existing.providerCategories).toEqual(['FOOD_AND_DRINK_GROCERIES'])
  })

  it('keeps a zero budget when an existing category is saved', async () => {
    const { onSubmit, user } = renderForm({
      category: category('Treats', { budgetCents: 0 }),
      submitLabel: 'Save',
    })
    expect(screen.getByLabelText('Budget amount')).toHaveValue('0')
    await save(user, 'Save')
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ budgetCents: 0 }))
  })

  it('keeps a custom color that is not one of the swatches', async () => {
    const { onSubmit, user } = renderForm({
      category: category('Odd', { color: '#123456' }),
      submitLabel: 'Save',
    })
    const swatches = within(screen.getByRole('radiogroup', { name: 'Color' })).getAllByRole('radio')
    expect(swatches.every((swatch) => swatch.getAttribute('aria-checked') === 'false')).toBe(true)
    await save(user, 'Save')
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ color: '#123456' }))
  })

  it('shows saving, errors and a cancel button when asked', async () => {
    const onCancel = vi.fn()
    const { user } = renderForm({
      busy: true,
      error: new Error('That name is taken.'),
      onCancel,
    })
    expect(screen.getByRole('button', { name: 'Saving' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('That name is taken.')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('gives each new form its own list of bank categories', () => {
    const first = fieldsOf()
    first.providerCategories.push('TRAVEL')
    expect(fieldsOf().providerCategories).toEqual([])
  })

  it('labels bank category codes in plain words', () => {
    expect(bankCategoryLabel('FOOD_AND_DRINK')).toBe('Food and drink')
    expect(bankCategoryLabel('TRANSFER_IN')).toBe('Transfer in')
    expect(bankCategoryLabel('')).toBe('')
  })
})

describe('CategorySelect', () => {
  it('asks to pick a category when none is chosen and nothing is allowed', async () => {
    const onChange = vi.fn()
    render(
      <CategorySelect categories={categories} value={null} onChange={onChange} label="Category" />,
    )
    const select = screen.getByRole('combobox', { name: 'Category' })
    expect(select).toHaveDisplayValue('Pick a category')
    expect(screen.getByRole('option', { name: 'Pick a category' })).toBeDisabled()
    await userEvent.setup().selectOptions(select, 'Dining out')
    expect(onChange).toHaveBeenCalledWith(dining.id)
  })

  it('has no placeholder once a category is chosen', () => {
    render(
      <CategorySelect
        categories={categories}
        value={groceries.id}
        onChange={vi.fn()}
        label="Category"
      />,
    )
    expect(screen.getByRole('combobox')).toHaveDisplayValue('Groceries')
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Groceries',
      'Dining out',
    ])
  })

  it('lets nothing be chosen with the empty label, sent as null', async () => {
    const onChange = vi.fn()
    render(
      <CategorySelect
        categories={categories}
        value={groceries.id}
        onChange={onChange}
        label="Category"
        emptyLabel="Uncategorized"
      />,
    )
    expect(screen.queryByRole('option', { name: 'Pick a category' })).not.toBeInTheDocument()
    await userEvent.setup().selectOptions(screen.getByRole('combobox'), 'Uncategorized')
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('shows the empty label when nothing is chosen', () => {
    render(
      <CategorySelect
        categories={categories}
        value={null}
        onChange={vi.fn()}
        label="Category"
        emptyLabel="Any category"
      />,
    )
    expect(screen.getByRole('combobox')).toHaveDisplayValue('Any category')
  })

  it('can be disabled', () => {
    render(
      <CategorySelect categories={[]} value={null} onChange={vi.fn()} label="Category" disabled />,
    )
    expect(screen.getByRole('combobox', { name: 'Category' })).toBeDisabled()
  })
})

describe('PeriodEditor', () => {
  const monthly: PeriodSetting = { kind: 'monthly', startDay: 1 }
  const weekly: PeriodSetting = { kind: 'weekly', weekStartsOn: 1 }
  const biweekly: PeriodSetting = {
    kind: 'paycheck',
    frequency: 'biweekly',
    anchorDate: '2026-11-06',
    semimonthlyDays: [1, 15],
  }
  const semimonthly: PeriodSetting = { ...biweekly, frequency: 'semimonthly' }

  afterEach(() => vi.useRealTimers())

  function renderEditor(value: PeriodSetting) {
    const onChange = vi.fn()
    render(<PeriodEditor value={value} onChange={onChange} />)
    return { onChange, user: userEvent.setup() }
  }

  it('picks the day a month starts on, from 1 to 28', async () => {
    const { onChange, user } = renderEditor(monthly)
    expect(screen.getByRole('button', { name: 'Monthly' })).toHaveAttribute('aria-pressed', 'true')
    const select = screen.getByLabelText('Month starts on day')
    expect(within(select).getAllByRole('option')).toHaveLength(28)
    expect(within(select).getAllByRole('option').at(-1)).toHaveTextContent('28')
    await user.selectOptions(select, '15')
    expect(onChange).toHaveBeenCalledWith({ kind: 'monthly', startDay: 15 })
  })

  it('picks the day a week starts on', async () => {
    const { onChange, user } = renderEditor(weekly)
    const select = screen.getByLabelText('Week starts on')
    expect(select).toHaveDisplayValue('Monday')
    await user.selectOptions(select, 'Sunday')
    expect(onChange).toHaveBeenCalledWith({ kind: 'weekly', weekStartsOn: 0 })
    expect(screen.queryByLabelText('Month starts on day')).not.toBeInTheDocument()
  })

  it('starts each kind from a full default when switching', async () => {
    // Only the clock is faked, so typing and clicking still run normally.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 17, 23, 30))
    const { onChange, user } = renderEditor(monthly)
    await user.click(screen.getByRole('button', { name: 'Weekly' }))
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'weekly', weekStartsOn: 1 })
    await user.click(screen.getByRole('button', { name: 'Every paycheck' }))
    // Late in the evening it is still the 17th where the owner is.
    expect(onChange).toHaveBeenLastCalledWith({
      kind: 'paycheck',
      frequency: 'biweekly',
      anchorDate: '2026-11-17',
      semimonthlyDays: [1, 15],
    })
  })

  it('does nothing when the chosen kind is picked again', async () => {
    const { onChange, user } = renderEditor(weekly)
    await user.click(screen.getByRole('button', { name: 'Weekly' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('asks how often pay comes and for a recent payday', async () => {
    const { onChange, user } = renderEditor(biweekly)
    expect(screen.getByLabelText('How often you are paid')).toHaveDisplayValue('Every 2 weeks')
    const payday = screen.getByLabelText('A recent payday')
    expect(payday).toHaveValue('2026-11-06')
    expect(screen.queryByLabelText('First payday')).not.toBeInTheDocument()

    fireEvent.change(payday, { target: { value: '2026-11-13' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...biweekly, anchorDate: '2026-11-13' })

    await user.selectOptions(screen.getByLabelText('How often you are paid'), 'Twice a month')
    expect(onChange).toHaveBeenLastCalledWith({ ...biweekly, frequency: 'semimonthly' })
  })

  it('ignores a cleared payday', () => {
    const { onChange } = renderEditor(biweekly)
    fireEvent.change(screen.getByLabelText('A recent payday'), { target: { value: '' } })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('asks for two paydays when paid twice a month, kept between 1 and 31', () => {
    const { onChange } = renderEditor(semimonthly)
    expect(screen.queryByLabelText('A recent payday')).not.toBeInTheDocument()
    const first = screen.getByLabelText('First payday')
    const second = screen.getByLabelText('Second payday')
    expect(first).toHaveValue(1)
    expect(second).toHaveValue(15)

    const sent = (input: HTMLElement, value: string) => {
      fireEvent.change(input, { target: { value } })
      return onChange.mock.lastCall?.[0]
    }
    expect(sent(second, '31')).toEqual({ ...semimonthly, semimonthlyDays: [1, 31] })
    expect(sent(second, '45')).toEqual({ ...semimonthly, semimonthlyDays: [1, 31] })
    expect(sent(first, '0')).toEqual({ ...semimonthly, semimonthlyDays: [1, 15] })
    expect(sent(first, '7.6')).toEqual({ ...semimonthly, semimonthlyDays: [8, 15] })
    expect(sent(first, '-3')).toEqual({ ...semimonthly, semimonthlyDays: [1, 15] })
    // The setting passed in is never changed in place.
    expect(semimonthly.kind === 'paycheck' && semimonthly.semimonthlyDays).toEqual([1, 15])
  })

  it('gives a complete default for every kind', () => {
    expect(defaultPeriod('monthly', '2026-11-17')).toEqual({ kind: 'monthly', startDay: 1 })
    expect(defaultPeriod('weekly', '2026-11-17')).toEqual({ kind: 'weekly', weekStartsOn: 1 })
    expect(defaultPeriod('paycheck', '2026-11-17')).toEqual({
      kind: 'paycheck',
      frequency: 'biweekly',
      anchorDate: '2026-11-17',
      semimonthlyDays: [1, 15],
    })
  })
})

describe('timeZones', () => {
  /** An Intl whose own time zone and known zones are fixed for the test. */
  function stubIntl(timeZone: string, supported?: string[]) {
    vi.stubGlobal('Intl', {
      DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone }) }),
      ...(supported && { supportedValuesOf: () => supported }),
    })
  }

  it('lists every zone the browser knows, with its own included', () => {
    stubIntl('America/Denver', ['America/Denver', 'Europe/Paris'])
    expect(timeZones()).toEqual({
      current: 'America/Denver',
      all: ['America/Denver', 'Europe/Paris'],
    })
  })

  it('puts the browser zone first when the list lacks it', () => {
    stubIntl('Etc/Unknown', ['America/Denver', 'Europe/Paris'])
    expect(timeZones().all).toEqual(['Etc/Unknown', 'America/Denver', 'Europe/Paris'])
  })

  it('falls back to its own zone and UTC in older browsers', () => {
    stubIntl('Asia/Tokyo')
    expect(timeZones()).toEqual({ current: 'Asia/Tokyo', all: ['Asia/Tokyo', 'UTC'] })
  })

  it('uses UTC when the browser reports no zone', () => {
    stubIntl('')
    expect(timeZones().current).toBe('UTC')
  })
})

describe('RuleBuilder', () => {
  const costco = transaction({
    id: 't1',
    date: '2026-11-17',
    name: 'COSTCO #12',
    merchantName: 'Costco',
    amountCents: 8450,
  })
  const examples: Transaction[] = [
    costco,
    transaction({ id: 't2', date: '2026-11-16', name: 'SWEET COW', amountCents: 900 }),
    transaction({ id: 't3', date: '2026-11-15', name: 'Refund', amountCents: -1200 }),
    transaction({ id: 't4', date: '2026-11-14', name: 'Fourth', amountCents: 100 }),
  ]

  function preview(fields: Partial<Record<string, unknown>> = {}) {
    return {
      matchCount: 3,
      examples,
      wouldMove: 2,
      movingFrom: [{ categoryId: null, count: 2 }],
      ...fields,
    }
  }

  function serve(previewResult = preview()) {
    return fakeServer({
      preview_rule: () => previewResult,
      create_rule: (input) => ({ rule: { id: 'r1', position: 0, ...input }, recategorized: 2 }),
    })
  }

  function renderBuilder(initial: Partial<ComponentProps<typeof RuleBuilder>['initial']> = {}) {
    const onClose = vi.fn()
    renderSignedIn(
      <RuleBuilder
        initial={{
          field: 'merchant',
          matchType: 'contains',
          pattern: '',
          categoryId: null,
          ...initial,
        }}
        categories={categories}
        onClose={onClose}
      />,
    )
    return {
      onClose,
      user: userEvent.setup(),
      form: screen.getByRole('form', { name: 'New rule' }),
    }
  }

  const saveButton = () => screen.getByRole('button', { name: 'Save rule and apply' })

  it('names the transaction it was made from', () => {
    serve()
    renderBuilder({ pattern: 'Costco' })
    expect(screen.getByRole('heading', { name: 'New rule from "Costco"' })).toBeInTheDocument()
    expect(screen.getByLabelText('Text to match')).toHaveValue('Costco')
  })

  it('saves a rule once a category is picked, then closes', async () => {
    const server = serve()
    const { onClose, user } = renderBuilder()
    expect(screen.getByRole('heading', { name: 'New rule' })).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'description' }))
    await user.selectOptions(screen.getByLabelText('How it matches'), 'is exactly')
    await user.type(screen.getByLabelText('Text to match'), '  Trader Joe  ')
    await user.selectOptions(screen.getByLabelText('Category for matches'), 'Groceries')
    await user.click(saveButton())

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(server.actions('create_rule')).toEqual([
      {
        field: 'description',
        matchType: 'equals',
        pattern: 'Trader Joe',
        categoryId: groceries.id,
        minAmountCents: null,
        maxAmountCents: null,
      },
    ])
  })

  it('limits a rule by amount when asked', async () => {
    const server = serve()
    const { user } = renderBuilder({ pattern: 'Costco', categoryId: groceries.id })
    expect(screen.queryByLabelText('Smallest amount')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Limit by amount' }))
    await user.type(screen.getByLabelText('Smallest amount'), '$10')
    await user.type(screen.getByLabelText('Largest amount'), '1,000')

    await waitFor(() =>
      expect(server.actions('preview_rule').at(-1)).toMatchObject({
        minAmountCents: 1000,
        maxAmountCents: 100000,
      }),
    )
    await user.click(saveButton())
    await waitFor(() =>
      expect(server.actions('create_rule')).toEqual([
        expect.objectContaining({ minAmountCents: 1000, maxAmountCents: 100000 }),
      ]),
    )
  })

  it('shows amount limits from the start when the draft has them', () => {
    serve()
    renderBuilder({ pattern: 'Costco', minAmount: '5' })
    expect(screen.getByLabelText('Smallest amount')).toHaveValue('5')
    expect(screen.getByLabelText('Largest amount')).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Limit by amount' })).not.toBeInTheDocument()
  })

  it('previews what the rule would catch and move', async () => {
    const server = serve()
    const { form } = renderBuilder({ pattern: 'Costco', categoryId: groceries.id })
    const notice = await within(form).findByText(/^Matches/)
    expect(notice).toHaveTextContent(
      'Matches 3 recent transactions. 2 would move to Groceries from uncategorized.',
    )
    // Three examples at most, with refunds shown as plain amounts.
    expect(notice).toHaveTextContent(
      'For example: Costco ($84.50), SWEET COW ($9.00), Refund ($12.00).',
    )
    expect(notice).not.toHaveTextContent('Fourth')
    expect(server.actions('preview_rule')).toEqual([
      {
        field: 'merchant',
        matchType: 'contains',
        pattern: 'Costco',
        categoryId: groceries.id,
        minAmountCents: null,
        maxAmountCents: null,
      },
    ])
  })

  it.each([
    [[{ categoryId: dining.id, count: 2 }], 'from Dining out.'],
    [[{ categoryId: 'cat-deleted', count: 2 }], 'from another category.'],
  ])('names where moving transactions come from (%o)', async (movingFrom, text) => {
    serve(preview({ movingFrom }))
    const { form } = renderBuilder({ pattern: 'Costco', categoryId: groceries.id })
    expect(await within(form).findByText(/^Matches/)).toHaveTextContent(
      `2 would move to Groceries ${text}`,
    )
  })

  it('does not name a source when transactions come from several places', async () => {
    serve(
      preview({
        movingFrom: [
          { categoryId: null, count: 1 },
          { categoryId: dining.id, count: 1 },
        ],
      }),
    )
    const { form } = renderBuilder({ pattern: 'Costco', categoryId: groceries.id })
    const notice = await within(form).findByText(/^Matches/)
    expect(notice).toHaveTextContent('2 would move to Groceries.')
    expect(notice).not.toHaveTextContent('from')
  })

  it('only counts matches when no category is picked yet', async () => {
    const server = serve(preview({ wouldMove: 0, movingFrom: [], examples: [] }))
    const { form } = renderBuilder({ pattern: 'Costco' })
    const notice = await within(form).findByText(/^Matches/)
    expect(notice).toHaveTextContent('Matches 3 recent transactions.')
    expect(notice).not.toHaveTextContent('would move')
    expect(notice).not.toHaveTextContent('For example')
    expect(server.actions('preview_rule')[0]).toMatchObject({ categoryId: null })
  })

  it('waits for some text before previewing, and hides the preview when it is cleared', async () => {
    const server = serve()
    const { user, form } = renderBuilder()
    const input = screen.getByLabelText('Text to match')
    await user.type(input, '   ')
    // Longer than the pause the preview waits for after typing.
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)))
    expect(server.actions('preview_rule')).toEqual([])

    await user.clear(input)
    await user.type(input, 'Costco')
    expect(await within(form).findByText(/^Matches/)).toBeInTheDocument()
    // Typing settles before one request goes out, not one per key.
    expect(server.actions('preview_rule')).toEqual([expect.objectContaining({ pattern: 'Costco' })])

    await user.clear(input)
    await waitFor(() => expect(within(form).queryByText(/^Matches/)).not.toBeInTheDocument())
  })

  it('shows why a rule could not be saved and stays open', async () => {
    fakeServer(
      { preview_rule: () => preview() },
      failing('create_rule', 'Smallest amount must not be above the largest.'),
    )
    const { onClose, user } = renderBuilder({ pattern: 'Costco', categoryId: groceries.id })
    await user.click(saveButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Smallest amount must not be above the largest.',
    )
    expect(onClose).not.toHaveBeenCalled()
    expect(saveButton()).toBeEnabled()
  })

  it('is busy while saving', async () => {
    serve()
    const release = holdAction('create_rule')
    const { onClose, user } = renderBuilder({ pattern: 'Costco', categoryId: groceries.id })
    await user.click(saveButton())
    expect(await screen.findByRole('button', { name: 'Saving' })).toBeDisabled()
    release()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('closes without saving from Close or Cancel', async () => {
    const server = serve()
    const { onClose, user } = renderBuilder({ pattern: 'Costco', categoryId: groceries.id })
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(server.actions('create_rule')).toEqual([])
  })

  it('does not save without a category, even when Enter is pressed', async () => {
    const server = serve()
    const { user } = renderBuilder({ pattern: 'Costco' })
    await user.type(screen.getByLabelText('Text to match'), '{Enter}')
    expect(server.actions('create_rule')).toEqual([])
  })
})

describe('RulesList', () => {
  const ids = [
    '0b7f6a7e-0000-4000-8000-000000000001',
    '0b7f6a7e-0000-4000-8000-000000000002',
    '0b7f6a7e-0000-4000-8000-000000000003',
  ] as const
  const rules: Rule[] = [
    {
      id: ids[0],
      field: 'merchant',
      matchType: 'contains',
      pattern: 'Costco',
      minAmountCents: null,
      maxAmountCents: null,
      categoryId: groceries.id,
      position: 0,
    },
    {
      id: ids[1],
      field: 'description',
      matchType: 'starts_with',
      pattern: 'SQ *',
      minAmountCents: 500,
      maxAmountCents: null,
      categoryId: dining.id,
      position: 1,
    },
    {
      id: ids[2],
      field: 'merchant',
      matchType: 'equals',
      pattern: 'Rent',
      minAmountCents: null,
      maxAmountCents: null,
      categoryId: 'cat-deleted',
      position: 2,
    },
  ]

  function serve(list: Rule[] = rules, routes = {}) {
    return fakeServer(
      {
        list_rules: () => list,
        reorder_rules: () => ({ rules: list, recategorized: 0 }),
        delete_rule: () => ({ deleted: true, recategorized: 0 }),
      },
      routes,
    )
  }

  function renderList(categoryId?: string) {
    const onNew = vi.fn()
    renderSignedIn(<RulesList categories={categories} categoryId={categoryId} onNew={onNew} />)
    return { onNew, user: userEvent.setup(), region: screen.getByRole('region', { name: 'Rules' }) }
  }

  it('lists every rule in the order they run', async () => {
    serve()
    const { region } = renderList()
    expect(await screen.findByText('Merchant contains "Costco"')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your rules' })).toBeInTheDocument()
    expect(region).toHaveTextContent(
      /1Merchant contains "Costco"Groceries.*2Description starts with "SQ \*" \(amount limited\)Dining out.*3Merchant is exactly "Rent"Unknown/,
    )
    expect(screen.getAllByText('(amount limited)')).toHaveLength(1)
  })

  it('says there are no rules only once the list has loaded', async () => {
    serve([])
    renderList()
    expect(screen.queryByText(/No rules yet/)).not.toBeInTheDocument()
    expect(await screen.findByText(/No rules yet/)).toBeInTheDocument()
  })

  it('starts a new rule', async () => {
    serve()
    const { onNew, user } = renderList()
    await user.click(screen.getByRole('button', { name: '+ New rule' }))
    expect(onNew).toHaveBeenCalledTimes(1)
  })

  it('moves rules up and down, but not past either end', async () => {
    const server = serve()
    const { user } = renderList()
    await screen.findByText('Merchant contains "Costco"')
    expect(screen.getByRole('button', { name: 'Move rule 1 up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move rule 3 down' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Move rule 2 up' }))
    await waitFor(() => expect(server.actions('reorder_rules')).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: 'Move rule 2 down' }))
    await waitFor(() => expect(server.actions('reorder_rules')).toHaveLength(2))
    expect(server.actions('reorder_rules')).toEqual([
      { ids: [ids[1], ids[0], ids[2]] },
      { ids: [ids[0], ids[2], ids[1]] },
    ])
    // The list is read again after each change.
    await waitFor(() => expect(server.actions('list_rules')).toHaveLength(3))
  })

  it('deletes a rule', async () => {
    const server = serve()
    const { user } = renderList()
    await user.click(await screen.findByRole('button', { name: 'Delete rule 2' }))
    await waitFor(() => expect(server.actions('delete_rule')).toEqual([{ id: ids[1] }]))
  })

  it("shows one category's rules with their place in the full order", async () => {
    serve()
    const { region } = renderList(dining.id)
    expect(await screen.findByText('Description starts with "SQ *"')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Rules' })).toBeInTheDocument()
    expect(screen.queryByText('Merchant contains "Costco"')).not.toBeInTheDocument()
    // Moving only makes sense in the full list.
    expect(within(region).queryByRole('button', { name: /Move/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete rule 2' })).toBeEnabled()
  })

  it('says a category has no rules yet', async () => {
    serve()
    renderList('cat-without-rules')
    expect(await screen.findByText(/No rules yet/)).toBeInTheDocument()
  })

  it('shows the error when the rules cannot be read', async () => {
    serve([], failing('list_rules', 'Database is down', 500))
    renderList()
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is down')
    expect(screen.queryByText(/No rules yet/)).not.toBeInTheDocument()
  })

  it.each([
    ['reorder_rules', 'Move rule 1 down'],
    ['delete_rule', 'Delete rule 1'],
  ])('shows the error when %s fails', async (action, button) => {
    serve(rules, failing(action, 'That rule is gone.', 404))
    const { user } = renderList()
    await user.click(await screen.findByRole('button', { name: button }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That rule is gone.')
  })

  it('locks moving while a move is saved', async () => {
    serve()
    const release = holdAction('reorder_rules')
    const { user } = renderList()
    await user.click(await screen.findByRole('button', { name: 'Move rule 1 down' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Move rule 2 up' })).toBeDisabled(),
    )
    expect(screen.getByRole('button', { name: 'Move rule 1 down' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete rule 1' })).toBeEnabled()
    release()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Move rule 2 up' })).toBeEnabled(),
    )
  })
})
