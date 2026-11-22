import http from 'node:http'
import type { LookupAddress } from 'node:dns'
import { isIP, type AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  calendarUrl,
  FETCH_TIMEOUT_MS,
  fetchCalendar,
  isLocalHost,
  MAX_CALENDAR_BYTES,
  MAX_REDIRECTS,
  NO_ANSWER,
  type Fetcher,
} from '../src/domain/calendar/feed.js'
import { guardedFetcher } from '../src/domain/calendar/transport.js'
import { AppError } from '../src/errors.js'
import { publicOnly, type Resolver } from '../src/lib/publicAddress.js'

const SECRET = 'https://calendar.example.com/private-abc123/basic.ics'
const CALENDAR = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'

/** A fetch that answers this body and status. */
function answering(
  body: ConstructorParameters<typeof Response>[0],
  init: ResponseInit = {},
): Fetcher {
  return async () => new Response(body, init)
}

/** A fetch that answers each address from this table, a redirect where it says so. */
function routes(table: Record<string, string | { moved: string | null }>) {
  return vi.fn<Fetcher>(async (url) => {
    const route = table[url]
    if (route === undefined) throw new Error(`asked ${url}`)
    if (typeof route === 'string') return new Response(route)
    const headers: Record<string, string> = route.moved === null ? {} : { location: route.moved }
    return new Response(null, { status: 302, headers })
  })
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(AppError)
  // The link is a secret: no failure ever repeats it.
  expect((error as AppError).message).not.toContain('private-abc123')
  return error as AppError
}

describe('calendarUrl', () => {
  const refused = (pasted: string) => {
    try {
      calendarUrl(pasted)
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid_input' })
      return (error as Error).message
    }
    throw new Error(`${pasted} was taken`)
  }

  it('takes an https link, and a webcal link as the same address over https', () => {
    expect(calendarUrl(` ${SECRET} `).href).toBe(SECRET)
    expect(calendarUrl('webcal://p01-caldav.icloud.com/published/2/abc').href).toBe(
      'https://p01-caldav.icloud.com/published/2/abc',
    )
    expect(calendarUrl('WEBCALS://example.com/a.ics').protocol).toBe('https:')
  })

  it('refuses what is not a link, and plain http', () => {
    expect(refused('my calendar')).toMatch(/not a link/)
    expect(refused('http://calendar.example.com/a.ics')).toMatch(/secure/)
    expect(refused('ftp://calendar.example.com/a.ics')).toMatch(/secure/)
  })

  it('refuses links into this machine or its network, however the address is written', () => {
    for (const host of [
      'localhost',
      'localhost.',
      'app.localhost',
      '127.0.0.1',
      '2130706433',
      '10.0.0.2',
      '192.168.1.9',
      '172.20.0.1',
      '169.254.169.254',
      '100.100.100.200',
      '0.0.0.0',
      '[::1]',
      '[::]',
      '[::ffff:127.0.0.1]',
      '[fd00::1]',
      '[fe80::1]',
      '[fec0::1]',
      '192.88.99.1',
      'printer.local',
      'db.internal',
    ]) {
      expect(refused(`https://${host}/a.ics`)).toMatch(/inside your own network/)
    }
  })

  it('takes public names that only look local at first sight', () => {
    for (const host of [
      'localhostcalendar.com',
      '10.example.com',
      'internal.example.com',
      'local.example.org',
      '172.32.0.1',
      '[2606:4700::1111]',
    ]) {
      expect(isLocalHost(calendarUrl(`https://${host}/a.ics`).hostname)).toBe(false)
    }
  })
})

describe('fetchCalendar', () => {
  it('asks for the calendar with one time limit, and returns its text', async () => {
    const fetcher = vi.fn(answering(CALENDAR))
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    expect(await fetchCalendar(new URL(SECRET), fetcher)).toBe(CALENDAR)
    expect(timeout).toHaveBeenCalledWith(FETCH_TIMEOUT_MS)
    expect(fetcher).toHaveBeenCalledWith(
      SECRET,
      expect.objectContaining({ redirect: 'manual', headers: { Accept: 'text/calendar' } }),
    )
    timeout.mockRestore()
  })

  it('says plainly when the calendar does not answer', async () => {
    const error = await failure(
      fetchCalendar(new URL(SECRET), async () => {
        throw new TypeError(`fetch failed for ${SECRET}`)
      }),
    )
    expect(error).toMatchObject({ code: 'calendar_error', status: 502, message: NO_ANSWER })
  })

  it('follows a few redirects, relative ones included, checking each before asking it', async () => {
    const fetcher = routes({
      [SECRET]: { moved: 'https://cdn.example.net/cal.ics' },
      'https://cdn.example.net/cal.ics': { moved: '/final.ics' },
      'https://cdn.example.net/final.ics': CALENDAR,
    })
    expect(await fetchCalendar(new URL(SECRET), fetcher)).toBe(CALENDAR)
    const signals = fetcher.mock.calls.map(([, init]) => init.signal)
    expect(new Set(signals).size).toBe(1)
  })

  it('never asks an address a redirect points off https or into this network', async () => {
    const cases: [string, RegExp | string][] = [
      ['http://127.0.0.1/internal-secret', /not secure/],
      ['https://127.0.0.1/internal-secret', NO_ANSWER],
      ['https://[::ffff:127.0.0.1]/', NO_ANSWER],
      ['https://100.100.100.200/', NO_ANSWER],
      ['https://metadata.internal/', NO_ANSWER],
    ]
    for (const [moved, message] of cases) {
      const fetcher = routes({ [SECRET]: { moved } })
      const error = await failure(fetchCalendar(new URL(SECRET), fetcher))
      expect(error.message).toMatch(message)
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
  })

  it('gives up after MAX_REDIRECTS, and on a redirect that says nowhere', async () => {
    const loop = routes({ [SECRET]: { moved: SECRET } })
    expect((await failure(fetchCalendar(new URL(SECRET), loop))).message).toMatch(/too many/)
    expect(loop).toHaveBeenCalledTimes(MAX_REDIRECTS + 1)
    for (const moved of [null, 'https://[broken']) {
      const fetcher = routes({ [SECRET]: { moved } })
      const error = await failure(fetchCalendar(new URL(SECRET), fetcher))
      expect(error.message).toMatch(/could not be read/)
    }
  })

  it('tells a refused link apart from a calendar that is down', async () => {
    for (const status of [401, 403, 404]) {
      const error = await failure(fetchCalendar(new URL(SECRET), answering('no', { status })))
      expect(error.message).toMatch(/refused that link/)
    }
    const down = await failure(fetchCalendar(new URL(SECRET), answering('no', { status: 503 })))
    expect(down.message).toMatch(/try again later/i)
    const bare = await failure(fetchCalendar(new URL(SECRET), answering(null, { status: 500 })))
    expect(bare.message).toMatch(/try again later/i)
  })

  it('refuses a calendar over the size cap rather than cut it off', async () => {
    const chunk = new Uint8Array(512 * 1024).fill(65)
    let sent = 0
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength
        controller.enqueue(chunk)
      },
    })
    const error = await failure(fetchCalendar(new URL(SECRET), answering(endless)))
    expect(error.message).toMatch(/too large/)
    // It stopped reading soon after the cap.
    expect(sent).toBeLessThan(MAX_CALENDAR_BYTES + 2 * chunk.byteLength)
  })

  it('takes a body cut off by the time limit as no answer, not a crash', async () => {
    const cut = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('BEGIN:VCALENDAR\r\n'))
      },
      pull(controller) {
        controller.error(new DOMException('This operation was aborted', 'AbortError'))
      },
    })
    const error = await failure(fetchCalendar(new URL(SECRET), answering(cut)))
    expect(error.message).toBe(NO_ANSWER)
  })

  it('refuses what is not a calendar, an empty answer included', async () => {
    const page = await failure(fetchCalendar(new URL(SECRET), answering('<html>Sign in</html>')))
    expect(page.message).toMatch(/not a calendar/)
    await failure(fetchCalendar(new URL(SECRET), answering(null)))
  })

  it('connects only to public addresses when given no fetch of its own', async () => {
    const error = await failure(fetchCalendar(new URL('https://127.0.0.1:1/a.ics')))
    expect(error.message).toBe(NO_ANSWER)
  })
})

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
