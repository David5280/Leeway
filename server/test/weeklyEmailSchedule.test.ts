import { describe, expect, it } from 'vitest'
import {
  dueSlot,
  latestSlot,
  MAX_ATTEMPTS,
  nextSendAt,
  nextSlot,
  RETRY_AFTER_MINUTES,
  type SendRecord,
  type WeeklyTime,
} from '../src/domain/weeklyEmail/schedule.js'

const DENVER = 'America/Denver'
/** Mondays at 8 AM. Nov 16 and 23, 2026 are Mondays; Denver is UTC-7 in November. */
const MONDAY_8AM: WeeklyTime = { weekday: 1, hour: 8 }
const NOV_16_8AM = new Date('2026-11-16T15:00:00Z')
const NOV_23_8AM = new Date('2026-11-23T15:00:00Z')

const iso = (date: Date | null) => date?.toISOString() ?? null
const minutesAfter = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000)

/** Turned on long ago, nothing sent or tried yet. */
const fresh: SendRecord = {
  on: true,
  scheduledSince: new Date('2026-10-01T00:00:00Z'),
  sentSlot: null,
  attemptSlot: null,
  attemptAt: null,
  attempts: 0,
}

const due = (record: SendRecord, now: Date, time = MONDAY_8AM, zone = DENVER) =>
  iso(dueSlot(record, time, zone, now))

describe('latestSlot and nextSlot', () => {
  it('find the chosen hour on the chosen day, in the owner’s time zone', () => {
    const wednesday = new Date('2026-11-18T19:00:00Z')
    expect(iso(latestSlot(MONDAY_8AM, DENVER, wednesday))).toBe(iso(NOV_16_8AM))
    expect(iso(nextSlot(MONDAY_8AM, DENVER, wednesday))).toBe(iso(NOV_23_8AM))
  })

  it('count the hour itself as come, and a minute before as last week’s', () => {
    expect(iso(latestSlot(MONDAY_8AM, DENVER, NOV_16_8AM))).toBe(iso(NOV_16_8AM))
    const justBefore = minutesAfter(NOV_16_8AM, -1)
    expect(iso(latestSlot(MONDAY_8AM, DENVER, justBefore))).toBe('2026-11-09T15:00:00.000Z')
    expect(iso(nextSlot(MONDAY_8AM, DENVER, justBefore))).toBe(iso(NOV_16_8AM))
  })

  it('go by the owner’s calendar day, not UTC’s', () => {
    // 11 PM Sunday in Denver is already Monday in UTC.
    const sundayNight = new Date('2026-11-23T06:00:00Z')
    expect(iso(latestSlot(MONDAY_8AM, DENVER, sundayNight))).toBe(iso(NOV_16_8AM))
    // The same moment is 3 PM Monday in Tokyo, past that Monday's 8 AM.
    const tokyo = latestSlot(MONDAY_8AM, 'Asia/Tokyo', sundayNight)
    expect(iso(tokyo)).toBe('2026-11-22T23:00:00.000Z')
  })

  it('keep the wall-clock hour across daylight saving', () => {
    // Clocks go back on Nov 1: 8 AM is 14:00 UTC before and 15:00 UTC after.
    const before = new Date('2026-10-26T14:00:00Z')
    expect(iso(nextSlot(MONDAY_8AM, DENVER, before))).toBe('2026-11-02T15:00:00.000Z')
    // Clocks go forward on Mar 8: 8 AM is 15:00 UTC before and 14:00 UTC after.
    expect(iso(nextSlot(MONDAY_8AM, DENVER, new Date('2026-03-02T15:00:00Z')))).toBe(
      '2026-03-09T14:00:00.000Z',
    )
  })
})

describe('dueSlot', () => {
  it('sends nothing while off', () => {
    expect(due({ ...fresh, on: false }, minutesAfter(NOV_16_8AM, 5))).toBeNull()
  })

  it('is due from the chosen hour', () => {
    expect(due(fresh, minutesAfter(NOV_16_8AM, -1))).toBe('2026-11-09T15:00:00.000Z')
    expect(due({ ...fresh, sentSlot: new Date('2026-11-09T15:00:00Z') }, NOV_16_8AM)).toBe(
      iso(NOV_16_8AM),
    )
  })

  it('never sends twice for one week', () => {
    const sent = { ...fresh, sentSlot: NOV_16_8AM }
    expect(due(sent, minutesAfter(NOV_16_8AM, 5))).toBeNull()
    expect(due(sent, new Date('2026-11-22T12:00:00Z'))).toBeNull()
    expect(due(sent, NOV_23_8AM)).toBe(iso(NOV_23_8AM))
  })

  it('catches up on a missed week once, and only until the next week starts', () => {
    // The server slept from Sunday to Saturday: last Monday's email goes out late.
    const saturday = new Date('2026-11-21T18:00:00Z')
    expect(due(fresh, saturday)).toBe(iso(NOV_16_8AM))
    // Woken the next Monday instead, only that week's email goes, not two.
    const lastSent = { ...fresh, sentSlot: new Date('2026-11-09T15:00:00Z') }
    expect(due(lastSent, minutesAfter(NOV_23_8AM, 60))).toBe(iso(NOV_23_8AM))
  })

  it('waits for the next chosen time after being turned on or moved', () => {
    const turnedOnTuesday = { ...fresh, scheduledSince: new Date('2026-11-17T18:00:00Z') }
    expect(due(turnedOnTuesday, new Date('2026-11-18T18:00:00Z'))).toBeNull()
    expect(due(turnedOnTuesday, NOV_23_8AM)).toBe(iso(NOV_23_8AM))
    expect(due({ ...fresh, scheduledSince: null }, NOV_23_8AM)).toBeNull()
  })

  it('retries a failed send an hour later, a few times at most', () => {
    const failed = { ...fresh, attemptSlot: NOV_16_8AM, attemptAt: NOV_16_8AM, attempts: 1 }
    expect(due(failed, minutesAfter(NOV_16_8AM, RETRY_AFTER_MINUTES - 1))).toBeNull()
    expect(due(failed, minutesAfter(NOV_16_8AM, RETRY_AFTER_MINUTES))).toBe(iso(NOV_16_8AM))
    const spent = { ...failed, attempts: MAX_ATTEMPTS }
    expect(due(spent, minutesAfter(NOV_16_8AM, 600))).toBeNull()
    // A new week starts afresh.
    expect(due(spent, NOV_23_8AM)).toBe(iso(NOV_23_8AM))
  })

  it('does not send twice in a week when the time zone or day moves', () => {
    // Sent at 8 AM Monday in Tokyo, then the owner moves to Denver, whose
    // Monday 8 AM comes 16 hours later.
    const sentInTokyo = { ...fresh, sentSlot: new Date('2026-11-15T23:00:00Z') }
    expect(due(sentInTokyo, minutesAfter(NOV_16_8AM, 5))).toBeNull()
    // Sent Monday, then moved to Wednesday: that Wednesday is skipped.
    const wednesday = { weekday: 3, hour: 8 }
    const sentMonday = { ...fresh, sentSlot: NOV_16_8AM }
    expect(due(sentMonday, new Date('2026-11-18T16:00:00Z'), wednesday)).toBeNull()
    expect(due(sentMonday, new Date('2026-11-25T16:00:00Z'), wednesday)).toBe(
      '2026-11-25T15:00:00.000Z',
    )
  })

  it('still sends every week across daylight saving, a week give or take an hour apart', () => {
    const sentBeforeFallBack = { ...fresh, sentSlot: new Date('2026-10-26T14:00:00Z') }
    expect(due(sentBeforeFallBack, new Date('2026-11-02T15:00:00Z'))).toBe(
      '2026-11-02T15:00:00.000Z',
    )
    const sentBeforeSpringForward = {
      ...fresh,
      scheduledSince: new Date('2026-01-01T00:00:00Z'),
      sentSlot: new Date('2026-03-02T15:00:00Z'),
    }
    expect(due(sentBeforeSpringForward, new Date('2026-03-09T14:00:00Z'))).toBe(
      '2026-03-09T14:00:00.000Z',
    )
  })
})

describe('nextSendAt', () => {
  const next = (record: SendRecord, now: Date, time = MONDAY_8AM) =>
    iso(nextSendAt(record, time, DENVER, now))

  it('is nothing while off', () => {
    expect(next({ ...fresh, on: false }, NOV_16_8AM)).toBeNull()
    expect(next({ ...fresh, scheduledSince: null }, NOV_16_8AM)).toBeNull()
  })

  it('is now when an email is due, else the next chosen time', () => {
    const now = minutesAfter(NOV_16_8AM, 2)
    expect(next(fresh, now)).toBe(iso(now))
    expect(next({ ...fresh, sentSlot: NOV_16_8AM }, now)).toBe(iso(NOV_23_8AM))
  })

  it('is the retry after a failure, and next week once the tries run out', () => {
    const failed = { ...fresh, attemptSlot: NOV_16_8AM, attemptAt: NOV_16_8AM, attempts: 1 }
    const now = minutesAfter(NOV_16_8AM, 10)
    expect(next(failed, now)).toBe(iso(minutesAfter(NOV_16_8AM, RETRY_AFTER_MINUTES)))
    expect(next({ ...failed, attempts: MAX_ATTEMPTS }, now)).toBe(iso(NOV_23_8AM))
  })

  it('skips a time too close to the last email', () => {
    const sentMonday = { ...fresh, sentSlot: NOV_16_8AM }
    const tuesdays = { weekday: 2, hour: 8 }
    expect(next(sentMonday, new Date('2026-11-16T20:00:00Z'), tuesdays)).toBe(
      '2026-11-24T15:00:00.000Z',
    )
  })
})
