// The payday playbook (get_payday_playbook): the pay period that just
// closed, ideas for what was left, and the plan for the new paycheck. One
// read shared by the Payday section and the Overview notice, so both say
// the same thing. Read only: Leeway never moves money.

import { useAction } from './hooks'

/** The playbook as of today, cached like every other action read. */
export function usePaydayPlaybook() {
  return useAction('get_payday_playbook')
}
