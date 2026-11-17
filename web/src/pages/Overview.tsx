import { useState, type ComponentType } from 'react'
import type { Settings } from '../api/client'
import { useAction } from '../api/hooks'
import { useUpdateSettings } from '../api/settings'
import { Shell } from '../components/Shell'
import { ErrorNote, Icon, Loading, Segmented } from '../components/ui'
import { useApp } from '../lib/app'
import { periodLabel } from '../lib/format'
import {
  AccountsWidget,
  AlertsWidget,
  CategoriesWidget,
  GlanceWidget,
  LeewayWidget,
  MerchantsWidget,
  PaceWidget,
  RecentWidget,
  TrendsWidget,
  type WidgetProps,
} from '../widgets/widgets'

type Widget = Settings['dashboard']['widgets'][number]
type WidgetType = Widget['type']

/** The widgets that exist so far, in the order the library lists them. */
export const WIDGET_LIBRARY: Partial<
  Record<WidgetType, { name: string; component: ComponentType<WidgetProps> }>
> = {
  leeway: { name: 'Your leeway', component: LeewayWidget },
  glance: { name: 'At a glance', component: GlanceWidget },
  alerts: { name: 'Heads up', component: AlertsWidget },
  categories: { name: 'Categories', component: CategoriesWidget },
  pace: { name: 'Spending pace', component: PaceWidget },
  recent: { name: 'Recent', component: RecentWidget },
  accounts: { name: 'Accounts', component: AccountsWidget },
  merchants: { name: 'Top merchants', component: MerchantsWidget },
  trends: { name: 'Spending over time', component: TrendsWidget },
}

const SIZES = [
  { value: 'half', label: 'Half' },
  { value: 'wide', label: 'Wide' },
  { value: 'full', label: 'Full' },
] as const

export function moveWidget(widgets: Widget[], index: number, by: -1 | 1): Widget[] {
  const target = index + by
  if (target < 0 || target >= widgets.length) return widgets
  const next = [...widgets]
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  return next
}

export function Overview() {
  const { settings } = useApp()
  const [offset, setOffset] = useState(0)
  const [editing, setEditing] = useState(false)
  const budget = useAction('get_budget', { offset })
  const update = useUpdateSettings()
  const widgets = settings.dashboard.widgets.filter((w) => WIDGET_LIBRARY[w.type])
  const saveWidgets = (next: Widget[]) => update.mutate({ dashboard: { widgets: next } })
  const all = settings.dashboard.widgets
  const addable = (Object.keys(WIDGET_LIBRARY) as WidgetType[]).filter(
    (type) => !all.some((w) => w.type === type),
  )

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
                      onChange={(size) =>
                        saveWidgets(all.map((w) => (w === widget ? { ...w, size } : w)))
                      }
                    />
                    <button
                      type="button"
                      className="iconbtn"
                      aria-label={`Move ${entry.name} up`}
                      onClick={() => saveWidgets(moveWidget(all, index, -1))}
                    >
                      <Icon name="up" />
                    </button>
                    <button
                      type="button"
                      className="iconbtn"
                      aria-label={`Move ${entry.name} down`}
                      onClick={() => saveWidgets(moveWidget(all, index, 1))}
                    >
                      <Icon name="down" />
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() =>
                        saveWidgets(
                          all.map((w) => (w === widget ? { ...w, visible: !w.visible } : w)),
                        )
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

export const DEFAULT_LAYOUT: Widget[] = [
  { type: 'leeway', size: 'wide', visible: true },
  { type: 'glance', size: 'half', visible: true },
  { type: 'alerts', size: 'full', visible: true },
  { type: 'categories', size: 'wide', visible: true },
  { type: 'pace', size: 'half', visible: true },
  { type: 'recent', size: 'wide', visible: true },
  { type: 'accounts', size: 'half', visible: true },
]
