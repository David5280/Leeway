// Home: "Am I OK right now?" It reads top to bottom as the map has it:
// Leeway (what you can spend), Heads up (only when something needs the
// owner), a payday nudge in the days after one, then the cards the owner
// arranges, by default every account, the bills coming up before payday,
// the latest activity and a row with each tab's summary. Leeway and Heads up
// are drawn here, fixed, so nothing urgent can be hidden or moved down; the
// rest can be added, hidden, resized and reordered. Home is always now:
// looking back at an earlier period is Spending's job.

import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAction } from '../api/hooks'
import { useUpdateSettings } from '../api/settings'
import { Shell } from '../components/Shell'
import { ErrorNote, Icon, Loading } from '../components/ui'
import { useApp } from '../lib/app'
import { AlertsWidget } from '../widgets/Alerts'
import { Board } from '../widgets/Board'
import { LeewayWidget } from '../widgets/Leeway'
import {
  addableTypes,
  DEFAULT_LAYOUT,
  drawable,
  WIDGET_LIBRARY,
  type Widget,
} from '../widgets/library'
import { useSelectedAccount } from './OldAddresses'
import { PaydayNotice } from './overview/PaydayNotice'

export function Overview() {
  const selected = useSelectedAccount()
  if (selected) return <Navigate to={selected} replace />
  return <Home />
}

/** Home's cards, once no old link to one account is being sent on. */
function Home() {
  const { settings } = useApp()
  const [editing, setEditing] = useState(false)
  const budget = useAction('get_budget', { offset: 0 })
  const update = useUpdateSettings()
  // Every change is made to the full saved list, so the fixed Leeway and
  // Heads up keep their place in it.
  const all = settings.dashboard.widgets
  const saveWidgets = (next: Widget[]) => update.mutate({ dashboard: { widgets: next } })
  // Hidden cards show, faded, only while editing.
  const shown = drawable(all).filter((widget) => widget.visible || editing)

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
      <h1 className="visually-hidden">Home</h1>
      <ErrorNote error={update.error} />
      {budget.error && <ErrorNote error={budget.error} />}
      {!budget.data ? (
        <Loading />
      ) : (
        <>
          <LeewayWidget budget={budget.data} />
          <AlertsWidget budget={budget.data} />
          {!editing && <PaydayNotice />}
          {editing && <EditingNote reset={() => saveWidgets(DEFAULT_LAYOUT)} />}
          <Board
            all={all}
            shown={shown}
            editing={editing}
            budget={budget.data}
            save={saveWidgets}
          />
          {editing && <AddCards all={all} save={saveWidgets} />}
        </>
      )}
    </Shell>
  )
}

/** While editing: what can change, and the way back to the map's order. */
function EditingNote({ reset }: { reset: () => void }) {
  return (
    <div className="card soft stack-sm">
      <p className="small">
        Move, resize or hide the cards below. Your leeway and Heads up stay at the top. Your layout
        saves as you go.
      </p>
      <span className="row">
        <button type="button" className="btn" onClick={reset}>
          Reset layout
        </button>
      </span>
    </div>
  )
}

/** While editing: a button for each card not on Home yet. */
function AddCards({ all, save }: { all: Widget[]; save: (widgets: Widget[]) => void }) {
  const addable = addableTypes(all)
  if (addable.length === 0) return null
  return (
    <div className="card stack-sm add-widget">
      <p className="muted">Add a card</p>
      <div className="row wrap">
        {addable.map((type) => (
          <button
            key={type}
            type="button"
            className="chip"
            onClick={() => save([...all, { type, size: 'half', visible: true }])}
          >
            + {WIDGET_LIBRARY[type]!.name}
          </button>
        ))}
      </div>
    </div>
  )
}
