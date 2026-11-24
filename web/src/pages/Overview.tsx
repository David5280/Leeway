// The Overview dashboard: widgets the owner arranges, sizes and hides.

import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useChatAvailable } from '../api/chat'
import { useAction } from '../api/hooks'
import { useUpdateSettings } from '../api/settings'
import { Shell } from '../components/Shell'
import { ErrorNote, Icon, Loading } from '../components/ui'
import { useApp } from '../lib/app'
import { periodLabel } from '../lib/format'
import { paths } from '../routes'
import { useUrgentHeadsUp } from '../widgets/Alerts'
import { Board } from '../widgets/Board'
import { AccountHealth } from './overview/AccountHealth'
import { PaydayNotice } from './overview/PaydayNotice'
import {
  addableTypes,
  DEFAULT_LAYOUT,
  drawable,
  urgentFirst,
  WIDGET_LIBRARY,
  type Widget,
} from '../widgets/library'

/** The way into Chat from Overview, drawn only when Chat is on. */
function AskBar() {
  return (
    <Link to={paths.chat()} className="card ask-bar">
      <Icon name="chat" size={20} />
      <span className="ask-bar-text">
        <span className="ask-bar-title">Ask about your money</span>
        <span className="small muted">Can I afford a PS5 Pro right now?</span>
      </span>
      <Icon name="forward" size={18} />
    </Link>
  )
}

/** The Ask bar to draw under the hero: only when Chat is on, and not while editing the layout. */
function useAskBar(editing: boolean): ReactNode {
  const chatOn = useChatAvailable()
  return chatOn && !editing ? <AskBar /> : undefined
}

export function Overview() {
  const { settings } = useApp()
  const [offset, setOffset] = useState(0)
  const [editing, setEditing] = useState(false)
  const budget = useAction('get_budget', { offset })
  const askBar = useAskBar(editing)
  const update = useUpdateSettings()
  // Every change is made to the full saved list, so widgets this build cannot
  // draw (from a newer Leeway or an agent) are kept, just not shown.
  const all = settings.dashboard.widgets
  const widgets = drawable(all)
  const saveWidgets = (next: Widget[]) => update.mutate({ dashboard: { widgets: next } })
  const addable = addableTypes(all)
  // Heads up lists the account alerts; the banner stands in only when it is hidden.
  const headsUpShown = widgets.some((widget) => widget.type === 'alerts' && widget.visible)
  // Something urgent moves Heads up under the hero, but never while editing the saved order.
  const urgent = useUrgentHeadsUp(budget.data)
  const visible = widgets.filter((widget) => widget.visible || editing)
  const shown = urgent && !editing ? urgentFirst(visible) : visible

  return (
    <Shell
      actions={
        <button
          type="button"
          className="btn hide-sm"
          aria-pressed={editing}
          onClick={() => setEditing(!editing)}
        >
          <Icon name="sliders" size={16} />
          {editing ? 'Done' : 'Edit layout'}
        </button>
      }
    >
      {editing && (
        <div className="card soft row-between" style={{ padding: '14px 18px' }}>
          <p style={{ fontSize: 14 }}>Move, resize or hide widgets. Your layout saves as you go.</p>
          <button
            type="button"
            className="btn"
            onClick={() => update.mutate({ dashboard: { widgets: DEFAULT_LAYOUT } })}
          >
            Reset layout
          </button>
        </div>
      )}

      {!headsUpShown && <AccountHealth />}
      {!editing && <PaydayNotice />}

      <section className="row-between" style={{ alignItems: 'end' }}>
        <div>
          <p className="eyebrow">Budget period</p>
          <h1 style={{ marginTop: 4 }}>
            {budget.data
              ? periodLabel(budget.data.period.start, budget.data.period.end, settings.locale)
              : ' '}
          </h1>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button
            type="button"
            className="iconbtn"
            aria-label="Previous period"
            onClick={() => setOffset(offset - 1)}
          >
            <Icon name="back" />
          </button>
          <span className="small muted">
            {budget.data &&
              (offset === 0
                ? `Day ${budget.data.period.daysElapsed} of ${budget.data.period.days}`
                : `${-offset} ${-offset === 1 ? 'period' : 'periods'} ago`)}
          </span>
          <button
            type="button"
            className="iconbtn"
            aria-label="Next period"
            disabled={offset >= 0}
            onClick={() => setOffset(offset + 1)}
          >
            <Icon name="forward" />
          </button>
        </div>
      </section>

      <ErrorNote error={update.error} />
      {budget.error && <ErrorNote error={budget.error} />}
      {!budget.data ? (
        <Loading />
      ) : (
        <>
          <Board
            all={all}
            shown={shown}
            editing={editing}
            budget={budget.data}
            offset={offset}
            save={saveWidgets}
            underHero={askBar}
          />
          {editing && addable.length > 0 && (
            <div className="card stack-sm add-widget">
              <p className="muted">Add a widget</p>
              <div className="row wrap" style={{ gap: 8 }}>
                {addable.map((type) => (
                  <button
                    key={type}
                    type="button"
                    className="chip"
                    onClick={() => saveWidgets([...all, { type, size: 'half', visible: true }])}
                  >
                    + {WIDGET_LIBRARY[type]!.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Shell>
  )
}
