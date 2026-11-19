import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProgressRing } from './ProgressRing'
import { StatusPill, STATUS_WORDS } from './StatusPill'

describe('StatusPill', () => {
  it('says each status in words, with a mark so color is not the only signal', () => {
    render(
      <>
        <StatusPill status="ok" />
        <StatusPill status="watch" />
        <StatusPill status="over" />
        <StatusPill status="info" />
      </>,
    )
    for (const status of ['ok', 'watch', 'over', 'info'] as const) {
      const pill = screen.getByText(STATUS_WORDS[status])
      expect(pill).toHaveClass('pill', `pill-${status}`)
      expect(pill.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('takes its own words, and a quiet pill has no mark', () => {
    render(<StatusPill status="quiet" label="Pending" />)
    expect(screen.getByText('Pending').querySelector('svg')).toBeNull()
  })
})

describe('ProgressRing', () => {
  it('reports how full it is, and fills no further than full', () => {
    render(<ProgressRing percent={130.4} label="Dining out budget used" status="over" />)
    const ring = screen.getByRole('progressbar', { name: 'Dining out budget used' })
    expect(ring).toHaveAttribute('aria-valuenow', '100')
    expect(ring).toHaveAttribute('aria-valuetext', '130%')
    expect(ring).toHaveClass('ring-over')
    expect(ring.querySelector('.ring-fill')).toHaveAttribute('stroke-dashoffset', '0')
    expect(ring).toHaveTextContent('130%')
  })

  it('starts empty, never below zero, on track by default', () => {
    render(<ProgressRing percent={-5} label="Saved" size={60} />)
    const ring = screen.getByRole('progressbar', { name: 'Saved' })
    expect(ring).toHaveAttribute('aria-valuenow', '0')
    expect(ring).toHaveClass('ring-ok')
    expect(ring).toHaveStyle({ width: '60px' })
  })
})
