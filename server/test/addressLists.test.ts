import { describe, expect, it } from 'vitest'
import { inRanges, rangeList } from '../src/lib/addressRanges.js'
import { isLocalProxyAddress } from '../src/lib/localAddress.js'
import { isFetchableAddress } from '../src/lib/publicAddress.js'

// Real public clients that the fetch guard refuses but that must never pass as a proxy.
const TUNNELLED_CLIENTS = [
  '2001:0:4136:e378:8000:63bf:3fff:fdd2', // Teredo
  '2002:c000:204::1', // 6to4
  '2002:a00:1::1', // 6to4 wrapping 10.0.0.1, still a stranger on the internet
  '64:ff9b::808:808', // NAT64
  '64:ff9b::a00:1',
  '64:ff9b:1::1', // local-use NAT64
]

describe('the fetch guard', () => {
  it('refuses an address in every range it has always refused', () => {
    for (const address of [
      // IPv4: the start, an inside point and the end of each range.
      '0.0.0.0',
      '0.255.255.255',
      '10.0.0.0',
      '10.255.255.255',
      '100.64.0.0',
      '100.127.255.255',
      '127.0.0.1',
      '127.255.255.255',
      '169.254.169.254',
      '172.16.0.0',
      '172.31.255.255',
      '192.0.0.8',
      '192.0.2.1',
      '192.168.0.1',
      '198.18.0.0',
      '198.19.255.255',
      '198.51.100.7',
      '203.0.113.9',
      '224.0.0.1',
      '239.255.255.255',
      '240.0.0.1',
      '255.255.255.255',
      // IPv6.
      '::',
      '::1',
      '::10.0.0.1',
      '100::1',
      '2001:db8::1',
      'fc00::1',
      'fdff:ffff::1',
      'fe80::1',
      'febf::1',
      'fec0::1', // retired site-local
      'feff:ffff::1',
      'ff02::1',
      '192.88.99.1', // the old 6to4 relays' shared address
      ...TUNNELLED_CLIENTS,
    ]) {
      expect(isFetchableAddress(address), address).toBe(false)
    }
  })

  it('judges an IPv4-mapped address as its IPv4 address, and refuses rare spellings', () => {
    expect(isFetchableAddress('::ffff:8.8.8.8')).toBe(true)
    expect(isFetchableAddress('::FFFF:8.8.8.8')).toBe(true)
    expect(isFetchableAddress('::ffff:10.0.0.1')).toBe(false)
    expect(isFetchableAddress('::ffff:a00:1')).toBe(false)
    expect(isFetchableAddress('::ffff:808:808')).toBe(false)
  })

  it('refuses IPv4-translated addresses, which a translator could carry to a private network', () => {
    for (const address of [
      '::ffff:0:10.0.0.1',
      '::ffff:0:a00:1',
      '::ffff:0:127.0.0.1',
      '::ffff:0:8.8.8.8',
    ]) {
      expect(isFetchableAddress(address), address).toBe(false)
      expect(isLocalProxyAddress(address), address).toBe(false)
    }
  })

  it('allows public addresses, including those just outside a refused range', () => {
    for (const address of ['8.8.8.8', '11.0.0.1', '100.128.0.1', '172.32.0.1', '2606:4700::1111']) {
      expect(isFetchableAddress(address), address).toBe(true)
    }
  })

  it('refuses anything that is not an address', () => {
    expect(isFetchableAddress('not-an-ip')).toBe(false)
    expect(isFetchableAddress('')).toBe(false)
  })
})

describe('trusted local proxies', () => {
  it('trusts loopback, private, unique local, link-local and shared addresses', () => {
    for (const address of [
      '127.0.0.1',
      '127.255.255.254',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.1.5',
      '169.254.10.20',
      '100.64.0.1',
      '100.127.255.254',
      '::1',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'fe80::1%eth0',
    ]) {
      expect(isLocalProxyAddress(address), address).toBe(true)
    }
  })

  it('does not trust Teredo, 6to4 or NAT64 clients', () => {
    for (const address of TUNNELLED_CLIENTS) {
      expect(isLocalProxyAddress(address), address).toBe(false)
    }
  })

  it('does not trust public, documentation, reserved or unspecified addresses', () => {
    for (const address of [
      '8.8.8.8',
      '172.32.0.1',
      '192.0.2.1',
      '198.18.0.1',
      '192.88.99.1',
      'fec0::1',
      '0.0.0.0',
      '224.0.0.1',
      '::',
      '::10.0.0.1',
      '100::1',
      '2001:db8::1',
      '2606:4700::1111',
      'ff02::1',
    ]) {
      expect(isLocalProxyAddress(address), address).toBe(false)
    }
  })

  it('judges an IPv4-mapped address as its IPv4 address, and distrusts rare spellings', () => {
    expect(isLocalProxyAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isLocalProxyAddress('::FFFF:192.168.0.1')).toBe(true)
    expect(isLocalProxyAddress('::ffff:8.8.8.8')).toBe(false)
    expect(isLocalProxyAddress('::ffff:a00:1')).toBe(false)
    expect(isLocalProxyAddress('0:0:0:0:0:ffff:a00:1')).toBe(false)
  })

  it('distrusts anything that is not an address', () => {
    expect(isLocalProxyAddress('not-an-ip')).toBe(false)
    expect(isLocalProxyAddress('')).toBe(false)
  })
})

describe('range lists', () => {
  const list = rangeList({ ipv4: [['10.0.0.0', 8]], ipv6: [['fc00::', 7]] })

  it('answers the same for an IPv4 address and its mapped form', () => {
    expect(inRanges(list, '10.1.2.3')).toBe(true)
    expect(inRanges(list, '::ffff:10.1.2.3')).toBe(true)
    expect(inRanges(list, '11.1.2.3')).toBe(false)
    expect(inRanges(list, '::ffff:11.1.2.3')).toBe(false)
    expect(inRanges(list, 'fd00::1')).toBe(true)
  })

  it('cannot judge rare mapped spellings or non-addresses, so the caller decides', () => {
    expect(inRanges(list, '::ffff:a01:203')).toBeNull()
    expect(inRanges(list, '0:0:0:0:0:ffff:a01:203')).toBeNull()
    expect(inRanges(list, 'example.com')).toBeNull()
  })
})
