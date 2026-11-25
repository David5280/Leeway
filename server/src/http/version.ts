// Which build of the web app this server is serving, so an installed app left
// open can tell a deploy happened and load it (web/src/lib/update/buildCheck.ts).

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'

/**
 * A short id for the built web app: a hash of its index.html, which names
 * every script and stylesheet by content hash, so any change to the app
 * changes it. Null when no web app is served (development, tests).
 */
export function buildIdOf(webDir: string | null): string | null {
  if (!webDir) return null
  const page = readFileSync(join(webDir, 'index.html'))
  return createHash('sha256').update(page).digest('hex').slice(0, 16)
}

/**
 * GET /api/version, open to anyone: the build id and nothing else. It is
 * read once at start; like every API answer it is never cached
 * (securityHeaders.ts), so a resumed app always sees the running build.
 */
export function registerVersionRoute(app: FastifyInstance, webDir: string | null): void {
  const build = buildIdOf(webDir)
  app.get('/api/version', async () => ({ build }))
}
