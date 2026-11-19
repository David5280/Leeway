import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../App'
import {
  budgetFor,
  category,
  fakeServer,
  renderPlain,
  renderSignedIn,
  settings,
  status,
  type Handlers,
} from '../../test/fake'
import { Setup } from '../Setup'

afterEach(() => vi.unstubAllGlobals())

const bank = { provider: 'plaid', environment: 'sandbox' }
const {
  id: _id,
  position: _position,
  icon: _icon,
  ...groceries
} = category('Groceries', {
  budgetCents: 60000,
})
const paycheck = { ...groceries, name: 'Paycheck', kind: 'income' as const, budgetCents: null }
const transfers = { ...paycheck, name: 'Transfers', kind: 'transfer' as const }

/** The server for a fresh install, with no banks unless a test adds some. */
function serve(extra: Handlers = {}, routes: Record<string, () => Response> = {}) {
  return fakeServer(
    {
      update_settings: (patch) => ({ ...settings, ...patch }),
      list_connections: () => [],
      get_starter_categories: () => [groceries, paycheck],
      complete_setup: () => ({ categoriesAdded: 2 }),
      create_token: () => ({ token: 'lw_secret_key', id: 'tok' }),
      ...extra,
    },
    routes,
  )
}

/** Moves from the period step to the starting point, with or without banks. */
async function toStartingPoint(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Continue' }))
  await user.click(await screen.findByRole('button', { name: /Skip for now|Continue/ }))
  await screen.findByRole('heading', { name: 'Choose your categories' })
}

describe('setup after the account exists', () => {
  it('saves the budget period, time zone and warning level', async () => {
    const server = serve()
    renderSignedIn(<Setup status={{ ...status, onboarded: false }} signedIn />)
    const user = userEvent.setup()
    expect(screen.getByRole('heading', { name: 'How do you budget?' })).toBeInTheDocument()
    const warn = screen.getByLabelText('Warn me at percent')
    await user.clear(warn)
    await user.type(warn, '90')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(server.actions('update_settings')).toHaveLength(1))
    expect(server.actions('update_settings')[0]).toMatchObject({
      period: settings.period,
      defaultWarnAtPercent: 90,
    })
    expect(await screen.findByRole('heading', { name: 'Sync your bank' })).toBeInTheDocument()
  })

  it('keeps the warning level between 1 and 100, and an emptied box keeps the last value', async () => {
    serve()
    renderSignedIn(<Setup status={status} signedIn />)
    const user = userEvent.setup()
    const warn = screen.getByLabelText('Warn me at percent')
    await user.clear(warn)
    await user.type(warn, '250')
    await user.tab()
    expect(warn).toHaveValue(100)
    await user.clear(warn)
    await user.tab()
    expect(warn).toHaveValue(100)
  })

  it('marks finished steps in the step list', async () => {
    serve()
    renderSignedIn(<Setup status={status} signedIn />)
    const steps = screen.getByRole('list', { name: 'Setup steps' })
    const items = within(steps).getAllByRole('listitem')
    expect(items.map((item) => item.className)).toEqual([
      'step done',
      'step done',
      'step current',
      'step',
      'step',
      'step',
    ])
    expect(items[2]).toHaveAttribute('aria-current', 'step')
    // Finished steps say so in words too, not only with a tick.
    expect(items[0]).toHaveTextContent('Setup code (done)')
    expect(screen.getByText('Step 3 of 6')).toBeInTheDocument()
  })

  it('explains bank keys when the server has none, and lets the step be skipped', async () => {
    serve()
    renderSignedIn(<Setup status={{ ...status, bank: null }} signedIn />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Bank sync is off on this Leeway.')).toBeInTheDocument()
    expect(screen.getByText(/^Optional\./)).toHaveTextContent(/import a CSV file/)
    // The keys go in Railway's Variables, never into this page.
    await user.click(screen.getByText('How to turn on bank sync'))
    expect(screen.getByText(/open the Leeway service's/)).toHaveTextContent(
      "In Railway, open the Leeway service's Variables, set PLAID_CLIENT_ID and PLAID_SECRET",
    )
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument()
  })

  it('says Plaid is in Sandbox beside the button, so test banks are no surprise', async () => {
    serve()
    renderSignedIn(<Setup status={{ ...status, bank }} signedIn />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(
      await screen.findByText('Plaid is in Sandbox, so it lists only test banks.'),
    ).toBeInTheDocument()
    // Connecting is the step's main button; skipping stays available but quiet.
    expect(screen.getByRole('button', { name: 'Connect a bank' })).toHaveClass('primary')
    expect(screen.getByRole('button', { name: 'Skip for now' })).not.toHaveClass('primary')
  })

  it('says nothing of Sandbox once Plaid reaches real banks', async () => {
    serve()
    const production = { provider: 'plaid', environment: 'production' }
    renderSignedIn(<Setup status={{ ...status, bank: production }} signedIn />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('button', { name: 'Connect a bank' })
    expect(screen.queryByText(/Sandbox/)).not.toBeInTheDocument()
  })

  it('lists connected banks and offers another', async () => {
    serve({
      list_connections: () => [{ id: 'c1', institutionName: 'First Bank', accountCount: 2 }],
    })
    renderSignedIn(<Setup status={{ ...status, bank }} signedIn />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('First Bank')).toBeInTheDocument()
    expect(screen.getByText('2 accounts')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect another bank' })).toBeInTheDocument()
  })

  it('goes back a step', async () => {
    serve()
    renderSignedIn(<Setup status={status} signedIn />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(await screen.findByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: 'How do you budget?' })).toBeInTheDocument()
  })
})

describe('starting point', () => {
  it('uses the starter set when there is no bank, with the owner edits', async () => {
    const server = serve({ get_starter_categories: () => [groceries, paycheck, transfers] })
    renderSignedIn(<Setup status={status} signedIn />)
    const user = userEvent.setup()
    await toStartingPoint(user)
    expect(screen.getByRole('button', { name: /Starter set/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: /Suggest from my spending/ })).toBeDisabled()
    const amount = await screen.findByLabelText('Groceries budget')
    expect(amount).toHaveValue('600')
    await user.clear(amount)
    await user.type(amount, '450')
    // Income and transfers take no budget; each row says how it counts instead.
    expect(screen.getByText('Money in')).toBeInTheDocument()
    expect(screen.getByText('Not counted')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Include Transfers' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(server.actions('complete_setup')).toHaveLength(1))
    expect(server.actions('complete_setup')[0]).toEqual({
      categories: [
        { ...groceries, budgetCents: 45000, budgetCadence: 'month' },
        { ...paycheck, budgetCadence: 'month' },
      ],
    })
    expect(await screen.findByRole('heading', { name: "You're set" })).toBeInTheDocument()
  })

  it('lists the starter set under its group headings', async () => {
    const grouped = [
      { ...groceries, group: 'Food' },
      { ...paycheck, group: 'Pay' },
    ]
    serve({ get_starter_categories: () => grouped })
    renderSignedIn(<Setup status={status} signedIn />)
    await toStartingPoint(userEvent.setup())
    const list = await screen.findByLabelText('Categories to create')
    const shown = within(list).getAllByText(/^(Food|Pay|Groceries|Paycheck)$/)
    expect(shown.map((e) => e.textContent)).toEqual(['Food', 'Groceries', 'Pay', 'Paycheck'])
  })

  it('skips a category that is unticked, and stops editing its amount', async () => {
    const server = serve()
    renderSignedIn(<Setup status={status} signedIn />)
    const user = userEvent.setup()
    await toStartingPoint(user)
    await user.click(await screen.findByLabelText('Include Groceries'))
    expect(screen.getByLabelText('Groceries budget')).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(server.actions('complete_setup')).toHaveLength(1))
    expect(server.actions('complete_setup')[0]).toEqual({
      categories: [{ ...paycheck, budgetCadence: 'month' }],
    })
  })

  it('suggests budgets from spending when a bank is connected', async () => {
    const server = serve({
      list_connections: () => [{ id: 'c1', institutionName: 'First Bank', accountCount: 1 }],
      suggest_starter_budgets: () => [
        { name: 'Groceries', averageMonthlyCents: 41234, suggestedMonthlyCents: 42000 },
      ],
    })
    renderSignedIn(<Setup status={{ ...status, bank }} signedIn />)
    const user = userEvent.setup()
    await toStartingPoint(user)
    expect(await screen.findByLabelText('Groceries budget')).toHaveValue('420')
    expect(screen.getByText(/you average \$412/)).toBeInTheDocument()
    expect(server.actions('suggest_starter_budgets')[0]).toEqual({
      categories: [groceries, paycheck],
    })
  })

  it('starts empty without creating categories', async () => {
    const server = serve()
    renderSignedIn(<Setup status={status} signedIn />)
    const user = userEvent.setup()
    await toStartingPoint(user)
    await user.click(screen.getByRole('button', { name: /Start empty/ }))
    expect(screen.queryByLabelText('Groceries budget')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(server.actions('complete_setup')).toEqual([{ categories: [] }]))
  })

  it('imports a setup file and only then lets the owner continue', async () => {
    const server = serve({ import_config: () => ({ categoriesAdded: 4, rulesAdded: 2 }) })
    renderSignedIn(<Setup status={status} signedIn />)
    const user = userEvent.setup()
    await toStartingPoint(user)
    await user.click(screen.getByRole('button', { name: /Copy from another Leeway/ }))
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    const file = new File(['{"version":1,"categories":[]}'], 'leeway.json', {
      type: 'application/json',
    })
    await user.upload(screen.getByLabelText('Leeway setup file'), file)
    expect(
      await screen.findByText('Imported 4 categories and 2 rules from leeway.json.'),
    ).toBeInTheDocument()
    expect(server.actions('import_config')[0]).toEqual({
      config: { version: 1, categories: [] },
      mode: 'replace',
    })
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  it('says plainly when the file is not JSON', async () => {
    const server = serve()
    renderSignedIn(<Setup status={status} signedIn />)
    const user = userEvent.setup()
    await toStartingPoint(user)
    await user.click(screen.getByRole('button', { name: /Copy from another Leeway/ }))
    await user.upload(
      screen.getByLabelText('Leeway setup file'),
      new File(['not json'], 'notes.txt', { type: 'application/json' }),
    )
    expect(await screen.findByText('That file is not valid JSON.')).toBeInTheDocument()
    expect(server.actions('import_config')).toEqual([])
  })
})

describe('done', () => {
  it('shows the assistant address and a new read-only key once', async () => {
    const server = serve()
    renderSignedIn(<Setup status={status} signedIn />)
    const user = userEvent.setup()
    await toStartingPoint(user)
    await user.click(screen.getByRole('button', { name: /Start empty/ }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('https://leeway.example.com/mcp')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create a key' }))
    expect(await screen.findByText('lw_secret_key')).toBeInTheDocument()
    expect(server.actions('create_token')).toEqual([{ name: 'AI assistant', scope: 'read' }])
    expect(screen.getByRole('button', { name: 'Open my overview' })).toBeInTheDocument()
  })

  it('offers a CSV import or an account by hand when no bank is synced', async () => {
    serve()
    renderSignedIn(<Setup status={status} signedIn />)
    const user = userEvent.setup()
    await toStartingPoint(user)
    await user.click(screen.getByRole('button', { name: /Start empty/ }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText(/Next, bring in your money/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Import a CSV file/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add an account by hand/ })).toBeInTheDocument()
  })

  it('takes the owner to Settings, Accounts, to add an account by hand', async () => {
    serve()
    /** Shows where the router is, as the address bar would. */
    function Address() {
      const { pathname, hash } = useLocation()
      return <output aria-label="Address">{pathname + hash}</output>
    }
    renderSignedIn(
      <>
        <Setup status={status} signedIn />
        <Address />
      </>,
    )
    const user = userEvent.setup()
    await toStartingPoint(user)
    await user.click(screen.getByRole('button', { name: /Start empty/ }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(await screen.findByRole('button', { name: /Add an account by hand/ }))
    expect(screen.getByLabelText('Address')).toHaveTextContent('/settings/accounts')
  })

  it('says the bank keeps itself current once one is synced', async () => {
    serve({
      list_connections: () => [{ id: 'c1', institutionName: 'First Bank', accountCount: 1 }],
      suggest_starter_budgets: () => [],
    })
    renderSignedIn(<Setup status={{ ...status, bank }} signedIn />)
    const user = userEvent.setup()
    await toStartingPoint(user)
    await user.click(screen.getByRole('button', { name: /Start empty/ }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText(/Leeway syncs your bank as things happen/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Import a CSV file/ })).not.toBeInTheDocument()
  })

  it('gives the assistant the address of this page when the server has no public one', async () => {
    serve()
    renderSignedIn(<Setup status={{ ...status, publicUrl: null }} signedIn />)
    const user = userEvent.setup()
    await toStartingPoint(user)
    await user.click(screen.getByRole('button', { name: /Start empty/ }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText(`${window.location.origin}/mcp`)).toBeInTheDocument()
  })
})

describe('finishing setup', () => {
  it('opens the overview once the owner leaves the last step', async () => {
    // The owner counts as onboarded once the starting point is saved, as on the real server.
    let onboarded = false
    const me = () => Response.json({ owner: { email: 'dana@example.com', name: null, onboarded } })
    serve(
      {
        get_settings: () => ({ ...settings, dashboard: { widgets: [] } }),
        get_budget: () => budgetFor([], []),
        complete_setup: () => {
          onboarded = true
          return { categoriesAdded: 0 }
        },
      },
      { '/api/status': () => Response.json(status), '/api/auth/me': me },
    )
    renderPlain(<App />)
    const user = userEvent.setup()
    await toStartingPoint(user)
    await user.click(screen.getByRole('button', { name: /Start empty/ }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(await screen.findByRole('button', { name: 'Open my overview' }))
    expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Setup steps' })).not.toBeInTheDocument()
  })

  it('opens the CSV import straight from the last step', async () => {
    let onboarded = false
    const me = () => Response.json({ owner: { email: 'dana@example.com', name: null, onboarded } })
    serve(
      {
        get_settings: () => settings,
        list_accounts: () => [],
        list_imports: () => [],
        complete_setup: () => {
          onboarded = true
          return { categoriesAdded: 0 }
        },
      },
      { '/api/status': () => Response.json(status), '/api/auth/me': me },
    )
    renderPlain(<App />)
    const user = userEvent.setup()
    await toStartingPoint(user)
    await user.click(screen.getByRole('button', { name: /Start empty/ }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(await screen.findByRole('button', { name: /Import a CSV file/ }))
    expect(await screen.findByRole('heading', { name: 'Import transactions' })).toBeInTheDocument()
  })
})
