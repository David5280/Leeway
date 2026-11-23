// The guard on outgoing fetches: which addresses Leeway will never connect to.
//
// This list is deliberately broad and is for fetching only. Whether a
// connecting client is a trusted local proxy is a different question with a
// much narrower answer (see localAddress.ts): a range can be wrong to fetch
// from yet still hold real public clients, like Teredo or 6to4 users.

import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { inRanges, rangeList } from './addressRanges.js'

const NEVER_FETCH = rangeList({
  // Private, loopback, link-local, shared (CGNAT), documentation, multicast and reserved.
  ipv4: [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ],
  // IPv6 forms that carry an IPv4 address inside (NAT64, 6to4, Teredo, the old
  // "compatible" form) are refused whole: they could reach a private IPv4
  // network through a gateway, and no app's details live there.
  ipv6: [
    ['::', 96],
    ['::ffff:0:0:0', 96], // IPv4-translated (SIIT), which a translator could carry inward
    ['64:ff9b::', 96],
    ['64:ff9b:1::', 48],
    ['100::', 64],
    ['2001::', 32],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
  ],
})

/**
 * Whether outgoing fetches may connect to this address. Anything that cannot
 * be judged, such as a mapped address in a rare spelling, is refused.
 */
export function isFetchableAddress(address: string): boolean {
  return inRanges(NEVER_FETCH, address) === false
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void

/**
 * A drop-in for dns.lookup that refuses any host resolving to a non-public
 * address. Used as the connection's own lookup, so the address checked is the
 * address connected to, with no gap for DNS rebinding in between.
 */
export function publicOnlyLookup(
  hostname: string,
  options: { all?: boolean },
  callback: LookupCallback,
): void {
  dnsLookup(hostname, { all: true }, (error, addresses) => {
    if (error) return callback(error, [])
    const blocked = addresses.find((entry) => !isFetchableAddress(entry.address))
    if (blocked) {
      const refused: NodeJS.ErrnoException = new Error(`${hostname} is not a public address`)
      refused.code = 'EADDRNOTPUBLIC'
      return callback(refused, [])
    }
    if (options.all) return callback(null, addresses)
    callback(null, addresses[0]!.address, addresses[0]!.family)
  })
}
