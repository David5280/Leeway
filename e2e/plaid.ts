// Helpers for adding a bank. The browser tests run with no Plaid keys, and no
// test may reach Plaid, so Plaid is stood in for at the network: the server
// says bank sync is on, the bank list holds two long-named banks, Plaid's
// script is a window that finishes at once on the first of them, and
// link_bank answers that the bank picked is already connected. Nothing is
// saved, so the install stays as the other tests expect it. The same goes for
// an account the bank no longer shares, which is added to what the server
// answers rather than to its database.

import { expect, type Page } from '@playwright/test'

/** Banks already connected, with names long enough to crowd a phone's row. */
const BANKS = [
  {
    id: '00000000-0000-4000-8000-0000000000b1',
    provider: 'plaid',
    institutionName: 'JPMorgan Chase Bank, National Association',
    institutionId: 'ins_56',
    status: 'active',
    lastSyncedAt: new Date().toISOString(),
    lastError: null,
    accountCount: 3,
    unsharedCount: 1,
  },
  {
    id: '00000000-0000-4000-8000-0000000000b2',
    provider: 'plaid',
    institutionName: 'Bank of Oklahoma Financial Credit Union Services',
    institutionId: 'ins_14',
    status: 'needs_reauth',
    lastSyncedAt: null,
    lastError: 'The bank needs you to log in again',
    accountCount: 1,
    unsharedCount: 0,
  },
] as const

const [CHASE] = BANKS

/**
 * Plaid's window, as far as react-plaid-link can tell: open() finishes at
 * once, on the bank connected first, with a checking account picked.
 */
const PLAID_SCRIPT = `window.Plaid = {
  create(config) {
    return {
      open() {
        setTimeout(() => config.onSuccess('public-e2e', {
          institution: { institution_id: '${CHASE.institutionId}', name: '${CHASE.institutionName}' },
          accounts: [{ id: 'a1', name: 'Total Checking', mask: '1234', type: 'depository', subtype: 'checking' }],
          link_session_id: 'e2e',
        }))
      },
      exit(options, done) { if (done) done() },
      submit() {},
      destroy() {},
    }
  },
}`

/** Bank sync turned on, in a country where a reconnect can choose accounts. */
async function turnOnBankSync(page: Page): Promise<void> {
  await page.route('**/api/status', async (route) => {
    const status = await (await route.fetch()).json()
    const bank = { provider: 'plaid', environment: 'production', chooseAccounts: true }
    await route.fulfill({ json: { ...status, bank } })
  })
}

/** Bank sync turned on, two banks connected, and Plaid's window stood in for. */
export async function standInForPlaid(page: Page): Promise<void> {
  await turnOnBankSync(page)
  await page.route('**/api/actions/list_connections', (route) =>
    route.fulfill({
      json: { result: BANKS.map(({ institutionId: _id, ...connection }) => connection) },
    }),
  )
  await page.route('**/api/actions/create_link_token', (route) =>
    route.fulfill({ json: { result: { linkToken: 'link-e2e' } } }),
  )
  await page.route('https://cdn.plaid.com/link/v2/stable/link-initialize.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: PLAID_SCRIPT }),
  )
  await page.route('**/api/actions/link_bank', (route) =>
    route.fulfill({
      status: 409,
      json: {
        error: 'duplicate_bank',
        message: `${CHASE.institutionName} is already connected.`,
        details: {
          institutionName: CHASE.institutionName,
          logins: [
            {
              connectionId: CHASE.id,
              institutionName: CHASE.institutionName,
              status: CHASE.status,
              sameAccounts: false,
            },
          ],
        },
      },
    }),
  )
}

/** Opens the list of banks already connected, from Connect another bank. */
export async function checkConnectedBanks(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Connect another bank' }).click()
  await expect(page.getByRole('region', { name: 'Already connected' })).toBeVisible()
}

/** Goes on to Plaid's window, which comes back with a bank already connected. */
export async function pickConnectedBankAgain(page: Page): Promise<void> {
  await checkConnectedBanks(page)
  await page.getByRole('button', { name: 'Add a different bank' }).click()
  await expect(page.getByRole('region', { name: /is already connected$/ })).toBeVisible()
}

/** Goes on to the deliberate yes a second login at the same bank needs. */
export async function askForSecondLogin(page: Page): Promise<void> {
  await pickConnectedBankAgain(page)
  await page.getByRole('button', { name: "It's a different login" }).click()
  await expect(page.getByRole('region', { name: /^Add a second .+ login\?$/ })).toBeVisible()
}

/**
 * A savings account the owner un-ticked when reconnecting the first bank:
 * long-named, with a balance large enough to crowd a phone's row, last read
 * two weeks ago.
 */
const UNSHARED = {
  id: '00000000-0000-4000-8000-0000000000a1',
  connectionId: CHASE.id,
  institutionName: CHASE.institutionName,
  name: 'JPMorgan Chase Premier Plus Relationship Savings',
  nickname: null,
  bankName: 'Premier Plus Relationship Savings',
  mask: '2222',
  type: 'depository',
  subtype: 'savings',
  balanceCents: 123456789,
  availableCents: 123456789,
  creditLimitCents: null,
  currency: 'USD',
  hidden: false,
  manual: false,
  balanceUpdatedAt: new Date(Date.now() - 14 * 86_400_000).toISOString(),
  unsharedAt: new Date(Date.now() - 13 * 86_400_000).toISOString(),
  mayBeBackAs: null,
  aprPercent: null,
  minimumPaymentCents: null,
  lowBalanceCents: null,
  kindChoice: null,
  kind: 'savings',
}

/**
 * Adds the account the bank no longer shares to the accounts the server
 * lists and to the Accounts dashboard, as the server would show it: apart
 * from the balances, with a word in the summary.
 */
export async function standInForUnsharedAccount(page: Page): Promise<void> {
  // With bank sync on, so the account offers Share it again beside Remove.
  await turnOnBankSync(page)
  await page.route('**/api/actions/list_accounts', async (route) => {
    const { result } = await (await route.fetch()).json()
    await route.fulfill({ json: { result: [...result, UNSHARED] } })
  })
  await page.route('**/api/actions/summarize_accounts', async (route) => {
    const { result } = await (await route.fetch()).json()
    const point = `${UNSHARED.name} is no longer shared from ${UNSHARED.institutionName} and is left out of these figures.`
    await route.fulfill({
      json: {
        result: {
          ...result,
          accounts: [...result.accounts, UNSHARED],
          summary: { ...result.summary, points: [point, ...result.summary.points].slice(0, 4) },
        },
      },
    })
  })
}

/** Goes on to the confirm step for removing the account the bank no longer shares. */
export async function confirmRemovingUnshared(page: Page): Promise<void> {
  const row = page.getByRole('group', { name: UNSHARED.name })
  await row.getByRole('button', { name: 'Remove this account and its history' }).click()
  await expect(row.getByRole('button', { name: 'Remove for good' })).toBeVisible()
}
