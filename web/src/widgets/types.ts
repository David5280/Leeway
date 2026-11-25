// What every dashboard widget receives.

import type { Budget } from '../api/client'

/** The budget for the current period: Home is always now (Spending looks back). */
export interface WidgetProps {
  budget: Budget
}
