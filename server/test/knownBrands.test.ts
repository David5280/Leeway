// The national brands a leak alert may name from a line's text alone
// (leaks/knownBrands.ts): whole names only, however a bank or a CSV writes them.

import { describe, expect, it } from 'vitest'
import { brandKey, isKnownBrand } from '../src/domain/leaks/knownBrands.js'

describe('isKnownBrand', () => {
  it.each([
    'Taco Bell',
    'TACO BELL',
    'Taco Bell #031',
    'Burger King',
    'Best Buy',
    'State Farm',
    'Google Fi',
    "Trader Joe's",
    'TRADER JOE S',
    'Trader Joe’s',
    'Circle K',
    'Dollar General',
    'Home Depot',
    'The Home Depot',
    'Whole Foods',
    'Liberty Mutual',
    'Planet Fitness',
    'Great Clips',
    'Chick-fil-A',
    'CHICK FIL A',
    "Taco John's",
    'Jack in the Box',
    'Pizza Hut',
    'Panda Express',
    "Dunkin' Donuts",
    'Olive Garden',
    'Family Dollar',
    "Sam's Club",
    'Bath & Body Works',
    'Bed Bath and Beyond',
    "Dick's Sporting Goods",
    'Foot Locker',
    'Old Navy',
    'American Eagle',
    'T-Mobile',
    'Sirius XM',
  ])('knows %s', (name) => {
    expect(isKnownBrand(name)).toBe(true)
  })

  it.each([
    'Jane Doe',
    'Jane Bell',
    'Taco Bell Jane',
    'Jane Taco Bell',
    'Bell Taco',
    'Old Navy Doe',
    'Taco',
    '',
  ])('does not know %s, which is not a whole brand name', (name) => {
    expect(isKnownBrand(name)).toBe(false)
  })
})

describe('brandKey', () => {
  it('reads a name in lower case, with "&" as "and" and no marks or store numbers', () => {
    expect(brandKey('BATH & BODY WORKS #12')).toBe('bath and body works')
    expect(brandKey('Chick-fil-A')).toBe('chick fil a')
    expect(brandKey('TRADER JOE S')).toBe('trader joes')
    expect(brandKey("Trader Joe's")).toBe('trader joes')
  })
})
