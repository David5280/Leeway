// Words for the Notifications settings: what each kind of alert is, the
// choices for each threshold, and the line under push for this device.
// Pure, no React.

import type { Output } from '../../../api/client'
import type { PushSupport } from '../../../lib/push'
import type { NotificationKind } from '../../../../../server/src/domain/notifications/settings'

export type NotificationsView = Output<'get_notification_settings'>
export type NotificationChoices = NotificationsView['settings']

export const KIND_TEXT: Record<NotificationKind, { label: string; hint: string }> = {
  overdrawn: { label: 'Overdrawn', hint: 'A checking or savings account below zero' },
  over_limit: { label: 'Over a credit limit', hint: 'A card past its limit' },
  overdraft_fee: { label: 'Overdraft fees', hint: 'A fee charged for a short balance' },
  low_balance: {
    label: 'Low balance',
    hint: "Money available below an account's warning, set in Accounts",
  },
  over_budget: { label: 'Budgets', hint: 'A category reaching the share of its budget below' },
  bill_due: { label: 'Bills due', hint: 'A bill not on autopay, coming due' },
  large_transaction: {
    label: 'Large charges',
    hint: 'A single charge of at least the amount below',
  },
  bank_login: { label: 'Bank sign-in', hint: 'A bank that needs you to sign in again' },
  ai_limit: { label: 'AI limit', hint: "This month's AI spending reaching its limit" },
}

/** The shares of a budget offered: from half to double. */
export const BUDGET_PERCENTS = [50, 75, 80, 90, 100, 110, 125, 150, 200]

/** Days before a bill's due date: 0 (on the day) to 14. */
export const BILL_DAYS = Array.from({ length: 15 }, (_, days) => days)

export function billDaysLabel(days: number): string {
  if (days === 0) return 'On the day'
  return days === 1 ? '1 day before' : `${days} days before`
}

/** What a device's push state means, in one plain line, or null when push can be turned on. */
export function supportLine(support: PushSupport): string | null {
  if (support === 'home-screen') {
    return 'On iPhone and iPad, add Leeway to your Home Screen first: tap Share, then Add to Home Screen, and open it from there.'
  }
  if (support === 'unsupported') {
    return "This browser can't show notifications. The inbox still collects every alert."
  }
  if (support === 'denied') {
    return "Notifications are blocked for Leeway in this browser's settings. Allow them there, then come back."
  }
  return null
}

/** How many devices get pushes, besides or including this one. */
export function devicesLine(devices: number, thisDevice: boolean): string {
  if (devices === 0) return 'No device gets pushes yet.'
  const others = thisDevice ? devices - 1 : devices
  if (thisDevice) {
    if (others === 0) return 'Push is on for this device.'
    return `Push is on for this device and ${others} other${others === 1 ? '' : 's'}.`
  }
  return `Push is on for ${devices} other device${devices === 1 ? '' : 's'}.`
}

/** A patch over the stored choices, as the screen shows them while the change saves. */
export function withPatch(
  choices: NotificationChoices,
  patch: Partial<{
    kinds: Partial<NotificationChoices['kinds']>
    quietHours: Partial<NotificationChoices['quietHours']>
    overBudgetPercent: number
    billDueDays: number
    largeTransactionCents: number
  }>,
): NotificationChoices {
  return {
    ...choices,
    ...patch,
    kinds: { ...choices.kinds, ...patch.kinds },
    quietHours: { ...choices.quietHours, ...patch.quietHours },
  }
}
