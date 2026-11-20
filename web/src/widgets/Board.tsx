// Draws the dashboard: widgets in bands and columns (see arrange.ts), each
// with its editing tools while the owner customizes.

import type { Budget } from '../api/client'
import { Icon, Segmented } from '../components/ui'
import { arrange, type Band } from './arrange'
import { canMove, changeWidget, moveWidget, SIZES, WIDGET_LIBRARY, type Widget } from './library'

interface BoardProps {
  /** The full saved list, widgets this build cannot draw included. */
  all: Widget[]
  /** The widgets to draw, in saved order (but see urgentFirst): hidden ones only while editing. */
  shown: Widget[]
  editing: boolean
  budget: Budget
  offset: number
  save: (widgets: Widget[]) => void
}

export function Board(props: BoardProps) {
  return (
    <div className={props.editing ? 'board editing' : 'board'}>
      {arrange(props.shown).map((band) => (
        <BandView key={bandKey(band)} band={band} {...props} />
      ))}
    </div>
  )
}

/** A key that stays the same while a band holds the same widgets. */
function bandKey(band: Band): string {
  if (band.kind === 'full') return band.widget.type
  if (band.kind === 'split') return [...band.main, ...band.side].map((w) => w.type).join('+')
  return band.columns
    .flat()
    .map((w) => w.type)
    .join('+')
}

function BandView({ band, ...props }: BoardProps & { band: Band }) {
  if (band.kind === 'full') return <Slot widget={band.widget} {...props} />
  const columns = band.kind === 'split' ? [band.main, band.side] : band.columns
  return (
    <div className={`band ${band.kind}`}>
      {columns.map((column, c) => (
        <div key={c} className="band-column">
          {column.map((widget) => (
            // A phone shows one column, and uses each widget's saved place to keep the owner's order.
            <Slot
              key={widget.type}
              widget={widget}
              order={props.shown.indexOf(widget)}
              {...props}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/** One widget, faded while hidden in edit mode, with its tools above it. */
function Slot({
  widget,
  order,
  all,
  editing,
  budget,
  offset,
  save,
}: BoardProps & { widget: Widget; order?: number }) {
  const entry = WIDGET_LIBRARY[widget.type]!
  const Component = entry.component
  return (
    <div
      className="widget rise-in"
      data-size={widget.size}
      // --i staggers the cards rising in, in the owner's order (styles/motion.css).
      style={{
        order,
        opacity: widget.visible ? undefined : 0.5,
        ['--i' as string]: all.indexOf(widget),
      }}
    >
      {editing && <Tools widget={widget} name={entry.name} all={all} save={save} />}
      {widget.visible && <Component budget={budget} offset={offset} />}
    </div>
  )
}

function Tools({
  widget,
  name,
  all,
  save,
}: {
  widget: Widget
  name: string
  all: Widget[]
  save: (widgets: Widget[]) => void
}) {
  const index = all.indexOf(widget)
  return (
    <div className="widget-tools">
      <strong className="widget-tools-name ellipsis">{name}</strong>
      <Segmented
        label={`${name} size`}
        value={widget.size}
        options={SIZES}
        onChange={(size) => save(changeWidget(all, widget.type, { size }))}
      />
      <button
        type="button"
        className="iconbtn"
        aria-label={`Move ${name} up`}
        disabled={!canMove(all, index, -1)}
        onClick={() => save(moveWidget(all, index, -1))}
      >
        <Icon name="up" />
      </button>
      <button
        type="button"
        className="iconbtn"
        aria-label={`Move ${name} down`}
        disabled={!canMove(all, index, 1)}
        onClick={() => save(moveWidget(all, index, 1))}
      >
        <Icon name="down" />
      </button>
      <button
        type="button"
        className="btn small"
        onClick={() => save(changeWidget(all, widget.type, { visible: !widget.visible }))}
      >
        {widget.visible ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}
