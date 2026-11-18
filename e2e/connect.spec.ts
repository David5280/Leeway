// An assistant connecting the way Claude does: discovery, sign-in with PKCE,
// the owner's approval on Leeway's consent screen, tokens, then disconnecting.

import { createHash, randomBytes } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'

// The app's own redirect, on this computer, like Claude Code's. Nothing listens
// there: the test catches the browser's visit instead.
const CALLBACK = 'http://127.0.0.1:33418/callback'

function mcp(request: APIRequestContext, accessToken: string) {
  return request.post('/mcp', {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json, text/event-stream',
    },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  })
}

test('an assistant signs in with the owner approval and can be disconnected', async ({
  page,
  request,
  baseURL,
}) => {
  // Discovery: an unauthenticated call points to the protected resource metadata.
  const challenge = await request.post('/mcp', { data: {} })
  expect(challenge.status()).toBe(401)
  expect(challenge.headers()['www-authenticate']).toContain(
    `resource_metadata="${baseURL}/.well-known/oauth-protected-resource/mcp"`,
  )
  const resource = await (await request.get('/.well-known/oauth-protected-resource/mcp')).json()
  const server = await (await request.get('/.well-known/oauth-authorization-server')).json()
  expect(server.code_challenge_methods_supported).toEqual(['S256'])

  const registration = await (
    await request.post('/oauth/register', {
      data: { client_name: 'Test app', redirect_uris: [CALLBACK] },
    })
  ).json()

  const verifier = randomBytes(32).toString('base64url')
  const authorize = new URL(server.authorization_endpoint)
  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: registration.client_id,
    redirect_uri: CALLBACK,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state: 'state-123',
    scope: 'read write',
    resource: resource.resource,
  }).toString()

  let returned: URL | null = null
  await page.route(`${CALLBACK}**`, async (route) => {
    returned = new URL(route.request().url())
    await route.fulfill({ body: 'Back in the app' })
  })

  // The owner sees who is asking, gives it only a look, and approves.
  await page.goto(authorize.toString())
  await expect(page.getByRole('heading', { name: 'Connect Test app to Leeway?' })).toBeVisible()
  await expect(page.getByText(/This gives access to an app on this computer/)).toBeVisible()
  await page.getByRole('button', { name: 'Look only' }).click()
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('Back in the app')).toBeVisible()

  const back = returned as URL | null
  expect(back?.searchParams.get('state')).toBe('state-123')
  expect(back?.searchParams.get('iss')).toBe(`${baseURL}`)
  const tokens = await (
    await request.post('/oauth/token', {
      form: {
        grant_type: 'authorization_code',
        code: back?.searchParams.get('code') ?? '',
        redirect_uri: CALLBACK,
        client_id: registration.client_id,
        code_verifier: verifier,
        resource: resource.resource,
      },
    })
  ).json()
  expect(tokens.scope).toBe('read')
  expect((await mcp(request, tokens.access_token)).status()).toBe(200)

  // The connected app shows in Customize, and disconnecting it cuts it off at once.
  await page.goto('/customize#agent')
  const agent = page.getByRole('region', { name: 'AI assistant' })
  const disconnect = agent.getByRole('button', { name: 'Disconnect Test app' })
  await expect(agent.locator('.list-row').filter({ hasText: 'Test app' })).toContainText(
    'Test app (an app on this computer)Can look, connected',
  )
  await disconnect.click()
  await expect(disconnect).toHaveCount(0)
  expect((await mcp(request, tokens.access_token)).status()).toBe(401)
})

test('a link with a problem explains it without sending anything anywhere', async ({ page }) => {
  await page.goto('/oauth/authorize?client_id=lwc_unknown&response_type=code')
  await expect(page).toHaveURL(/\/connect\?problem=unknown_app$/)
  await expect(page.getByRole('alert')).toContainText("couldn't tell which app was asking")
})
