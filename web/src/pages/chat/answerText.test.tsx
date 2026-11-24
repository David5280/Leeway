// Links in Chat's answers (AnswerText.tsx): a link to one of the app's
// screens is a real link; any other address shows as its words alone.

import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { answerPieces, AnswerText } from './AnswerText'

describe('answerPieces', () => {
  it('keeps the words around a link to a screen', () => {
    expect(answerPieces('See [Payday](/payday) for more.')).toEqual([
      { text: 'See ' },
      { text: 'Payday', to: '/payday' },
      { text: ' for more.' },
    ])
  })

  it('keeps only the words of an outside or unknown address', () => {
    expect(answerPieces('[a site](https://example.com) and [nowhere](/nowhere)')).toEqual([
      { text: 'a site' },
      { text: ' and ' },
      { text: 'nowhere' },
    ])
  })

  it('leaves an answer with no links as it is', () => {
    expect(answerPieces('Plain [words] (here)')).toEqual([{ text: 'Plain [words] (here)' }])
  })
})

describe('AnswerText', () => {
  it('links the app screens and never an outside address', () => {
    render(
      <MemoryRouter>
        <p>
          <AnswerText text="Open [Bills](/payday/bills), not [this](https://evil.example)." />
        </p>
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Bills' })).toHaveAttribute('href', '/payday/bills')
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByText(/not this\./)).toBeInTheDocument()
  })
})
