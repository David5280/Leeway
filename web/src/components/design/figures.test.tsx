import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { DrillDown, DrillUsual } from '../../lib/drill'
import { renderSignedIn } from '../../test/fake'
import { Card } from './Card'
import { DrillSheet } from './DrillSheet'
import { HeroFigure } from './HeroFigure'
import { ProgressRing } from './ProgressRing'
import { SectionHead } from './SectionHead'
import { Sparkline, sparkArea, sparkPoints } from './Sparkline'
import { UsualChip } from './UsualChip'

const spentLess: DrillUsual = {
  currentCents: 20000,
  usualCents: 24000,
  goodWhen: 'down',
  basis: 'this point last month',
  subject: 'spent',
}

/** A drill-down with every section, to see each drawn in its place. */
const everything: DrillDown = {
  title: 'Debt payoff',
  subtitle: 'Highest rate first',
  figure: { text: '4 years 10 months' },
  math: {
    terms: [
      { label: 'Owed now', value: { cents: 200000 } },
      { label: 'interest', value: { cents: 144900 }, op: 'plus' },
      { label: 'paid early', value: { cents: 900 }, op: 'minus' },
    ],
    result: { label: 'Paid in all', value: { cents: 344000 } },
    note: 'Paying more clears it sooner.',
  },
  trend: {
    points: [
      { date: '2026-10-01', cents: 210000 },
      { date: '2026-11-01', cents: 200000 },
    ],
    label: 'Owed over the last two months',
    description: 'What is owed, each month.',
    reference: { cents: 150000, label: 'On plan' },
  },
  usual: spentLess,
  items: {
    title: 'When each clears',
    rows: [
      { key: 'card', label: 'Rewards card', detail: '58 months', to: '/plan/debts' },
      { key: 'loan', label: 'Car loan', value: { text: 'Paid off', tone: 'in' } },
    ],
  },
  more: { to: '/plan/debts', label: 'Plan it' },
}

describe('DrillSheet', () => {
  it('draws every section in order: figure, math, trend, usual, items and the way on', () => {
    renderSignedIn(<DrillSheet drill={everything} onClose={() => {}} />)
    const sheet = screen.getByRole('dialog', { name: 'Debt payoff' })
    expect(sheet).toHaveTextContent('Highest rate first')
    expect(within(sheet).getByText('4 years 10 months')).toHaveClass('money-neutral', 'money-xl')
    const sections = within(sheet)
      .getAllByRole('region')
      .map((one) => one.getAttribute('aria-label'))
    expect(sections).toEqual(['How it adds up', 'Trend', 'Compared with usual', 'When each clears'])
    expect(within(sheet).getByRole('region', { name: 'How it adds up' })).toHaveTextContent(
      'Paid in all $3,440 = Owed now $2,000 plus interest $1,449 minus paid early $9',
    )
    expect(within(sheet).getByText('Paying more clears it sooner.')).toBeInTheDocument()
    const trend = within(sheet).getByRole('img', { name: 'Owed over the last two months' })
    expect(trend).toHaveAccessibleDescription(
      'What is owed, each month. The dashed line marks where it should be (On plan, $1,500).',
    )
    expect(trend).toHaveTextContent('On plan: $1,500')
    expect(within(sheet).getByText('$40 less than this point last month')).toHaveClass(
      'drill-usual-good',
    )
    expect(within(sheet).getByRole('link', { name: 'Plan it' })).toHaveAttribute(
      'href',
      '/plan/debts',
    )
  })

  it('links a row with a page and leaves one without as plain text', () => {
    renderSignedIn(<DrillSheet drill={everything} onClose={() => {}} />)
    const rows = screen.getByRole('region', { name: 'When each clears' })
    expect(within(rows).getByRole('link', { name: /Rewards card/ })).toHaveAttribute(
      'href',
      '/plan/debts',
    )
    expect(within(rows).queryByRole('link', { name: /Car loan/ })).not.toBeInTheDocument()
    expect(within(rows).getByText('Paid off')).toHaveClass('money-in')
  })

  it('leaves out the parts it has no data for', () => {
    const bare: DrillDown = {
      title: 'Net worth',
      figure: { cents: 700000 },
      math: everything.math,
      trend: { ...everything.trend!, points: [{ date: '2026-11-01', cents: 1 }] },
      items: { title: 'Accounts', rows: [] },
    }
    renderSignedIn(<DrillSheet drill={bare} onClose={() => {}} />)
    const sheet = screen.getByRole('dialog', { name: 'Net worth' })
    expect(
      within(sheet)
        .getAllByRole('region')
        .map((one) => one.getAttribute('aria-label')),
    ).toEqual(['How it adds up'])
    expect(within(sheet).queryByRole('link')).not.toBeInTheDocument()
  })

  it('closes from its own button', async () => {
    const onClose = vi.fn()
    renderSignedIn(<DrillSheet drill={everything} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('Card', () => {
  it('as a link, is one link to its page, named by what it shows', () => {
    render(
      <MemoryRouter>
        <Card to="/accounts/a" label="Everyday checking">
          <span>Everyday checking</span>
        </Card>
      </MemoryRouter>,
    )
    const card = screen.getByRole('region', { name: 'Everyday checking' })
    expect(within(card).getByRole('link')).toHaveAttribute('href', '/accounts/a')
    expect(within(card).getByRole('link')).toHaveTextContent('Everyday checking, open details')
  })
})

describe('HeroFigure and UsualChip', () => {
  it('shows the label, the amount, its usual, a caption and what sits beside it', () => {
    renderSignedIn(
      <HeroFigure
        label="Left to spend"
        cents={35200}
        usual={spentLess}
        caption="About $44 a day"
        aside={<span>ring</span>}
      />,
    )
    expect(screen.getByText('Left to spend')).toBeInTheDocument()
    expect(screen.getByText('$352')).toBeInTheDocument()
    const chip = screen.getByRole('img', { name: '$40 less than this point last month' })
    expect(chip).toHaveTextContent('▼ $40 less spent')
    expect(chip).toHaveClass('usual-good')
    expect(screen.getByText('About $44 a day')).toBeInTheDocument()
    expect(screen.getByText('ring')).toBeInTheDocument()
  })

  it('reads a move the wrong way in amber, and a small one as usual', () => {
    renderSignedIn(<UsualChip usual={{ ...spentLess, currentCents: 30000 }} />)
    expect(screen.getByRole('img')).toHaveClass('usual-warn')
    expect(screen.getByRole('img')).toHaveTextContent('▲ $60 more spent')
  })

  it('says as usual within a few percent, with no subject needed', () => {
    renderSignedIn(<UsualChip usual={{ ...spentLess, currentCents: 24100, subject: undefined }} />)
    expect(
      screen.getByRole('img', { name: 'About the same as this point last month' }),
    ).toHaveTextContent('= as usual')
  })
})

describe('ProgressRing', () => {
  it('fills to its percent and says so', () => {
    render(<ProgressRing percent={42.4} label="Groceries budget used" />)
    const ring = screen.getByRole('progressbar', { name: 'Groceries budget used' })
    expect(ring).toHaveAttribute('aria-valuenow', '42')
    expect(ring).toHaveTextContent('42%')
    expect(ring).toHaveClass('ring-ok')
    expect(ring.querySelector('.ring-tick')).toBeNull()
  })

  it('stays full past 100, names how far over, and marks today on the rim', () => {
    render(<ProgressRing percent={130} label="Dining" status="over" marker={50} size={60} />)
    const ring = screen.getByRole('progressbar', { name: 'Dining' })
    expect(ring).toHaveAttribute('aria-valuenow', '100')
    expect(ring).toHaveAttribute('aria-valuetext', '130%')
    expect(ring).toHaveClass('ring-over')
    expect(ring).toHaveStyle({ width: '60px' })
    expect(ring.querySelector('.ring-fill')).toHaveAttribute('stroke-dashoffset', '0')
    // Half way round from the top, on the turned circle: straight down from its middle.
    const tick = ring.querySelector('.ring-tick')!
    expect(Number(tick.getAttribute('x1'))).toBeCloseTo(6)
    expect(Number(tick.getAttribute('y1'))).toBeCloseTo(20)
  })

  it('counts a negative percent as empty', () => {
    render(<ProgressRing percent={-5} label="Fun" marker={150} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '0%')
  })
})

describe('SectionHead', () => {
  it('titles a card with its icon hidden from screen readers', () => {
    const { container } = render(<SectionHead icon="activity" title="Recent" />)
    expect(screen.getByRole('heading', { name: 'Recent', level: 2 })).toBeInTheDocument()
    expect(container.querySelector('.section-icon')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('Sparkline', () => {
  it('draws nothing under two values', () => {
    const { container } = render(<Sparkline values={[5]} />)
    expect(container).toBeEmptyDOMElement()
    expect(sparkPoints([5])).toBe('')
    expect(sparkArea([])).toBe('')
  })

  it('is decorative without a label, and lays its lowest value at the bottom', () => {
    const { container } = render(<Sparkline values={[1, 3, 2]} />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(sparkPoints([1, 3, 2])).toBe('0,22 40,2 80,12')
    // A flat line sits on the bottom rather than dividing by nothing.
    expect(sparkPoints([4, 4])).toBe('0,22 80,22')
  })

  it('fills under the line and dots where it ends, named when labeled', () => {
    const { container } = render(<Sparkline values={[1, 3]} area label="Balance, rising" />)
    expect(screen.getByRole('img', { name: 'Balance, rising' })).toBeInTheDocument()
    expect(container.querySelector('.spark-area')).toHaveAttribute(
      'd',
      'M0 24 L0 22 L80 2 L80 24 Z',
    )
    const end = container.querySelector('.spark-end')!
    expect(end.getAttribute('x1')).toBe('80')
    expect(end.getAttribute('y1')).toBe('2')
  })
})
