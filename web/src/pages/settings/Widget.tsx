// The home-screen widget: its token, the Scriptable script, and how to set it up.

import { useApp } from '../../lib/app'
import { Section } from './Section'
import { WidgetScript } from './widget/WidgetScript'
import { WidgetSteps } from './widget/WidgetSteps'
import { WidgetToken } from './widget/WidgetToken'

/** How often the widget asks for new numbers; the script's REFRESH_MINUTES, which a test checks. */
export const WIDGET_REFRESH_MINUTES = 30

export function WidgetSection() {
  const { status } = useApp()
  const server = status.publicUrl ?? window.location.origin

  return (
    <Section id="widget" title="Widget">
      <div className="widget-setup stack">
        <p className="small">
          See your leeway, budget left, net worth, next bill and any account alerts on your iPhone
          home screen or Mac desktop, through the free Scriptable app. The widget reads only that
          summary, and refreshes about every {WIDGET_REFRESH_MINUTES} minutes.
        </p>
        <WidgetToken server={server} />
        <WidgetScript />
        <WidgetSteps />
      </div>
    </Section>
  )
}
