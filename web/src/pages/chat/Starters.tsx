// Chat before the first question: what it can do, and questions to start with.

/** Questions that show what Chat is for, one tap each. */
export const STARTERS = [
  'Can I afford a PS5 Pro right now?',
  'How am I doing this month?',
  'What bills are coming up?',
  'Where did my money go last month?',
]

export function Starters({ ask, busy }: { ask: (question: string) => void; busy: boolean }) {
  return (
    <section className="card soft chat-empty" aria-labelledby="chat-empty-title">
      <h2 id="chat-empty-title">Ask anything about your money</h2>
      <p className="muted">
        Leeway looks at your accounts, budgets, bills and goals to answer. It can read everything
        and change nothing.
      </p>
      <div className="chat-starters">
        {STARTERS.map((question) => (
          <button
            key={question}
            type="button"
            className="chat-starter"
            disabled={busy}
            onClick={() => ask(question)}
          >
            {question}
          </button>
        ))}
      </div>
      <p className="small muted">
        Tell it what is coming up, like a trip you are saving for, and it keeps that in mind.
      </p>
    </section>
  )
}
