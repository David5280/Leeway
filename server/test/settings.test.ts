import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { getSettings, settingsSchema } from '../src/domain/settings.js'
import { createTestContext, resetData } from './helpers.js'

let ctx: AppContext

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

/** Stores a raw settings document, as an older version of Leeway might have left it. */
const store = (json: string) => ctx.db.query('UPDATE settings SET data = $1::jsonb', [json])

describe('reading stored settings', () => {
  it('falls back to defaults when the stored document is not an object', async () => {
    await store('42')
    expect(await getSettings(ctx.db)).toEqual(settingsSchema.parse({}))
  })

  it('keeps the valid fields of a broken document and drops options that no longer exist', async () => {
    await store('{"currency": "dollars", "locale": "en-GB", "oldOption": true}')

    const settings = await getSettings(ctx.db)

    expect(settings).toMatchObject({ currency: 'USD', locale: 'en-GB' })
    expect(settings).not.toHaveProperty('oldOption')
  })

  it('uses the default look when the stored appearance is not an object', async () => {
    await store('{"appearance": "neon", "includePending": false}')

    const settings = await getSettings(ctx.db)

    expect(settings.appearance).toEqual(settingsSchema.parse({}).appearance)
    expect(settings.includePending).toBe(false)
  })
})
