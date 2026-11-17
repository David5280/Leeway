import type { AnyAction } from './action.js'
import {
  createAccountAction,
  deleteAccountAction,
  listAccountsAction,
  updateAccountAction,
} from './accounts.js'
import { getBudgetAction } from './budget.js'
import {
  createCategoryAction,
  deleteCategoryAction,
  listCategoriesAction,
  reorderCategoriesAction,
  updateCategoryAction,
} from './categories.js'
import {
  createRuleAction,
  deleteRuleAction,
  listRulesAction,
  previewRuleAction,
  reorderRulesAction,
  updateRuleAction,
} from './rules.js'
import {
  createLinkTokenAction,
  linkBankAction,
  listConnectionsAction,
  reconnectedBankAction,
  removeConnectionAction,
  syncBanksAction,
} from './connections.js'
import { getSettingsAction, updateSettingsAction } from './settings.js'
import {
  completeSetupAction,
  exportConfigAction,
  importConfigAction,
  starterCategoriesAction,
} from './setup.js'
import { createTokenAction, deleteTokenAction, listTokensAction } from './tokens.js'
import {
  categorizeTransactionsAction,
  createTransactionAction,
  deleteTransactionAction,
  listTransactionsAction,
  updateTransactionAction,
} from './transactions.js'

/**
 * Every action in Leeway. The HTTP API and the MCP endpoint are both built
 * from this list, which is what keeps the app and an agent at parity.
 */
export const actionList = [
  getBudgetAction,
  getSettingsAction,
  updateSettingsAction,
  listCategoriesAction,
  createCategoryAction,
  updateCategoryAction,
  deleteCategoryAction,
  reorderCategoriesAction,
  listRulesAction,
  createRuleAction,
  updateRuleAction,
  deleteRuleAction,
  reorderRulesAction,
  previewRuleAction,
  listTransactionsAction,
  updateTransactionAction,
  categorizeTransactionsAction,
  createTransactionAction,
  deleteTransactionAction,
  listAccountsAction,
  createAccountAction,
  updateAccountAction,
  deleteAccountAction,
  listConnectionsAction,
  syncBanksAction,
  createLinkTokenAction,
  linkBankAction,
  reconnectedBankAction,
  removeConnectionAction,
  exportConfigAction,
  importConfigAction,
  starterCategoriesAction,
  completeSetupAction,
  listTokensAction,
  createTokenAction,
  deleteTokenAction,
] as const

export type Actions = (typeof actionList)[number]
export type ActionName = Actions['name']

const byName = new Map<string, AnyAction>(actionList.map((action) => [action.name, action]))

export function findAction(name: string): AnyAction | undefined {
  return byName.get(name)
}
