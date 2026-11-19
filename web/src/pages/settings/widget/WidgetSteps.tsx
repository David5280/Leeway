// Setting the widget up on an iPhone or iPad, and on a Mac with Apple silicon.

export function WidgetSteps() {
  return (
    <div className="stack-sm">
      <h3>iPhone or iPad</h3>
      <ol className="how-to">
        <li>
          Install <b>Scriptable</b> from the App Store. It is free.
        </li>
        <li>
          Copy the script above. In Scriptable, tap <b>+</b>, paste it, and name the script Leeway.
        </li>
        <li>
          Touch and hold your Home Screen, tap <b>Edit</b>, then <b>Add Widget</b>. Choose
          Scriptable and a size, and add it.
        </li>
        <li>
          Touch and hold the new widget, tap <b>Edit Widget</b>, set Script to Leeway, and paste
          your widget parameter into <b>Parameter</b>.
        </li>
      </ol>

      <h3>Mac with Apple silicon</h3>
      <ol className="how-to">
        <li>
          Install <b>Scriptable</b> from the Mac App Store, under iPhone and iPad apps.
        </li>
        <li>Open Scriptable, add a script, paste the script into it, and name it Leeway.</li>
        <li>
          Control-click the desktop, choose <b>Edit Widgets</b>, find Scriptable, and drag a size
          onto the desktop.
        </li>
        <li>
          Control-click the widget, choose <b>Edit &quot;Scriptable&quot;</b>, set Script to Leeway,
          and paste your widget parameter into <b>Parameter</b>.
        </li>
      </ol>
      <p className="small muted">
        Rather keep the token out of the widget? Run the script once in Scriptable and choose{' '}
        <b>Save address and token</b>: it keeps them in Scriptable&apos;s Keychain, and the
        Parameter can stay empty.
      </p>
    </div>
  )
}
