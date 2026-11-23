// The account alerts on the home screen, and hiding one there. Hiding takes
// the row away at once, before the server answers, and puts it back if the
// server refuses. Only the home list changes: the inbox and the Alerts page
// still show every alert.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { call, type AccountAlert, type Input, type Output } from './client'
import { useAction } from './hooks'

/** The home list's place in the cache, as useAction keys it. */
export const HOME_ALERTS_KEY = ['action', 'list_home_alerts', {}] as const

/** The home list: the alerts to show, and how many current ones are put away. */
export type HomeAlerts = Output<'list_home_alerts'>

/** The alerts the home screen shows: every current one, less those put away. */
export function useHomeAlerts() {
  return useAction('list_home_alerts')
}

type Target = Input<'hide_home_alert'>

/** Whether an alert is the one being hidden: one alert per kind and account, per bill and per charge. */
const isTarget = (alert: AccountAlert, target: Target) =>
  alert.kind === target.kind &&
  alert.accountId === target.accountId &&
  alert.bill?.id === target.billId &&
  alert.charge?.id === target.chargeId

/** Hides an alert from the home screen, taking its row away at once. */
export function useHideHomeAlert() {
  const client = useQueryClient()
  return useMutation<Output<'hide_home_alert'>, Error, Target, { before?: HomeAlerts }>({
    mutationFn: (target) => call('hide_home_alert', target),
    onMutate: async (target) => {
      // A read already on its way could land after this and bring the row back.
      await client.cancelQueries({ queryKey: HOME_ALERTS_KEY })
      const before = client.getQueryData<HomeAlerts>(HOME_ALERTS_KEY)
      client.setQueryData<HomeAlerts>(
        HOME_ALERTS_KEY,
        (home) =>
          home && {
            alerts: home.alerts.filter((alert) => !isTarget(alert, target)),
            hidden: home.hidden + 1,
          },
      )
      return { before }
    },
    onError: (_error, _target, context) => {
      client.setQueryData(HOME_ALERTS_KEY, context?.before)
    },
    onSettled: () => client.invalidateQueries({ queryKey: HOME_ALERTS_KEY }),
  })
}
