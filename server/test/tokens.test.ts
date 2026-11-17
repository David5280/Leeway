import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { verifyToken } from '../src/domain/tokens.js'
import { actionCaller } from './actionCaller.js'
import { createTestContext, resetData } from './helpers.js'

let ctx: AppContext
const { call, callError } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

// A well-formed id that matches no token.
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

describe('agent tokens', () => {
  it('lists tokens oldest first, without the secret, and never used until they are', async () => {
    await call('create_token', { name: 'Reader', scope: 'read' })
    await call('create_token', { name: 'Coach', scope: 'write' })

    const tokens = await call('list_tokens')

    expect(tokens.map((t) => [t.name, t.scope, t.lastUsedAt])).toEqual([
      ['Reader', 'read', null],
      ['Coach', 'write', null],
    ])
    for (const token of tokens) {
      expect(Object.keys(token).sort()).toEqual(['createdAt', 'id', 'lastUsedAt', 'name', 'scope'])
    }
  })

  it('trims the name and refuses an empty name or an unknown scope', async () => {
    const created = await call('create_token', { name: '  Claude  ', scope: 'read' })
    expect(created.name).toBe('Claude')
    expect((await callError('create_token', { name: '   ', scope: 'read' })).code).toBe(
      'invalid_input',
    )
    expect((await callError('create_token', { name: 'Root', scope: 'admin' })).code).toBe(
      'invalid_input',
    )
  })

  it('accepts a token for its scope and records when it was last used', async () => {
    const { token, id } = await call('create_token', { name: 'Coach', scope: 'write' })

    expect(await verifyToken(ctx.db, token)).toBe('write')

    const [listed] = await call('list_tokens')
    expect(listed?.id).toBe(id)
    expect(listed?.lastUsedAt).not.toBeNull()
  })

  it('rejects a token it does not know, without touching the others', async () => {
    const { token } = await call('create_token', { name: 'Reader', scope: 'read' })

    expect(await verifyToken(ctx.db, `${token}x`)).toBeNull()

    const [listed] = await call('list_tokens')
    expect(listed?.lastUsedAt).toBeNull()
  })

  it('revokes a token so it stops working at once', async () => {
    const { token, id } = await call('create_token', { name: 'Old agent', scope: 'read' })

    expect(await call('delete_token', { id })).toEqual({ deleted: true })

    expect(await call('list_tokens')).toEqual([])
    expect(await verifyToken(ctx.db, token)).toBeNull()
  })

  it('reports an unknown token as not found', async () => {
    const error = await callError('delete_token', { id: UNKNOWN_ID })
    expect(error).toMatchObject({ code: 'not_found', message: 'Token not found' })
  })
})
