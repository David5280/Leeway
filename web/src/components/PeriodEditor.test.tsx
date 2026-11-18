// The budget period editor, and the list of time zones it offers.

import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultPeriod, PeriodEditor, timeZones, type PeriodSetting } from './PeriodEditor'

afterEach(() => vi.unstubAllGlobals())

describe('PeriodEditor', () => {
  const monthly: PeriodSetting = { kind: 'monthly', startDay: 1 }
  const weekly: PeriodSetting = { kind: 'weekly', weekStartsOn: 1 }
  const biweekly: PeriodSetting = {
    kind: 'paycheck',
    frequency: 'biweekly',
    anchorDate: '2026-11-06',
    semimonthlyDays: [1, 15],
  }
  const semimonthly: PeriodSetting = { ...biweekly, frequency: 'semimonthly' }

  afterEach(() => vi.useRealTimers())

  function renderEditor(value: PeriodSetting) {
    const onChange = vi.fn()
    render(<PeriodEditor value={value} onChange={onChange} />)
    return { onChange, user: userEvent.setup() }
  }

  it('picks the day a month starts on, from 1 to 28', async () => {
    const { onChange, user } = renderEditor(monthly)
    expect(screen.getByRole('button', { name: 'Monthly' })).toHaveAttribute('aria-pressed', 'true')
    const select = screen.getByLabelText('Month starts on day')
    expect(within(select).getAllByRole('option')).toHaveLength(28)
    expect(within(select).getAllByRole('option').at(-1)).toHaveTextContent('28')
    await user.selectOptions(select, '15')
    expect(onChange).toHaveBeenCalledWith({ kind: 'monthly', startDay: 15 })
  })

  it('picks the day a week starts on', async () => {
    const { onChange, user } = renderEditor(weekly)
    const select = screen.getByLabelText('Week starts on')
    expect(select).toHaveDisplayValue('Monday')
    await user.selectOptions(select, 'Sunday')
    expect(onChange).toHaveBeenCalledWith({ kind: 'weekly', weekStartsOn: 0 })
    expect(screen.queryByLabelText('Month starts on day')).not.toBeInTheDocument()
  })

  it('starts each kind from a full default when switching', async () => {
    // Only the clock is faked, so typing and clicking still run normally.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 17, 23, 30))
    const { onChange, user } = renderEditor(monthly)
    await user.click(screen.getByRole('button', { name: 'Weekly' }))
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'weekly', weekStartsOn: 1 })
    await user.click(screen.getByRole('button', { name: 'Every paycheck' }))
    // Late in the evening it is still the 17th where the owner is.
    expect(onChange).toHaveBeenLastCalledWith({
      kind: 'paycheck',
      frequency: 'biweekly',
      anchorDate: '2026-11-17',
      semimonthlyDays: [1, 15],
    })
  })

  it('does nothing when the chosen kind is picked again', async () => {
    const { onChange, user } = renderEditor(weekly)
    await user.click(screen.getByRole('button', { name: 'Weekly' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('asks how often pay comes and for a recent payday', async () => {
    const { onChange, user } = renderEditor(biweekly)
    expect(screen.getByLabelText('How often you are paid')).toHaveDisplayValue('Every 2 weeks')
    const payday = screen.getByLabelText('A recent payday')
    expect(payday).toHaveValue('2026-11-06')
    expect(screen.queryByLabelText('First payday')).not.toBeInTheDocument()

    fireEvent.change(payday, { target: { value: '2026-11-13' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...biweekly, anchorDate: '2026-11-13' })

    await user.selectOptions(screen.getByLabelText('How often you are paid'), 'Twice a month')
    expect(onChange).toHaveBeenLastCalledWith({ ...biweekly, frequency: 'semimonthly' })
  })

  it('ignores a cleared payday', () => {
    const { onChange } = renderEditor(biweekly)
    fireEvent.change(screen.getByLabelText('A recent payday'), { target: { value: '' } })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('asks for two paydays when paid twice a month, kept between 1 and 31', () => {
    const { onChange } = renderEditor(semimonthly)
    expect(screen.queryByLabelText('A recent payday')).not.toBeInTheDocument()
    const first = screen.getByLabelText('First payday')
    const second = screen.getByLabelText('Second payday')
    expect(first).toHaveValue(1)
    expect(second).toHaveValue(15)

    const sent = (input: HTMLElement, value: string) => {
      fireEvent.change(input, { target: { value } })
      return onChange.mock.lastCall?.[0]
    }
    expect(sent(second, '31')).toEqual({ ...semimonthly, semimonthlyDays: [1, 31] })
    expect(sent(second, '45')).toEqual({ ...semimonthly, semimonthlyDays: [1, 31] })
    expect(sent(first, '0')).toEqual({ ...semimonthly, semimonthlyDays: [1, 15] })
    expect(sent(first, '7.6')).toEqual({ ...semimonthly, semimonthlyDays: [8, 15] })
    expect(sent(first, '-3')).toEqual({ ...semimonthly, semimonthlyDays: [1, 15] })
    // The setting passed in is never changed in place.
    expect(semimonthly.kind === 'paycheck' && semimonthly.semimonthlyDays).toEqual([1, 15])
  })

  it('gives a complete default for every kind', () => {
    expect(defaultPeriod('monthly', '2026-11-17')).toEqual({ kind: 'monthly', startDay: 1 })
    expect(defaultPeriod('weekly', '2026-11-17')).toEqual({ kind: 'weekly', weekStartsOn: 1 })
    expect(defaultPeriod('paycheck', '2026-11-17')).toEqual({
      kind: 'paycheck',
      frequency: 'biweekly',
      anchorDate: '2026-11-17',
      semimonthlyDays: [1, 15],
    })
  })
})

describe('timeZones', () => {
  /** An Intl whose own time zone and known zones are fixed for the test. */
  function stubIntl(timeZone: string, supported?: string[]) {
    vi.stubGlobal('Intl', {
      DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone }) }),
      ...(supported && { supportedValuesOf: () => supported }),
    })
  }

  it('lists every zone the browser knows, with its own included', () => {
    stubIntl('America/Denver', ['America/Denver', 'Europe/Paris'])
    expect(timeZones()).toEqual({
      current: 'America/Denver',
      all: ['America/Denver', 'Europe/Paris'],
    })
  })

  it('puts the browser zone first when the list lacks it', () => {
    stubIntl('Etc/Unknown', ['America/Denver', 'Europe/Paris'])
    expect(timeZones().all).toEqual(['Etc/Unknown', 'America/Denver', 'Europe/Paris'])
  })

  it('falls back to its own zone and UTC in older browsers', () => {
    stubIntl('Asia/Tokyo')
    expect(timeZones()).toEqual({ current: 'Asia/Tokyo', all: ['Asia/Tokyo', 'UTC'] })
  })

  it('uses UTC when the browser reports no zone', () => {
    stubIntl('')
    expect(timeZones().current).toBe('UTC')
  })
})
