// Fetching the owner's calendar from the private link they pasted. The link
// is a secret (anyone holding it can read the calendar), so it is checked
// here, fetched only over HTTPS and only from public addresses, with a time
// limit and a size cap, and never put in an error message or a log line.

import { isIP } from 'node:net'
import { AppError } from '../../errors.js'
import { isFetchableAddress } from '../../lib/publicAddress.js'
import { guardedFetch, type Fetcher } from './transport.js'

export type { Fetcher } from './transport.js'

/** The longest a whole read may take, every redirect and the body included. */
export const FETCH_TIMEOUT_MS = 10_000

/** The largest calendar read, in bytes: years of events fit well inside. */
export const MAX_CALENDAR_BYTES = 2_000_000

/** The most redirects followed before the link is given up on. */
export const MAX_REDIRECTS = 3

/** Statuses that move the calendar to another address. */
const REDIRECTS = new Set([301, 302, 303, 307, 308])

/**
 * What the owner is told when the calendar cannot be reached. It is the same
 * whatever the reason (no such host, a closed port, a private address, a
 * timeout), so the answer says nothing about what lies behind an address.
 */
export const NO_ANSWER = 'The calendar did not answer. Check the link, or try again later.'
const NOT_SECURE = 'The calendar link moved to an address that is not secure, so it was not read.'
const UNREADABLE = 'The calendar could not be read just now. Try again later.'

/**
 * True for a host that is this machine or its own network: a name like
 * localhost, printer.local or db.internal, or an address that is not public
 * (private, loopback, link-local, carrier-grade NAT, unspecified, or an IPv4
 * address written as IPv6). A name that only starts like one, such as
 * localhostcalendar.com or 10.example.com, is a public name.
 */
export function isLocalHost(hostname: string): boolean {
  // URL keeps an IPv6 host in brackets, and a name may end in the root's dot.
  const host = hostname.replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '')
  if (isIP(host)) return !isFetchableAddress(host)
  return /^localhost$|\.(localhost|local|internal)$/i.test(host)
}

/**
 * A pasted calendar link as the https address to fetch. A webcal:// link (what
 * Apple and Google hand out) is the same address over https. Anything else,
 * plain http included, is refused, as is a link to this machine's network.
 */
export function calendarUrl(pasted: string): URL {
  const text = pasted.trim().replace(/^webcals?:\/\//i, 'https://')
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new AppError('invalid_input', 'That is not a link. Paste the calendar’s full address.')
  }
  if (url.protocol !== 'https:') {
    throw new AppError('invalid_input', 'Use a secure calendar link, one starting with https.')
  }
  if (isLocalHost(url.hostname)) {
    throw new AppError(
      'invalid_input',
      'That link points inside your own network. Use the calendar’s public link.',
    )
  }
  return url
}

/** The failure to tell the owner, never with the link in it. */
function failure(message: string): AppError {
  return new AppError('calendar_error', message)
}

/** The next chunk of the body; a body cut off (a timeout, a dropped connection) did not answer. */
async function nextChunk(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    return await reader.read()
  } catch {
    throw failure(NO_ANSWER)
  }
}

/** The body, read up to the size cap; a longer one is refused rather than cut off. */
async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await nextChunk(reader)
    if (done) break
    size += value.byteLength
    if (size > MAX_CALENDAR_BYTES) {
      await reader.cancel()
      throw failure('That calendar is too large to read. Try a calendar with fewer events.')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** One request; any failure to get an answer at all is the same plain failure. */
async function request(url: URL, fetcher: Fetcher, signal: AbortSignal): Promise<Response> {
  try {
    return await fetcher(url.href, {
      headers: { Accept: 'text/calendar' },
      redirect: 'manual',
      signal,
    })
  } catch {
    throw failure(NO_ANSWER)
  }
}

/**
 * Where a redirect points, checked as the pasted link was: https only, and
 * never into this machine's network. The connection's own lookup then checks
 * the address a name resolves to, as on the first hop.
 */
function nextHop(from: URL, location: string | null): URL {
  if (!location) throw failure(UNREADABLE)
  let next: URL
  try {
    next = new URL(location, from)
  } catch {
    throw failure(UNREADABLE)
  }
  if (next.protocol !== 'https:') throw failure(NOT_SECURE)
  if (isLocalHost(next.hostname)) throw failure(NO_ANSWER)
  return next
}

/** The calendar's text from a final answer, or why it cannot be read. */
async function calendarText(response: Response): Promise<string> {
  if (!response.ok) {
    await response.body?.cancel()
    throw failure(
      response.status === 404 || response.status === 401 || response.status === 403
        ? 'The calendar refused that link. Copy its private or secret address again.'
        : UNREADABLE,
    )
  }
  const text = await readCapped(response)
  if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 2000))) {
    throw failure('That link is not a calendar. Use the link that ends in .ics.')
  }
  return text
}

/**
 * The calendar's text. Up to MAX_REDIRECTS redirects are followed, each one
 * checked before it is asked, all within one time limit. Every failure is
 * said plainly, without the link.
 */
export async function fetchCalendar(url: URL, fetcher: Fetcher = guardedFetch): Promise<string> {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  let current = url
  for (let hop = 0; ; hop++) {
    const response = await request(current, fetcher, signal)
    if (!REDIRECTS.has(response.status)) return calendarText(response)
    await response.body?.cancel()
    if (hop === MAX_REDIRECTS) {
      throw failure('The calendar link moved too many times, so it was not read.')
    }
    current = nextHop(current, response.headers.get('location'))
  }
}
