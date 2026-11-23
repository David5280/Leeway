// Shared plumbing for lists of IP ranges: building one, and asking whether an address is in it.

import { BlockList, isIP } from 'node:net'

export type Subnet = readonly [network: string, prefix: number]

export interface RangeSpec {
  ipv4: readonly Subnet[]
  ipv6: readonly Subnet[]
}

/** Builds a lookup list from IPv4 and IPv6 subnets. */
export function rangeList({ ipv4, ipv6 }: RangeSpec): BlockList {
  const list = new BlockList()
  for (const [network, prefix] of ipv4) list.addSubnet(network, prefix, 'ipv4')
  for (const [network, prefix] of ipv6) list.addSubnet(network, prefix, 'ipv6')
  return list
}

/** Every IPv4-mapped IPv6 address, however it is spelled. */
const MAPPED = rangeList({ ipv4: [], ipv6: [['::ffff:0:0', 96]] })

/** Node writes an IPv4 peer on a dual-stack socket like this: ::ffff:10.0.0.1. */
const DOTTED_MAPPED = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i

/**
 * Whether an address falls in a list, with IPv4-mapped IPv6 judged as the
 * IPv4 address inside it, so ::ffff:10.0.0.1 answers the same as 10.0.0.1.
 *
 * Answers null when the address cannot be judged: it is not an IP address, or
 * it is a mapped address in a rarer spelling (::ffff:a00:1). Each caller turns
 * null into its own safe answer: never fetch it, and never trust it as a proxy.
 */
export function inRanges(list: BlockList, address: string): boolean | null {
  const family = isIP(address)
  if (family === 4) return list.check(address, 'ipv4')
  if (family !== 6) return null
  const dotted = DOTTED_MAPPED.exec(address)
  if (dotted) return inRanges(list, dotted[1]!)
  if (MAPPED.check(address, 'ipv6')) return null
  return list.check(address, 'ipv6')
}
