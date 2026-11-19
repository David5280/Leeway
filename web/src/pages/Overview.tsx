// The Overview dashboard: widgets the owner arranges, sizes and hides.

import { useState } from 'react'
import { useAction } from '../api/hooks'
import { useUpdateSettings } from '../api/settings'
import { Shell } from '../components/Shell'
import { ErrorNote, Icon, Loading } from '../components/ui'
import { useApp } from '../lib/app'
import { periodLabel } from '../lib/format'
import { Board } from '../widgets/Board'
import { AccountHealth } from './overview/AccountHealth'
import {
  addableTypes,
  DEFAULT_LAYOUT,
  drawable,
  WIDGET_LIBRARY,
  type Widget,
} from '../widgets/library'

export function Overview() {
  const { settings } = useApp()
  const [offset, setOffset] = useState(0)
  const [editing, setEditing] = useState(false)
  const budget = useAction('get_budget', { offset })
  const update = useUpdateSettings()
  // Every change is made to the full saved list, so widgets this build cannot
  // draw (from a newer Leeway or an agent) are kept, just not shown.
  const all = settings.dashboard.widgets
  const widgets = drawable(all)
  const saveWidgets = (next: Widget[]) => update.mutate({ dashboard: { widgets: next } })
  const addable = addableTypes(all)

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

      <AccountHealth />

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
            shown={widgets.filter((widget) => widget.visible || editing)}
            editing={editing}
            budget={budget.data}
            offset={offset}
            save={saveWidgets}
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
