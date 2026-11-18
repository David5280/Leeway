// Telling public internet addresses from private ones: for outgoing fetches and for trusting proxies.

import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { BlockList, isIP } from 'node:net'

/** Addresses that are not on the public internet: private, loopback, link-local and reserved ranges. */
const PRIVATE = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  PRIVATE.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  PRIVATE.addSubnet(network, prefix, 'ipv6')
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !PRIVATE.check(address, 'ipv4')
  if (family !== 6) return false
  // An IPv4 address written as IPv6 (::ffff:10.0.0.1) is judged as the IPv4 address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
  if (mapped) return isPublicAddress(mapped[1]!)
  return !PRIVATE.check(address, 'ipv6')
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
    const blocked = addresses.find((entry) => !isPublicAddress(entry.address))
    if (blocked) {
      const refused: NodeJS.ErrnoException = new Error(`${hostname} is not a public address`)
      refused.code = 'EADDRNOTPUBLIC'
      return callback(refused, [])
    }
    if (options.all) return callback(null, addresses)
    callback(null, addresses[0]!.address, addresses[0]!.family)
  })
}
