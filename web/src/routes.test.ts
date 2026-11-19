// The router's address list (routes.ts).

import { describe, expect, it } from 'vitest'
import { CONNECT_ROUTES, ROUTES, SCREEN_ROUTES } from './routes'

describe('the route list', () => {
  it('gives every route its own address, from the root', () => {
    const addresses = Object.values(ROUTES)
    expect(new Set(addresses).size).toBe(addresses.length)
    for (const address of addresses) expect(address).toMatch(/^\//)
  })

  it('holds the screens and the connect routes, and nothing else', () => {
    expect(Object.keys(ROUTES)).toEqual([
      ...Object.keys(SCREEN_ROUTES),
      ...Object.keys(CONNECT_ROUTES),
    ])
  })
})
