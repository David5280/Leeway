import { createHash } from 'node:crypto'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import { PlaidProvider } from '../src/bank/plaid.js'
import { BankError } from '../src/bank/provider.js'

const config = {
  clientId: 'client-1',
  secret: 'secret-1',
  env: 'sandbox' as const,
  countryCodes: ['US'],
  redirectUri: null,
}

interface Call {
  url: string
  body: Record<string, unknown>
}

/** A fetch that records each call and answers from a table of endpoints. */
function fakeFetch(answers: Record<string, { status?: number; body: unknown }>) {
  const calls: Call[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) })
    const path = new URL(url).pathname
    const answer = answers[path]
    if (!answer) throw new Error(`no answer for ${path}`)
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 })
  }) as typeof fetch
  return { calls, fetchImpl }
}

describe('Plaid provider', () => {
  it('asks for read-only transactions access and sends credentials with every call', async () => {
    const { calls, fetchImpl } = fakeFetch({
      '/link/token/create': { body: { link_token: 'lt-1' } },
    })
    const plaid = new PlaidProvider(config, fetchImpl)
    expect(
      await plaid.createLinkToken({ webhookUrl: 'https://me.example/api/webhooks/plaid' }),
    ).toBe('lt-1')
    expect(calls[0]!.url).toBe('https://sandbox.plaid.com/link/token/create')
    expect(calls[0]!.body).toMatchObject({
      client_id: 'client-1',
      secret: 'secret-1',
      products: ['transactions'],
      webhook: 'https://me.example/api/webhooks/plaid',
    })

    await plaid.createLinkToken({ accessToken: 'access-1' })
    expect(calls[1]!.body).toMatchObject({ access_token: 'access-1' })
    expect(calls[1]!.body).not.toHaveProperty('products')
  })

  it('maps accounts and transactions into cents and Leeway types', async () => {
    const { calls, fetchImpl } = fakeFetch({
      '/accounts/get': {
        body: {
          accounts: [
            {
              account_id: 'a1',
              name: 'Brokerage',
              official_name: null,
              mask: '1234',
              type: 'brokerage',
              subtype: null,
              balances: {
                current: 1050.1,
                available: null,
                limit: null,
                iso_currency_code: 'USD',
                unofficial_currency_code: null,
              },
            },
          ],
        },
      },
      '/transactions/sync': {
        body: {
          added: [
            {
              transaction_id: 't1',
              pending_transaction_id: null,
              account_id: 'a1',
              date: '2026-11-10',
              name: 'Payroll',
              merchant_name: null,
              amount: -2000.55,
              iso_currency_code: 'USD',
              unofficial_currency_code: null,
              pending: false,
              personal_finance_category: { primary: 'INCOME', detailed: 'INCOME_WAGES' },
            },
          ],
          modified: [],
          removed: [{ transaction_id: 't0' }],
          next_cursor: 'next',
          has_more: false,
        },
      },
    })
    const plaid = new PlaidProvider(config, fetchImpl)
    const [account] = await plaid.getAccounts('access-1')
    expect(account).toMatchObject({
      type: 'investment',
      balanceCents: 105010,
      availableCents: null,
    })

    const page = await plaid.syncTransactions('access-1', 'prev')
    expect(calls[1]!.body).toMatchObject({ cursor: 'prev', count: 500 })
    expect(page).toMatchObject({ removed: ['t0'], nextCursor: 'next', hasMore: false })
    expect(page.added[0]).toMatchObject({ amountCents: -200055, categoryDetailed: 'INCOME_WAGES' })
  })

  it('turns a login error into a bank error that asks for re-login', async () => {
    const { fetchImpl } = fakeFetch({
      '/accounts/get': {
        status: 400,
        body: {
          error_code: 'ITEM_LOGIN_REQUIRED',
          display_message: 'Your bank needs you to log in',
        },
      },
    })
    const error = await new PlaidProvider(config, fetchImpl).getAccounts('x').catch((e) => e)
    expect(error).toBeInstanceOf(BankError)
    expect(error).toMatchObject({
      needsReauth: true,
      message: 'Your bank needs you to log in (ITEM_LOGIN_REQUIRED)',
    })
  })

  describe('webhooks', async () => {
    const { privateKey, publicKey } = await generateKeyPair('ES256')
    const jwk = { ...(await exportJWK(publicKey)), kid: 'key-1', alg: 'ES256' }
    const body = JSON.stringify({
      webhook_type: 'TRANSACTIONS',
      webhook_code: 'SYNC_UPDATES_AVAILABLE',
      item_id: 'item-9',
    })
    const sign = (rawBody: string, issuedAt = Math.floor(Date.now() / 1000)) =>
      new SignJWT({ request_body_sha256: createHash('sha256').update(rawBody).digest('hex') })
        .setProtectedHeader({ alg: 'ES256', kid: 'key-1' })
        .setIssuedAt(issuedAt)
        .sign(privateKey)
    const provider = () =>
      new PlaidProvider(
        config,
        fakeFetch({ '/webhook_verification_key/get': { body: { key: jwk } } }).fetchImpl,
      )

    it('accepts a correctly signed webhook', async () => {
      const webhook = await provider().parseWebhook(body, {
        'plaid-verification': await sign(body),
      })
      expect(webhook).toEqual({ itemId: 'item-9', event: 'sync' })
    })

    it('rejects a missing signature, a changed body and an old signature', async () => {
      const plaid = provider()
      await expect(plaid.parseWebhook(body, {})).rejects.toThrow(/Missing/)
      const token = await sign(body)
      await expect(
        plaid.parseWebhook(body.replace('item-9', 'item-8'), { 'plaid-verification': token }),
      ).rejects.toThrow(/does not match/)
      const old = await sign(body, Math.floor(Date.now() / 1000) - 600)
      await expect(plaid.parseWebhook(body, { 'plaid-verification': old })).rejects.toThrow()
    })
  })
})
