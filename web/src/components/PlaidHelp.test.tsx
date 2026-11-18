// The bank sync help: what Plaid is, where its keys go on each platform, and real banks.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { BankKeysMissing, PlaidKeySteps, RealBanks, SandboxNote } from './PlaidHelp'

describe('bank keys missing', () => {
  it('says sync is off, that Leeway works without it, and what Plaid is', () => {
    render(<BankKeysMissing platform="railway" />)
    expect(screen.getByText('Bank sync is off on this Leeway.')).toBeInTheDocument()
    expect(screen.getByText(/use Leeway without it/)).toHaveTextContent(
      'Plaid is the service many budgeting apps use to connect to banks.',
    )
  })

  it('keeps the steps folded until asked for', async () => {
    render(<BankKeysMissing platform="railway" />)
    const help = screen.getByText('How to turn on bank sync').closest('details')!
    expect(help).not.toHaveAttribute('open')
    await userEvent.setup().click(screen.getByText('How to turn on bank sync'))
    expect(help).toHaveAttribute('open')
  })
})

describe('the steps to get Plaid keys', () => {
  it("links to Plaid's sign-up and its Keys page", () => {
    render(<PlaidKeySteps platform="railway" />)
    expect(screen.getByRole('link', { name: 'dashboard.plaid.com' })).toHaveAttribute(
      'href',
      'https://dashboard.plaid.com',
    )
    expect(screen.getByRole('link', { name: 'Developers, then Keys' })).toHaveAttribute(
      'href',
      'https://dashboard.plaid.com/developers/keys',
    )
  })

  it('says where the keys go on each platform, and never asks for them here', () => {
    const third = (platform: 'railway' | 'docker' | 'other') => {
      const { unmount } = render(<PlaidKeySteps platform={platform} />)
      const text = screen.getAllByRole('listitem')[2]!.textContent
      unmount()
      return text
    }
    expect(third('railway')).toBe(
      "In Railway, open the Leeway service's Variables, set PLAID_CLIENT_ID and PLAID_SECRET, and deploy the change. They are server settings, so this page never asks for them.",
    )
    expect(third('docker')).toMatch(/^Put them in your \.env file .* docker compose up -d\./)
    expect(third('other')).toMatch(/^Set PLAID_CLIENT_ID and PLAID_SECRET where Leeway reads/)
  })
})

describe('real banks', () => {
  it('gives the test login, both ways to Production access, and the settings to change', () => {
    render(<RealBanks />)
    expect(screen.getByText('user_good')).toBeInTheDocument()
    expect(screen.getByText('pass_good')).toBeInTheDocument()
    expect(screen.getByText(/free Trial plan, for up to 10 bank logins/)).toBeInTheDocument()
    expect(screen.getByText(/couple of business days/)).toBeInTheDocument()
    expect(screen.getByText(/Once approved, set/)).toHaveTextContent(
      'set PLAID_ENV to production and PLAID_SECRET to your Production secret',
    )
  })

  it('sits behind a fold in the Sandbox note', () => {
    render(<SandboxNote />)
    expect(
      screen.getByText('Plaid is in Sandbox, so it lists only test banks.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('How to connect your real bank').closest('details'),
    ).not.toHaveAttribute('open')
  })
})
