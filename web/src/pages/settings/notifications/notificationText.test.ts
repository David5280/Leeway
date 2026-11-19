// The words on the Notifications settings screen.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  LIMITS,
  NOTIFICATION_KINDS,
} from '../../../../../server/src/domain/notifications/settings'
import { chargeCents } from './LargeChargeField'
import {
  BILL_DAYS,
  billDaysLabel,
  BUDGET_PERCENTS,
  devicesLine,
  KIND_TEXT,
  supportLine,
  withPatch,
} from './notificationText'

describe('notification words', () => {
  it('names every kind the server knows, without a dash', () => {
    expect(Object.keys(KIND_TEXT)).toEqual([...NOTIFICATION_KINDS])
    for (const { label, hint } of Object.values(KIND_TEXT)) {
      expect(`${label} ${hint}`).not.toMatch(/[\u2013\u2014]/)
    }
  })

  it('offers only thresholds the server takes', () => {
    const { overBudgetPercent, billDueDays } = LIMITS
    expect(
      BUDGET_PERCENTS.every((p) => p >= overBudgetPercent.min && p <= overBudgetPercent.max),
    ).toBe(true)
    expect(BUDGET_PERCENTS).toContain(DEFAULT_NOTIFICATION_SETTINGS.overBudgetPercent)
    expect(BILL_DAYS[0]).toBe(billDueDays.min)
    expect(BILL_DAYS.at(-1)).toBe(billDueDays.max)
  })

  it('says how long before a bill', () => {
    expect(billDaysLabel(0)).toBe('On the day')
    expect(billDaysLabel(1)).toBe('1 day before')
    expect(billDaysLabel(3)).toBe('3 days before')
  })

  it('explains in one line why push is off here, or says nothing when it can be on', () => {
    expect(supportLine('ready')).toBeNull()
    expect(supportLine('home-screen')).toBe(
      'On iPhone and iPad, add Leeway to your Home Screen first: tap Share, then Add to Home Screen, and open it from there.',
    )
    expect(supportLine('unsupported')).toMatch(/can't show notifications/)
    expect(supportLine('denied')).toMatch(/blocked/)
  })

  it('counts the devices with push', () => {
    expect(devicesLine(0, false)).toBe('No device gets pushes yet.')
    expect(devicesLine(1, true)).toBe('Push is on for this device.')
    expect(devicesLine(2, true)).toBe('Push is on for this device and 1 other.')
    expect(devicesLine(4, true)).toBe('Push is on for this device and 3 others.')
    expect(devicesLine(1, false)).toBe('Push is on for 1 other device.')
    expect(devicesLine(2, false)).toBe('Push is on for 2 other devices.')
  })

  it('shows a change over the saved choices, keeping the rest', () => {
    const shown = withPatch(DEFAULT_NOTIFICATION_SETTINGS, {
      kinds: { overdrawn: false },
      quietHours: { start: 23 },
      billDueDays: 5,
    })
    expect(shown.kinds).toEqual({ ...DEFAULT_NOTIFICATION_SETTINGS.kinds, overdrawn: false })
    expect(shown.quietHours).toEqual({ ...DEFAULT_NOTIFICATION_SETTINGS.quietHours, start: 23 })
    expect(shown.billDueDays).toBe(5)
  })

  it('reads a large charge amount, refusing one out of range', () => {
    expect(chargeCents('$1,200')).toBe(120_000)
    expect(chargeCents('2.50')).toBe(250)
    expect(chargeCents('0.50')).toBeNull()
    expect(chargeCents('2000000')).toBeNull()
    expect(chargeCents('lots')).toBeNull()
  })
})
