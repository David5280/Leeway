// The guarded connection a calendar is fetched over, against a real server
// on this machine: it connects only to public addresses, follows redirects
// only to them, and reads a dropped or empty answer as a failure.

import http from 'node:http'
import type { LookupAddress } from 'node:dns'
import { isIP, type AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchCalendar, MAX_REDIRECTS, NO_ANSWER } from '../src/domain/calendar/feed.js'
import { guardedFetcher } from '../src/domain/calendar/transport.js'
import { publicOnly, type Resolver } from '../src/lib/publicAddress.js'
import { CALENDAR, failure } from './fixtures/calendarFetch.js'

describe('the guarded connection', () => {
  // A calendar server on this machine, standing in for the internet. It counts
  // every request, so a test can tell an address was never asked at all.
  let server: http.Server
  let port: number
  let closedPort: number
  const hits: string[] = []
  const accepts: (string | undefined)[] = []
  let release: (() => void) | null = null

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      hits.push(request.url!)
      accepts.push(request.headers.accept)
      const at = (path: string) => `https://calendar.test:${port}${path}`
      const routes: Record<string, () => void> = {
        '/cal': () => response.end(CALENDAR),
        '/moved': () => response.writeHead(302, { location: '/cal' }).end('moved'),
        '/loop': () => response.writeHead(302, { location: at('/loop') }).end(),
        '/to-http': () =>
          response.writeHead(302, { location: `http://127.0.0.1:${port}/secret` }).end(),
        '/to-loopback': () =>
          response.writeHead(302, { location: `https://127.0.0.1:${port}/secret` }).end(),
        '/to-rebind': () =>
          response.writeHead(302, { location: `https://rebind.test:${port}/secret` }).end(),
        '/empty': () => response.writeHead(204).end(),
        '/odd': () => response.writeHead(999).end(),
        '/cut': () => {
          response.write('BEGIN:VCALENDAR\r\n')
          setTimeout(() => response.socket?.destroy(), 20)
        },
        '/stall': () => {
          response.write('BEGIN:VCALENDAR\r\n')
          // The time limit runs out once the calendar has started to arrive.
          setTimeout(() => release?.(), 50)
        },
      }
      ;(routes[request.url!] ?? (() => response.writeHead(404).end()))()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
    // A port that was open a moment ago and now refuses connections.
    const closed = http.createServer()
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve))
    closedPort = (closed.address() as AddressInfo).port
    await new Promise((resolve) => closed.close(resolve))
  })
  afterAll(() => {
    server.closeAllConnections()
    server.close()
  })
  beforeEach(() => {
    hits.length = 0
    accepts.length = 0
  })

  /** Stand-in DNS: names that resolve, by design, to this machine or a private network. */
  const resolver: Resolver = (hostname, _options, callback) => {
    const table: Record<string, string[]> = {
      'rebind.test': ['127.0.0.1'],
      'mixed.test': ['8.8.8.8', '10.0.0.1'],
    }
    // An address resolves to itself, as the real DNS does.
    const addresses = isIP(hostname) ? [hostname] : table[hostname]
    if (!addresses)
      return callback(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }), [])
    callback(
      null,
      addresses.map((address): LookupAddress => ({ address, family: 4 })),
    )
  }
  const guarded = publicOnly(resolver)

  // calendar.test is the one name let through to this machine, standing in for
  // a public calendar host; every other name goes through the real guard.
  const lookup: typeof guarded = (hostname, options, callback) => {
    if (hostname !== 'calendar.test') return guarded(hostname, options, callback)
    if (options.all) return callback(null, [{ address: '127.0.0.1', family: 4 }])
    callback(null, '127.0.0.1', 4)
  }

  // The test server speaks plain http, so each https address is asked over http.
  const transport = {
    request: (
      url: string,
      options: http.RequestOptions,
      callback: (response: http.IncomingMessage) => void,
    ) => http.request(url.replace(/^https:/, 'http:'), options, callback),
  }
  const fetcher = guardedFetcher({ transport: transport as never, lookup })
  const read = (path: string, host = 'calendar.test') =>
    fetchCalendar(new URL(`https://${host}:${port}${path}`), fetcher)

  it('reads a calendar through a redirect, asking for a calendar each time', async () => {
    expect(await read('/moved')).toBe(CALENDAR)
    expect(hits).toEqual(['/moved', '/cal'])
    expect(accepts).toEqual(['text/calendar', 'text/calendar'])
    // Asked directly, with no headers or time limit of its own, it answers as fetch would.
    expect((await fetcher(`https://calendar.test:${port}/moved`, {})).status).toBe(302)
  })

  it('never asks a private address a redirect points to', async () => {
    expect((await failure(read('/to-http'))).message).toMatch(/not secure/)
    expect((await failure(read('/to-loopback'))).message).toBe(NO_ANSWER)
    // A public-looking name that resolves to this machine is refused as it connects.
    expect((await failure(read('/to-rebind'))).message).toBe(NO_ANSWER)
    expect(hits).not.toContain('/secret')
  })

  it('refuses a name with any private address among its public ones', async () => {
    expect((await failure(read('/cal', 'mixed.test'))).message).toBe(NO_ANSWER)
    expect(hits).toEqual([])
  })

  it('says the same for a closed port, no such host and a private address', async () => {
    const closed = fetchCalendar(new URL(`https://calendar.test:${closedPort}/cal`), fetcher)
    const messages = await Promise.all([
      failure(closed),
      failure(read('/cal', 'nowhere.test')),
      failure(read('/cal', 'rebind.test')),
    ])
    expect(new Set(messages.map((error) => error.message))).toEqual(new Set([NO_ANSWER]))
  })

  it('refuses an address written as an IP before connecting, even asked directly', async () => {
    await expect(fetcher(`https://127.0.0.1:${port}/cal`, {})).rejects.toThrow(/not a public/)
    expect(hits).toEqual([])
  })

  it('stops following a redirect loop after MAX_REDIRECTS', async () => {
    expect((await failure(read('/loop'))).message).toMatch(/too many/)
    expect(hits).toHaveLength(MAX_REDIRECTS + 1)
  })

  it('reads an answer with no body, or a status no browser knows, as a failure', async () => {
    expect((await failure(read('/empty'))).message).toMatch(/not a calendar/)
    expect((await failure(read('/odd'))).message).toBe(NO_ANSWER)
  })

  it('takes a connection dropped or timed out mid-calendar as no answer', async () => {
    expect((await failure(read('/cut'))).message).toBe(NO_ANSWER)
    const deadline = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    release = () => deadline.abort(new DOMException('The operation timed out.', 'TimeoutError'))
    expect((await failure(read('/stall'))).message).toBe(NO_ANSWER)
    timeout.mockRestore()
    release = null
  })
})
