// Helpers for adding a bank. The browser tests run with no Plaid keys, and no
// test may reach Plaid, so Plaid is stood in for at the network: the server
// says bank sync is on, the bank list holds two long-named banks, Plaid's
// script is a window that finishes at once on the first of them, and
// link_bank answers that the bank picked is already connected. Nothing is
// saved, so the install stays as the other tests expect it.

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

/** Bank sync turned on, two banks connected, and Plaid's window stood in for. */
export async function standInForPlaid(page: Page): Promise<void> {
  await page.route('**/api/status', async (route) => {
    const status = await (await route.fetch()).json()
    await route.fulfill({
      json: { ...status, bank: { provider: 'plaid', environment: 'production' } },
    })
  })
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
