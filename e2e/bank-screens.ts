// The bank screens the phone layout guard checks (guarded-screens.ts), with
// Plaid and the server's answers stood in for (plaid.ts): adding a bank, from
// the banks already connected to a second login at the same bank, and an
// account the bank no longer shares, on Accounts and in Settings.

import type { RouteName } from '../web/src/routes'
import type { Screen } from './guarded-screens'
import {
  askForSecondLogin,
  checkConnectedBanks,
  confirmRemovingUnshared,
  pickConnectedBankAgain,
  standInForPlaid,
  standInForReturnedAccount,
  standInForUnsharedAccount,
} from './plaid'

/** A screen at a fixed address, named for what it shows there. */
const screen = (
  route: RouteName,
  path: string,
  name: string,
  more: Pick<Screen, 'before' | 'then'>,
): Screen => ({ name: `${path} ${name}`, route, path: () => path, ...more })

export const BANK_SCREENS: Screen[] = [
  screen('settings', '/settings/banks', 'with banks connected', { before: standInForPlaid }),
  screen('settings', '/settings/banks', 'before adding another bank', {
    before: standInForPlaid,
    then: checkConnectedBanks,
  }),
  screen('settings', '/settings/banks', 'when the bank picked is already connected', {
    before: standInForPlaid,
    then: pickConnectedBankAgain,
  }),
  screen('settings', '/settings/banks', 'confirming a second login at the same bank', {
    before: standInForPlaid,
    then: askForSecondLogin,
  }),
  screen('accounts', '/accounts', 'with an account no longer shared', {
    before: standInForUnsharedAccount,
  }),
  screen('settings', '/settings/accounts', 'with an account no longer shared', {
    before: standInForUnsharedAccount,
  }),
  screen('settings', '/settings/accounts', 'with an account that may be back under a new id', {
    before: standInForReturnedAccount,
  }),
  screen('settings', '/settings/accounts', 'confirming removal of an account no longer shared', {
    before: standInForUnsharedAccount,
    then: confirmRemovingUnshared,
  }),
]
