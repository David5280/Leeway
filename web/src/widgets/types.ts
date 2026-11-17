// What every dashboard widget receives.

import type { Budget } from '../api/client'

/** The budget for the period on screen, and which period that is (0 is the current one). */
export interface WidgetProps {
  budget: Budget
  offset: number
}
