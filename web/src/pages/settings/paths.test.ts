// Settings addresses, where an address without a group lands, the group
// remembered on this device, and the rules every group in the list keeps.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { findGroup, SETTINGS_GROUPS } from './groups'
import { landingPath } from './landing'
import { rememberedGroup, rememberGroup } from './lastGroup'
import { settingsPath } from './paths'

afterEach(() => vi.unstubAllGlobals())

describe('settingsPath', () => {
  it('gives a group its own address, or a section within it', () => {
    expect(settingsPath('banks')).toBe('/settings/banks')
    expect(settingsPath('budgeting', 'region')).toBe('/settings/budgeting#region')
  })
})

describe('landingPath', () => {
  it('opens the remembered group, or the first when none is remembered', () => {
    expect(landingPath('', 'email')).toBe('/settings/email')
    expect(landingPath('', null)).toBe('/settings/appearance')
  })

  it('opens the first group when the remembered one no longer exists', () => {
    expect(landingPath('', 'retirement-old')).toBe('/settings/appearance')
  })

  it('sends an old anchor to its group, ahead of the remembered one', () => {
    expect(landingPath('#agent', 'email')).toBe('/settings/assistant')
    expect(landingPath('#layout', null)).toBe('/settings/appearance#layout')
  })

  it('ignores an anchor it does not know, even one an object has built in', () => {
    expect(landingPath('#nowhere', 'data')).toBe('/settings/data')
    expect(landingPath('#constructor', null)).toBe('/settings/appearance')
  })
})

describe('the remembered group', () => {
  it('is kept on this device and read back', () => {
    expect(rememberedGroup()).toBeNull()
    rememberGroup('banks')
    expect(rememberedGroup()).toBe('banks')
  })

  it('is skipped quietly when the browser refuses storage', () => {
    const refusing = {
      getItem: () => {
        throw new Error('storage is off')
      },
      setItem: () => {
        throw new Error('storage is off')
      },
    }
    vi.stubGlobal('localStorage', refusing)
    expect(() => rememberGroup('banks')).not.toThrow()
    expect(rememberedGroup()).toBeNull()
  })
})

describe('the group list', () => {
  it('gives every group a unique id that reads well in an address', () => {
    const ids = SETTINGS_GROUPS.map((group) => group.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/)
  })

  it('gives every group a title, a one-line description and at least one section', () => {
    for (const group of SETTINGS_GROUPS) {
      expect(group.title.trim()).not.toBe('')
      expect(group.description).toMatch(/^[A-Z][^\n\u2014]*\.$/)
      expect(group.sections.length).toBeGreaterThan(0)
    }
  })

  it('puts each section in exactly one group', () => {
    const sections = SETTINGS_GROUPS.flatMap((group) => group.sections)
    expect(new Set(sections).size).toBe(sections.length)
  })

  it('finds a group by id, and nothing for a missing or unknown one', () => {
    expect(findGroup('data')?.title).toBe('Data')
    expect(findGroup(undefined)).toBeUndefined()
    expect(findGroup('nowhere')).toBeUndefined()
  })
})
