import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeServer, renderSignedIn, settingsWith } from '../../../test/fake'
import { Amount } from './money'

afterEach(() => vi.unstubAllGlobals())

describe('Amount', () => {
  it("shows whole amounts, or exact ones, in the owner's currency and locale", () => {
    fakeServer({})
    renderSignedIn(
      <>
        <Amount cents={123_456} />
        <Amount cents={123_456} exact />
      </>,
      { settings: settingsWith({ currency: 'EUR', locale: 'de-DE' }) },
    )
    expect(screen.getByText('1.235 €')).toHaveClass('num')
    expect(screen.getByText('1.234,56 €')).toHaveClass('num')
  })
})
