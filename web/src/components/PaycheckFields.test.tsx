// A paycheck period's schedule: said in a line when the paychecks already
// show it, asked field by field when they do not.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { sameSchedule, type PaycheckPeriod } from './PaycheckFields'
import { PeriodEditor } from './PeriodEditor'

const found: PaycheckPeriod = {
  kind: 'paycheck',
  frequency: 'biweekly',
  anchorDate: '2026-11-13',
  semimonthlyDays: [1, 15],
}

describe('sameSchedule', () => {
  it('counts paydays whole steps apart as the same schedule', () => {
    expect(sameSchedule(found, { ...found, anchorDate: '2026-10-30' })).toBe(true)
    expect(sameSchedule(found, { ...found, anchorDate: '2026-11-06' })).toBe(false)
    expect(sameSchedule(found, { ...found, frequency: 'weekly', anchorDate: '2026-11-06' })).toBe(
      false,
    )
  })

  it('counts weeks for weekly pay', () => {
    const weekly = { ...found, frequency: 'weekly' as const }
    expect(sameSchedule(weekly, { ...weekly, anchorDate: '2026-11-06' })).toBe(true)
  })

  it('matches monthly pay by its day of the month', () => {
    const monthly = { ...found, frequency: 'monthly' as const, anchorDate: '2026-11-05' }
    expect(sameSchedule(monthly, { ...monthly, anchorDate: '2026-08-05' })).toBe(true)
    expect(sameSchedule(monthly, { ...monthly, anchorDate: '2026-08-06' })).toBe(false)
  })

  it('matches monthly pay on the month’s last day, whatever the month’s length', () => {
    const monthEnd = { ...found, frequency: 'monthly' as const, anchorDate: '2026-11-30' }
    expect(sameSchedule(monthEnd, { ...monthEnd, anchorDate: '2026-10-31' })).toBe(true)
    expect(sameSchedule(monthEnd, { ...monthEnd, anchorDate: '2026-10-30' })).toBe(false)
  })

  it('matches twice-a-month pay by its two days', () => {
    const twice = {
      ...found,
      frequency: 'semimonthly' as const,
      semimonthlyDays: [15, 31] as [number, number],
    }
    expect(sameSchedule(twice, { ...twice, anchorDate: '2020-01-01' })).toBe(true)
    expect(sameSchedule(twice, { ...twice, semimonthlyDays: [1, 15] })).toBe(false)
  })
})

describe('PeriodEditor with paychecks found', () => {
  function renderEditor(value: Parameters<typeof PeriodEditor>[0]['value']) {
    const onChange = vi.fn()
    render(<PeriodEditor value={value} found={found} onChange={onChange} />)
    return { onChange, user: userEvent.setup() }
  }

  it('starts Every paycheck on the schedule the paychecks show', async () => {
    const { onChange, user } = renderEditor({ kind: 'monthly', startDay: 1 })
    await user.click(screen.getByRole('button', { name: 'Every paycheck' }))
    expect(onChange).toHaveBeenCalledWith(found)
  })

  it('says the schedule in a line instead of asking, with Change to open the fields', async () => {
    const { onChange, user } = renderEditor({ ...found, anchorDate: '2026-10-30' })
    expect(screen.getByText(/going by your paychecks/)).toHaveTextContent(
      'Paid every 2 weeks, going by your paychecks.',
    )
    expect(screen.queryByLabelText('How often you are paid')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Change' }))
    await user.selectOptions(screen.getByLabelText('How often you are paid'), 'Every week')
    expect(onChange).toHaveBeenCalledWith({
      ...found,
      anchorDate: '2026-10-30',
      frequency: 'weekly',
    })
  })

  it('says when the schedule is the pay the owner entered', () => {
    render(<PeriodEditor value={found} found={found} entered onChange={vi.fn()} />)
    expect(screen.getByText(/going by/)).toHaveTextContent(
      'Paid every 2 weeks, going by the pay you entered.',
    )
  })

  it('asks when the saved schedule is not the one found', () => {
    renderEditor({ ...found, anchorDate: '2026-11-06' })
    expect(screen.getByLabelText('A recent payday')).toHaveValue('2026-11-06')
  })
})
