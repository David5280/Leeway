// GET /api/version: the running build's id, open to anyone, never cached, and
// changed by any change to the built web app.

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { buildApp } from '../src/http/app.js'
import { buildIdOf } from '../src/http/version.js'
import { createTestContext } from './helpers.js'

let ctx: AppContext
let webDir: string

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  webDir = await mkdtemp(join(tmpdir(), 'leeway-version-'))
})
afterEach(async () => {
  await rm(webDir, { recursive: true, force: true })
})

/** Writes a built page naming its script, as a Vite build does. */
const writePage = (script: string) =>
  writeFile(join(webDir, 'index.html'), `<!doctype html><script src="/assets/${script}"></script>`)

/** Asks a fresh server, with no session, which build it serves. */
async function versionFrom(dir: string | null) {
  const app = await buildApp(ctx, { webDir: dir })
  try {
    return await app.inject({ url: '/api/version' })
  } finally {
    await app.close()
  }
}

describe('GET /api/version', () => {
  it('answers without a session with the build id alone, never cached', async () => {
    await writePage('index-a1.js')
    const response = await versionFrom(webDir)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ build: expect.stringMatching(/^[0-9a-f]{16}$/) })
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('gives a new id when the built app changes, and the same id when it does not', async () => {
    await writePage('index-a1.js')
    const first = buildIdOf(webDir)
    expect(buildIdOf(webDir)).toBe(first)
    await writePage('index-b2.js')
    expect(buildIdOf(webDir)).not.toBe(first)
  })

  it('answers null when no web app is served', async () => {
    expect((await versionFrom(null)).json()).toEqual({ build: null })
  })
})
