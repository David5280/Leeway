// Per-address rate limits for routes anyone on the internet can reach.

/**
 * Route options that allow one address at most `max` requests a minute; past
 * that it gets a 429 until the minute is up. The address is the client's own
 * as proxyTrust.ts works it out, so a client cannot dodge the limit by
 * claiming another one.
 */
export function perMinute(max: number) {
  return { config: { rateLimit: { max, timeWindow: '1 minute' } } }
}
