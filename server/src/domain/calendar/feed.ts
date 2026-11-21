// Fetching the owner's calendar from the private link they pasted. The link
// is a secret (anyone holding it can read the calendar), so it is checked
// here, fetched only over HTTPS, with a time limit and a size cap, and never
// put in an error message or a log line.

import { AppError } from '../../errors.js'

/** The longest a fetch may take. */
export const FETCH_TIMEOUT_MS = 10_000

/** The largest calendar read, in bytes: years of events fit well inside. */
export const MAX_CALENDAR_BYTES = 2_000_000

/** Fetch, as the global one; tests pass their own. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

/** Hosts that are this machine or its own network, which a calendar link never needs. */
const PRIVATE_HOST =
  /^(localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)/i

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
  if (PRIVATE_HOST.test(url.hostname)) {
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

/** The body, read up to the size cap; a longer one is refused rather than cut off. */
async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
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

/**
 * The calendar's text. Redirects are followed only when they stay on https.
 * Every failure is said plainly, without the link.
 */
export async function fetchCalendar(url: URL, fetcher: Fetcher = fetch): Promise<string> {
  let response: Response
  try {
    response = await fetcher(url.href, {
      headers: { Accept: 'text/calendar' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch {
    throw failure('The calendar did not answer. Check the link, or try again later.')
  }
  if (response.url && !response.url.startsWith('https://')) {
    throw failure('The calendar link moved to an address that is not secure, so it was not read.')
  }
  if (!response.ok) {
    throw failure(
      response.status === 404 || response.status === 401 || response.status === 403
        ? 'The calendar refused that link. Copy its private or secret address again.'
        : 'The calendar could not be read just now. Try again later.',
    )
  }
  const text = await readCapped(response)
  if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 2000))) {
    throw failure('That link is not a calendar. Use the link that ends in .ics.')
  }
  return text
}
