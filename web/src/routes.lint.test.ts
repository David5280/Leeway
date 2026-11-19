// The lint rule (eslint.config.js) that keeps every <Route> path in routes.ts,
// so a screen cannot reach the router without the phone layout guard seeing it.

import { ESLint } from 'eslint'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The repository root. Read from the file's own path as a string, since jsdom's
// URL class does not make file URLs.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const eslint = new ESLint({ cwd: ROOT })

/** The messages the route rule gives for one line of JSX in a file at `file`. */
async function routeProblems(route: string, file = 'web/src/App.tsx') {
  const code = `import { Route } from 'react-router-dom'\nexport const route = ${route}\n`
  const [result] = await eslint.lintText(code, { filePath: join(ROOT, file) })
  return result.messages.filter((message) => message.ruleId === 'no-restricted-syntax')
}

describe('a <Route> path', () => {
  it.each([
    ['a quoted address', '<Route path="/reports" element={null} />'],
    ['a string in braces', "<Route path={'/reports'} element={null} />"],
    ['a template', '<Route path={`/reports`} element={null} />'],
    ['a name from another list', '<Route path={PAGES.reports} element={null} />'],
  ])('is refused when it is %s', async (_, route) => {
    const problems = await routeProblems(route)
    expect(problems).toHaveLength(1)
    expect(problems[0].message).toMatch(/path from routes\.ts/)
  })

  it.each([
    ['a screen route', '<Route path={SCREEN_ROUTES.alerts} element={null} />'],
    ['a connect route', '<Route path={CONNECT_ROUTES.connect} element={null} />'],
    ['any route', '<Route path={ROUTES.overview} element={null} />'],
    ['the catch-all', '<Route path="*" element={null} />'],
  ])('is allowed when it is %s', async (_, route) => {
    expect(await routeProblems(route)).toEqual([])
  })

  it('may be written out in tests, which mount one screen at a known address', async () => {
    const route = '<Route path="/reports" element={null} />'
    expect(await routeProblems(route, 'web/src/pages/reports.test.tsx')).toEqual([])
    expect(await routeProblems(route, 'web/src/test/reports.tsx')).toEqual([])
  })
})
