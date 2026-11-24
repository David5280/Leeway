// Said where a paystub would be imported when the server has no Anthropic
// key, so nothing can read one: what to add, and that nothing else breaks.
// Shown in place of the import button, never beside a button that cannot work.

export function NoReader({ later }: { later?: string }) {
  return (
    <p className="notice">
      Reading a paystub needs an Anthropic API key, and none is set. Add{' '}
      <code>ANTHROPIC_API_KEY</code> to your server&apos;s variables
      {later ? `, then ${later}` : ''}. Everything else works without it.
    </p>
  )
}
