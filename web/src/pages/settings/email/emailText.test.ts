import { describe, expect, it } from 'vitest'
import { weeklyEmail } from '../../../test/fake'
import { addressHint, hourLabel, momentLabel, scheduleText, weekdayNames } from './emailText'

const NOW = Date.parse('2026-11-18T17:00:00Z')

describe('weekdayNames', () => {
  it('names the days Sunday first, in the owner’s language', () => {
    expect(weekdayNames('en-US')).toEqual([
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ])
    expect(weekdayNames('de-DE')[1]).toBe('Montag')
  })
})

describe('hourLabel', () => {
  it('reads like the owner’s clock', () => {
    expect(hourLabel(0, 'en-US')).toBe('12 AM')
    expect(hourLabel(17, 'en-US')).toBe('5 PM')
    expect(hourLabel(17, 'en-GB')).toBe('17')
  })
})

describe('momentLabel', () => {
  it('shows a moment in the owner’s time zone', () => {
    expect(momentLabel('2026-11-23T15:00:00Z', 'America/Denver', 'en-US')).toBe(
      'Mon, Nov 23, 8:00 AM',
    )
    expect(momentLabel('2026-11-23T15:00:00Z', 'Asia/Tokyo', 'en-US')).toBe('Tue, Nov 24, 12:00 AM')
  })
})

describe('addressHint', () => {
  it('says where the email goes without an address, and how to go back to that', () => {
    expect(addressHint(null, 'me@example.com')).toBe(
      'Goes to your sign-in email, me@example.com, unless you name another.',
    )
    expect(addressHint(null, null)).toBe('Goes to your sign-in email unless you name another.')
    expect(addressHint('other@example.com', 'me@example.com')).toMatch(/^Clear the address/)
  })
})

describe('scheduleText', () => {
  const text = (view: Partial<typeof weeklyEmail>) =>
    scheduleText({ ...weeklyEmail, ...view }, 'en-US', NOW)

  it('says nothing while off and never sent', () => {
    expect(text({})).toBeNull()
  })

  it('still says when the last one went while off', () => {
    expect(text({ lastSentAt: '2026-11-16T15:04:00Z' })).toBe('Last sent Mon, Nov 16, 8:04 AM.')
  })

  it('says when the next one goes', () => {
    expect(text({ on: true, nextSendAt: '2026-11-23T15:00:00Z' })).toBe(
      'Next email Mon, Nov 23, 8:00 AM.',
    )
  })

  it('says one is on its way when it is due now', () => {
    expect(text({ on: true, nextSendAt: '2026-11-18T17:00:00Z' })).toBe(
      'The next email goes out in the next few minutes.',
    )
  })
})
