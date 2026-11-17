// The Overview dashboard: widgets the owner arranges, sizes and hides.

import { useState } from 'react'
import { useAction } from '../api/hooks'
import { useUpdateSettings } from '../api/settings'
import { Shell } from '../components/Shell'
import { ErrorNote, Icon, Loading, Segmented } from '../components/ui'
import { useApp } from '../lib/app'
import { periodLabel } from '../lib/format'
import {
  addableTypes,
  canMove,
  changeWidget,
  DEFAULT_LAYOUT,
  drawable,
  moveWidget,
  SIZES,
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
          <Icon name="customize" size={16} />
          {editing ? 'Done' : 'Customize'}
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
        <div className={editing ? 'grid editing' : 'grid'}>
          {widgets.map((widget) => {
            if (!widget.visible && !editing) return null
            const entry = WIDGET_LIBRARY[widget.type]!
            const Component = entry.component
            const index = all.indexOf(widget)
            return (
              <div
                key={widget.type}
                className={`widget span-${widget.size}`}
                style={widget.visible ? undefined : { opacity: 0.5 }}
              >
                {editing && (
                  <div className="widget-tools">
                    <strong className="grow">{entry.name}</strong>
                    <Segmented
                      label={`${entry.name} size`}
                      value={widget.size}
                      options={SIZES}
                      onChange={(size) => saveWidgets(changeWidget(all, widget.type, { size }))}
                    />
                    <button
                      type="button"
                      className="iconbtn"
                      aria-label={`Move ${entry.name} up`}
                      disabled={!canMove(all, index, -1)}
                      onClick={() => saveWidgets(moveWidget(all, index, -1))}
                    >
                      <Icon name="up" />
                    </button>
                    <button
                      type="button"
                      className="iconbtn"
                      aria-label={`Move ${entry.name} down`}
                      disabled={!canMove(all, index, 1)}
                      onClick={() => saveWidgets(moveWidget(all, index, 1))}
                    >
                      <Icon name="down" />
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() =>
                        saveWidgets(changeWidget(all, widget.type, { visible: !widget.visible }))
                      }
                    >
                      {widget.visible ? 'Hide' : 'Show'}
                    </button>
                  </div>
                )}
                {widget.visible && <Component budget={budget.data} offset={offset} />}
              </div>
            )
          })}
          {editing && addable.length > 0 && (
            <div
              className="span-full card stack-sm"
              style={{
                border: '2px dashed var(--line)',
                background: 'transparent',
                boxShadow: 'none',
              }}
            >
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
        </div>
      )}
    </Shell>
  )
}
