// Every server module loads on its own, whichever module in an import cycle
// is loaded first.
//
// Some modules import each other in a loop (accounts.ts and categorize.ts,
// say). That is harmless while they only use each other inside functions, but
// a value used while a module loads, like a zod schema built from another
// module's schema, is still undefined when the loop is entered from the wrong
// end. A test file only trips over that when it happens to import that end
// first, so a cycle can pass every test and still break the app or a later
// test. This loads each module first, in a fresh module graph, and checks it
// loads with every export defined.

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

/** Process entry points: they start servers or read the command line when loaded. */
const ENTRY_POINTS = new Set(['index.ts', 'db/migrate-cli.ts'])

const modules = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .map((path) => path.replaceAll('\\', '/'))
  .filter((path) => path.endsWith('.ts') && !path.endsWith('.d.ts'))
  .filter((path) => !ENTRY_POINTS.has(path) && !path.startsWith('cli/'))
  .sort()

describe('loading each module first', () => {
  // A fresh graph per module, so nothing an earlier import loaded hides the order.
  beforeEach(() => {
    vi.resetModules()
  })

  it('finds the modules to load', () => {
    // Guards the walk itself: an empty list would pass every check below.
    expect(modules).toContain('domain/paystubs/pension.ts')
  })

  it.each(modules)('%s', async (path) => {
    const loaded: Record<string, unknown> = await import(/* @vite-ignore */ join(SRC, path))
    // Vitest reads a binding still loading as undefined rather than throwing.
    const undefinedExports = Object.keys(loaded).filter((name) => loaded[name] === undefined)
    expect(undefinedExports).toEqual([])
  })
})
