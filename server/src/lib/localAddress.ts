// Which connecting addresses can be a reverse proxy on the same machine or private network.
//
// This is NOT the inverse of the fetch guard in publicAddress.ts. That list
// refuses anything that might reach a private network, including Teredo
// (2001::/32), 6to4 (2002::/16) and NAT64 (64:ff9b::/96). Those are real
// public clients, though, and trusting them as a proxy would let them write
// their own X-Forwarded-For and dodge per-address rate limits. So only ranges
// that never arrive straight from the internet are listed here.

import { inRanges, rangeList } from './addressRanges.js'

const LOCAL_PROXY = rangeList({
  ipv4: [
    ['127.0.0.0', 8], // loopback: a proxy on this machine
    ['10.0.0.0', 8], // RFC 1918 private networks, Docker bridges included
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['169.254.0.0', 16], // link-local
    // Shared address space (RFC 6598) is not routed on the public internet.
    // Overlay networks like Tailscale use it, so a proxy on another node of
    // the owner's own tailnet is believed.
    ['100.64.0.0', 10],
  ],
  ipv6: [
    ['::1', 128], // loopback
    ['fc00::', 7], // unique local addresses, IPv6's private networks
    ['fe80::', 10], // link-local
  ],
})

/**
 * Whether an address can be a trusted local proxy. Anything that cannot be
 * judged, such as a mapped address in a rare spelling, is not trusted.
 */
export function isLocalProxyAddress(address: string): boolean {
  return inRanges(LOCAL_PROXY, address) === true
}
