// The web app imports a few server modules for their constants and pure
// helpers (thresholds, wording, date math), and the bundler follows every
// value import from there. One that reaches the database layer pulls the
// Node-only pg driver into the browser, where it throws on load and leaves a
// blank page. This walks the imports the bundler does, from the app's entry,
// and keeps that from happening again.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** The web app's entry, as web/index.html loads it. */
const WEB_ENTRY = join(ROOT, 'web', 'src', 'main.tsx')

/** The server's database layer, which every module that queries imports. */
const DATABASE_LAYER = join(ROOT, 'server', 'src', 'db')

/** Packages that only run on a server: reaching one from the web app breaks it. */
const SERVER_ONLY_PACKAGES = ['pg', 'fastify', '@anthropic-ai/sdk', '@modelcontextprotocol/sdk']

/**
 * Every module a file imports for a value, as the bundler keeps them.
 * Type-only imports and exports (`import type`, `export type`) are erased, so
 * they are skipped; one with a value beside a type (`import { a, type B }`) is not.
 */
function valueImports(source: string): string[] {
  const statements = source.matchAll(
    /^\s*(?:import|export)\s+(type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm,
  )
  return [...statements].filter(([, typeOnly]) => !typeOnly).map(([, , specifier]) => specifier!)
}

/** A relative import as the file it names, .js written for .ts as the server does. */
function resolveFile(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier)
  const candidates = [
    base.replace(/\.js$/, '.ts'),
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    base,
  ]
  return candidates.find((path) => existsSync(path) && statSync(path).isFile()) ?? null
}

/** A source file the bundle takes in, reached through `chain` from the entry. */
type Chain = string[]

/** A file's value imports: the source files to follow, and any server-only package it names. */
function importsOf(file: string): { files: string[]; serverOnly: string[] } {
  const specifiers = valueImports(readFileSync(file, 'utf8'))
  const files = specifiers
    .filter((specifier) => specifier.startsWith('.'))
    .map((specifier) => resolveFile(file, specifier))
    .filter((next) => next !== null)
  const serverOnly = specifiers.filter((specifier) =>
    SERVER_ONLY_PACKAGES.some((name) => specifier === name || specifier.startsWith(`${name}/`)),
  )
  return { files, serverOnly }
}

/**
 * Walks the bundle from the entry: every file it takes in (`bundled`), and
 * what it would take in that a browser cannot run (`offences`), each as the
 * chain of imports from the entry to the file that reaches it.
 */
function walkBundle(): { bundled: Set<string>; offences: string[] } {
  const offences: string[] = []
  const bundled = new Set<string>()
  const queue: Chain[] = [[WEB_ENTRY]]
  const named = (chain: Chain, what: string) =>
    `${chain.map((file) => relative(ROOT, file)).join(' > ')} reaches ${what}`
  while (queue.length > 0) {
    const chain = queue.shift()!
    const file = chain.at(-1)!
    if (bundled.has(file)) continue
    bundled.add(file)
    if (file.startsWith(DATABASE_LAYER)) {
      offences.push(named(chain, 'the database layer'))
      continue
    }
    // Stylesheets, fonts and pictures are bundled too, but import nothing to follow.
    if (!/\.tsx?$/.test(file)) continue
    const { files, serverOnly } = importsOf(file)
    offences.push(...serverOnly.map((name) => named(chain, name)))
    queue.push(...files.map((next) => [...chain, next]))
  }
  return { bundled, offences }
}

describe('server modules the web app bundles', () => {
  it('reads value and type imports apart', () => {
    const source = [
      "import { a, type B } from './mixed.js'",
      "import type { C } from './types.js'",
      "export type { D } from './more.js'",
      "export { e } from './values.js'",
      "import './sideEffect.js'",
      "import pg from 'pg'",
      '  const text = "not an import from \'./nowhere.js\'"',
    ].join('\n')
    expect(valueImports(source)).toEqual(['./mixed.js', './values.js', './sideEffect.js', 'pg'])
  })

  const { bundled, offences } = walkBundle()

  it('are found by following the app from its entry', () => {
    // Alerts.tsx bundles the leak thresholds, so the walk must arrive there.
    expect(bundled).toContain(join(ROOT, 'server', 'src', 'domain', 'leaks', 'priceRises.ts'))
  })

  it('never reach the database or a server-only package', () => {
    expect(offences).toEqual([])
  })
})
