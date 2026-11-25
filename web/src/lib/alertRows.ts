// How many alert rows a card shows before "See all in Inbox", and how it counts
// the rest. Shared by Heads up, the banner standing in for it and the alert
// cards on the account screens, so each stays short in the same way.

/** Rows an alert card shows before "See all in Inbox". */
export const ALERT_ROWS = 3

/** "2 more alerts" or "1 more alert". */
export function moreAlerts(count: number): string {
  return `${count} more ${count === 1 ? 'alert' : 'alerts'}`
}
