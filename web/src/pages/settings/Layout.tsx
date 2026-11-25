// Which cards Home shows under Leeway and Heads up, in what order and at what
// size. The same choices as Edit layout on Home, for a phone too narrow for it.

import { Icon, Segmented, Switch } from '../../components/ui'
import { useApp } from '../../lib/app'
import {
  addableTypes,
  canMove,
  changeWidget,
  drawable,
  moveWidget,
  SIZES,
  WIDGET_LIBRARY,
  type Widget,
} from '../../widgets/library'
import { Section, useSave } from './Section'

export function LayoutSection() {
  const { settings } = useApp()
  const save = useSave()
  // Changes go to the full saved list, keeping cards this build cannot draw.
  const all = settings.dashboard.widgets
  const widgets = drawable(all)
  const missing = addableTypes(all)
  const saveWidgets = (next: Widget[]) => save.settings({ dashboard: { widgets: next } })

  return (
    <Section id="layout" title="Home cards" hint="Or press Edit layout on Home">
      <p className="small muted">
        Your leeway and Heads up always lead. Under them, wide cards stack on the left and half
        cards on the right; full cards span the page. On a phone they all follow this order.
      </p>
      {/* The rows sit in their own box so they lay out by the card's width (styles.css). */}
      <div className="layout-rows">
        {widgets.map((widget) => {
          const index = all.indexOf(widget)
          const name = WIDGET_LIBRARY[widget.type]!.name
          return (
            <div key={widget.type} className="list-row layout-row">
              <div className="layout-row-name">
                <Switch
                  label={`Show ${name}`}
                  checked={widget.visible}
                  onChange={(visible) => saveWidgets(changeWidget(all, widget.type, { visible }))}
                />
                <span className={widget.visible ? 'ellipsis' : 'ellipsis muted'}>{name}</span>
              </div>
              <div className="layout-row-controls">
                <Segmented
                  label={`${name} size`}
                  value={widget.size}
                  options={SIZES}
                  onChange={(size) => saveWidgets(changeWidget(all, widget.type, { size }))}
                />
                <div className="layout-row-move" role="group" aria-label={`${name} order`}>
                  <button
                    type="button"
                    className="iconbtn"
                    aria-label={`Move ${name} up`}
                    disabled={!canMove(all, index, -1)}
                    onClick={() => saveWidgets(moveWidget(all, index, -1))}
                  >
                    <Icon name="up" size={16} />
                  </button>
                  <button
                    type="button"
                    className="iconbtn"
                    aria-label={`Move ${name} down`}
                    disabled={!canMove(all, index, 1)}
                    onClick={() => saveWidgets(moveWidget(all, index, 1))}
                  >
                    <Icon name="down" size={16} />
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {missing.length > 0 && (
        <div className="row wrap">
          <span className="small muted">Add:</span>
          {missing.map((type) => (
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
      )}
    </Section>
  )
}
