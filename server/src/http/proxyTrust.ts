// Which proxies Leeway believes about the client's address and the https it came in on.

import { isLocalProxyAddress } from '../lib/localAddress.js'

/**
 * How far to trust X-Forwarded-For, -Proto and -Host:
 * - 'private-network': one proxy, and only when it connects from a local
 *   address (loopback, private or link-local; see localAddress.ts), the way a
 *   reverse proxy on the same machine or network does.
 * - a number: that many proxies in front, wherever they connect from (0 is none).
 */
export type ProxyTrust = 'private-network' | number

/**
 * A trust function for Fastify's trustProxy. It is called for each address
 * on the way back from Leeway to the client: hop 0 is the connection itself,
 * hop 1 the address the nearest proxy recorded, and so on. The client's
 * address is the first one not trusted, so a client that writes its own
 * X-Forwarded-For only ever adds entries past the trusted hops, which are
 * never read. Trusting everything would take the leftmost entry, which the
 * client chooses, and per-address rate limits could then be dodged.
 */
export function proxyTrustFunction(trust: ProxyTrust): (address: string, hop: number) => boolean {
  if (trust === 'private-network') {
    return (address, hop) => hop === 0 && isLocalProxyAddress(address)
  }
  return (_address, hop) => hop < trust
}
