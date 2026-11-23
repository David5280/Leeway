// The one way a calendar is fetched: a single HTTPS GET that only ever
// connects to a public address. The check runs inside the connection's own
// DNS lookup, so the address checked is the address connected to and a host
// that changes its answer between two lookups (DNS rebinding) gains nothing.
// Redirects are never followed here; fetchCalendar checks each hop itself.

import type { IncomingMessage } from 'node:http'
import https from 'node:https'
import { Readable } from 'node:stream'
import { checkAddressLiteral, publicOnlyLookup } from '../../lib/publicAddress.js'

/** Fetch, as the global one, answering a redirect as it is rather than following it. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

export interface TransportOptions {
  /** The request maker; tests swap in plain http, served on this machine. */
  transport?: Pick<typeof https, 'request'>
  /** The DNS lookup each connection makes; public addresses only, unless a test says otherwise. */
  lookup?: typeof publicOnlyLookup
}

/** Statuses whose answer has no body, which a Response refuses to be given one for. */
const NO_BODY = new Set([204, 205, 304])

/** Node's answer as a web Response, its body streamed rather than read up front. */
function toResponse(answer: IncomingMessage): Response {
  const status = answer.statusCode!
  const headers = new Headers()
  // Raw headers come as name, value, name, value, with repeats kept.
  for (let i = 0; i < answer.rawHeaders.length; i += 2) {
    headers.append(answer.rawHeaders[i]!, answer.rawHeaders[i + 1]!)
  }
  if (NO_BODY.has(status)) {
    answer.resume()
    return new Response(null, { status, headers })
  }
  const body = Readable.toWeb(answer) as unknown as ReadableStream<Uint8Array>
  return new Response(body, { status, headers })
}

/** A Fetcher that connects only to public addresses and follows no redirect. */
export function guardedFetcher({
  transport = https,
  lookup = publicOnlyLookup,
}: TransportOptions = {}): Fetcher {
  return async (url, init) => {
    await checkAddressLiteral(url, lookup)
    return new Promise<Response>((resolve, reject) => {
      const request = transport.request(
        url,
        {
          method: 'GET',
          lookup,
          headers: Object.fromEntries(new Headers(init.headers)),
          signal: init.signal ?? undefined,
        },
        (answer) => {
          // A status the web's Response cannot hold (above 599) is a failure, not a crash.
          try {
            resolve(toResponse(answer))
          } catch (error) {
            answer.destroy()
            reject(error as Error)
          }
        },
      )
      request.on('error', reject)
      request.end()
    })
  }
}

/** The fetcher calendars are read with when nothing else is given. */
export const guardedFetch = guardedFetcher()
