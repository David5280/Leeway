import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeServer, renderSignedIn, settingsWith } from '../../../test/fake'
import { Amount } from './money'

afterEach(() => vi.unstubAllGlobals())

describe('Amount', () => {
  it("draws whole amounts, or exact ones, as <Money> in the owner's currency and locale", () => {
    fakeServer({})
    renderSignedIn(
      <>
        <Amount cents={123_456} />
        <Amount cents={123_456} exact />
      </>,
      { settings: settingsWith({ currency: 'EUR', locale: 'de-DE' }) },
    )
    expect(screen.getByText('1.235 €')).toHaveClass('money', 'money-neutral')
    expect(screen.getByText('1.234,56 €')).toHaveClass('money', 'money-neutral')
  })

  it('marks money in with a plus and its color, and leaves money out plain', () => {
    fakeServer({})
    renderSignedIn(
      <>
        <Amount cents={384_500} exact flow="in" />
        <Amount cents={23_070} exact flow="out" />
      </>,
    )
    expect(screen.getByText('+$3,845.00')).toHaveClass('money-in')
    expect(screen.getByText('$230.70')).toHaveClass('money-neutral')
  })
})
