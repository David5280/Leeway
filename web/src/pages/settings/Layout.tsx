// Which widgets the Overview shows, in what order and at what size.

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
  // Changes go to the full saved list, keeping widgets this build cannot draw.
  const all = settings.dashboard.widgets
  const widgets = drawable(all)
  const missing = addableTypes(all)
  const saveWidgets = (next: Widget[]) => save.settings({ dashboard: { widgets: next } })

  return (
    <Section id="layout" title="Dashboard" hint="Or press Edit layout on the overview">
      <p className="small muted">
        Wide widgets stack on the left and half widgets on the right; full widgets span the page. On
        a phone they all follow this order.
      </p>
      {widgets.map((widget) => {
        const index = all.indexOf(widget)
        const name = WIDGET_LIBRARY[widget.type]!.name
        return (
          <div key={widget.type} className="list-row wrap layout-row">
            <Switch
              label={`Show ${name}`}
              checked={widget.visible}
              onChange={(visible) => saveWidgets(changeWidget(all, widget.type, { visible }))}
            />
            <span className={widget.visible ? 'grow ellipsis' : 'grow ellipsis muted'}>{name}</span>
            <Segmented
              label={`${name} size`}
              value={widget.size}
              options={SIZES}
              onChange={(size) => saveWidgets(changeWidget(all, widget.type, { size }))}
            />
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
        )
      })}
      {missing.length > 0 && (
        <div className="row wrap">
          <span className="small muted">Add:</span>
          {missing.map((type) => (
            <button
              key={type}
              type="button"
              className="chip"
              onClick={() => saveWidgets([...all, { type, size: 'wide', visible: true }])}
            >
              + {WIDGET_LIBRARY[type]!.name}
            </button>
          ))}
        </div>
      )}
    </Section>
  )
}
