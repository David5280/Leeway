import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { fakeServer, renderSignedIn, settingsWith } from '../../test/fake'
import { Money, moneyClass } from './Money'

function renderMoney(ui: React.ReactNode, settings = settingsWith({ timeZone: 'America/Denver' })) {
  fakeServer({})
  return renderSignedIn(ui, { settings })
}

describe('Money', () => {
  it('rounds to whole units by default, in the number font, taking the color of its words', () => {
    renderMoney(<Money cents={123456} />)
    const amount = screen.getByText('$1,235')
    expect(amount).toHaveClass('money', 'money-neutral')
    expect(amount.tagName).toBe('SPAN')
  })

  it('shows a bank amount to the cent: money in green with a plus, spending plain', () => {
    renderMoney(
      <>
        <Money cents={-12500} sign="transaction" />
        <Money cents={575} sign="transaction" />
      </>,
    )
    expect(screen.getByText('+$125.00')).toHaveClass('money-in')
    expect(screen.getByText('$5.75')).toHaveClass('money-neutral')
  })

  it('shows a transfer with no sign, quietly, whichever way it went', () => {
    renderMoney(<Money cents={-50000} sign="transfer" />)
    expect(screen.getByText('$500.00')).toHaveClass('money-muted')
  })

  it('takes a tone, a size, a class and cents when asked', () => {
    renderMoney(
      <Money cents={-5000} tone="problem" size="xl" precision="cents" className="mid-number" />,
    )
    expect(screen.getByText('−$50.00')).toHaveClass('money-problem', 'money-xl', 'mid-number')
  })

  it('formats in the owner currency and locale', () => {
    renderMoney(<Money cents={123456} />, settingsWith({ currency: 'EUR', locale: 'de-DE' }))
    expect(screen.getByText('1.235 €')).toBeInTheDocument()
  })

  it('draws inside an SVG text as a tspan', () => {
    renderMoney(
      <svg>
        <text>
          <Money cents={500} as="tspan" />
        </text>
      </svg>,
    )
    expect(screen.getByText('$5').tagName).toBe('tspan')
  })

  it('opens its breakdown when it is a button', async () => {
    const onOpen = vi.fn()
    renderMoney(
      <Money cents={4000} onOpen={onOpen} openLabel="Spent this period, show breakdown" />,
    )
    await userEvent.click(
      screen.getByRole('button', { name: '$40, Spent this period, show breakdown' }),
    )
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('is a button named by its amount when given no label', () => {
    renderMoney(<Money cents={4000} onOpen={() => {}} />)
    expect(screen.getByRole('button', { name: '$40' })).toHaveClass('money-open')
  })

  it('builds the classes shared with anything drawn like money', () => {
    expect(moneyClass('in')).toBe('money money-in')
    expect(moneyClass('warn', 'lg', 'extra')).toBe('money money-warn money-lg extra')
  })
})
