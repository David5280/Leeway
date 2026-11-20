// The sign-in screen an assistant is sent to when it connects, for the phone
// layout guard (guarded-screens.ts), reached as Claude would reach it (see
// connect.spec.ts).

import { createHash, randomBytes } from 'node:crypto'
import { expect, type APIRequestContext } from '@playwright/test'
import type { Screen } from './guarded-screens'

export const CONNECT_SCREEN: Screen = {
  name: "an assistant's connect screen",
  route: 'connect',
  path: (_, request) => connectAddress(request),
  then: (page) =>
    expect(page.getByRole('heading', { name: /^Connect .+ to Leeway\?$/ })).toBeVisible(),
}

/** A sign-in screen an assistant is sent to, as Claude would be (see connect.spec.ts). */
async function connectAddress(request: APIRequestContext): Promise<string> {
  const callback = 'http://127.0.0.1:33418/callback'
  const server = await (await request.get('/.well-known/oauth-authorization-server')).json()
  const resource = await (await request.get('/.well-known/oauth-protected-resource/mcp')).json()
  const app = await (
    await request.post('/oauth/register', {
      data: { client_name: 'Claude on the laptop upstairs', redirect_uris: [callback] },
    })
  ).json()
  const verifier = randomBytes(32).toString('base64url')
  const address = new URL(server.authorization_endpoint)
  address.search = new URLSearchParams({
    response_type: 'code',
    client_id: app.client_id,
    redirect_uri: callback,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state: 'layout-guard',
    scope: 'read write',
    resource: resource.resource,
  }).toString()
  return address.toString()
}
