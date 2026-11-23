// Every action, in one list: the HTTP API and the MCP endpoint both read it.

import type { AnyAction } from './action.js'
import {
  createAccountAction,
  deleteAccountAction,
  listAccountsAction,
  listAlertsAction,
  summarizeAccountsAction,
  updateAccountAction,
} from './accounts.js'
import { dismissAiAlertAction, getAiUsageAction, setAiLimitAction, setAiModelAction } from './ai.js'
import {
  createBillAction,
  deleteBillAction,
  dismissRecurringAction,
  findRecurringAction,
  listBillsAction,
  trackRecurringAction,
  updateBillAction,
} from './bills.js'
import { getBudgetAction } from './budget.js'
import { getCardInterestAction } from './cardInterest.js'
import { hideHomeAlertAction, listHomeAlertsAction } from './homeAlerts.js'
import { canIAffordAction, getCheckinAction, whenCanIAffordAction } from './coach.js'
import {
  answerConnectRequestAction,
  disconnectAppAction,
  getConnectRequestAction,
  listConnectedAppsAction,
} from './connectedApps.js'
import {
  createCategoryAction,
  deleteCategoryAction,
  listCategoriesAction,
  reorderCategoriesAction,
  updateCategoryAction,
} from './categories.js'
import {
  getSpendingPaceAction,
  getTrendsAction,
  getMonthlyTotalsAction,
  getSavingsRatesAction,
  suggestBudgetsAction,
  suggestStarterBudgetsAction,
  topMerchantsAction,
} from './insights.js'
import {
  addToGoalAction,
  createGoalAction,
  deleteGoalAction,
  listGoalContributionsAction,
  listGoalsAction,
  updateGoalAction,
} from './goals.js'
import {
  changeEmergencyFundAction,
  getEmergencyFundAction,
  getGoalOrderAction,
  reorderGoalsAction,
  startEmergencyFundAction,
} from './goalPlans.js'
import { importTransactionsAction, listImportsAction, undoImportAction } from './imports.js'
import {
  countNotificationsAction,
  dismissNotificationAction,
  getNotificationSettingsAction,
  listNotificationsAction,
  markNotificationsReadAction,
  sendTestPushAction,
  subscribePushAction,
  unsubscribePushAction,
  updateNotificationSettingsAction,
} from './notifications.js'
import {
  getCashFlowAction,
  getNetWorthAction,
  listRecentBalancesAction,
  planDebtPayoffAction,
} from './planning.js'
import { addOwnedOrOwedAction, listOwnedAndOwedAction, updateOwnedOrOwedAction } from './owned.js'
import { getIdleCashAction } from './idleCash.js'
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
import {
  calendarStatusAction,
  connectCalendarAction,
  disconnectCalendarAction,
  getForecastAction,
  refreshCalendarAction,
} from './calendar.js'
import { getTripAction, listTripsAction, tripOfTransactionAction } from './trips.js'
import {
  deletePaystubAction,
  getPaystubAction,
  savePaystubAction,
  savePaystubDetailAction,
} from './paystubs.js'
import { getFinancialProfileAction, summarizeSavingsAction } from './savings.js'
import {
  attachPensionAction,
  createPensionAction,
  projectRetirementAction,
  updatePensionAction,
} from './retirement.js'
import { getSettingsAction, updateSettingsAction } from './settings.js'
import { getSummaryAction, setAiSummaryAction } from './summary.js'
import {
  completeSetupAction,
  exportConfigAction,
  importConfigAction,
  starterCategoriesAction,
} from './setup.js'
import { exportTaxYearAction } from './taxExport.js'
import { createTokenAction, deleteTokenAction, listTokensAction } from './tokens.js'
import { createWidgetTokenAction, getWidgetTokenAction, revokeWidgetTokenAction } from './widget.js'
import {
  getWeeklyEmailAction,
  sendTestWeeklyEmailAction,
  setWeeklyEmailAction,
} from './weeklyEmail.js'
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
  getCheckinAction,
  getSummaryAction,
  canIAffordAction,
  whenCanIAffordAction,
  getBudgetAction,
  getTrendsAction,
  getMonthlyTotalsAction,
  getSavingsRatesAction,
  getSpendingPaceAction,
  topMerchantsAction,
  suggestBudgetsAction,
  getSettingsAction,
  updateSettingsAction,
  setAiSummaryAction,
  getAiUsageAction,
  setAiModelAction,
  setAiLimitAction,
  dismissAiAlertAction,
  getWeeklyEmailAction,
  setWeeklyEmailAction,
  sendTestWeeklyEmailAction,
  countNotificationsAction,
  listNotificationsAction,
  markNotificationsReadAction,
  dismissNotificationAction,
  getNotificationSettingsAction,
  updateNotificationSettingsAction,
  subscribePushAction,
  unsubscribePushAction,
  sendTestPushAction,
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
  importTransactionsAction,
  listImportsAction,
  undoImportAction,
  listAccountsAction,
  summarizeAccountsAction,
  listAlertsAction,
  listHomeAlertsAction,
  hideHomeAlertAction,
  createAccountAction,
  updateAccountAction,
  getCardInterestAction,
  deleteAccountAction,
  summarizeSavingsAction,
  getFinancialProfileAction,
  projectRetirementAction,
  createPensionAction,
  attachPensionAction,
  updatePensionAction,
  getPaystubAction,
  savePaystubAction,
  savePaystubDetailAction,
  deletePaystubAction,
  listBillsAction,
  createBillAction,
  updateBillAction,
  deleteBillAction,
  findRecurringAction,
  trackRecurringAction,
  dismissRecurringAction,
  listGoalsAction,
  createGoalAction,
  updateGoalAction,
  addToGoalAction,
  listGoalContributionsAction,
  deleteGoalAction,
  getGoalOrderAction,
  reorderGoalsAction,
  getEmergencyFundAction,
  startEmergencyFundAction,
  changeEmergencyFundAction,
  getNetWorthAction,
  listOwnedAndOwedAction,
  addOwnedOrOwedAction,
  updateOwnedOrOwedAction,
  listRecentBalancesAction,
  planDebtPayoffAction,
  getCashFlowAction,
  getIdleCashAction,
  calendarStatusAction,
  connectCalendarAction,
  refreshCalendarAction,
  disconnectCalendarAction,
  getForecastAction,
  listTripsAction,
  getTripAction,
  tripOfTransactionAction,
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
  suggestStarterBudgetsAction,
  listTokensAction,
  createTokenAction,
  deleteTokenAction,
  getWidgetTokenAction,
  createWidgetTokenAction,
  revokeWidgetTokenAction,
  listConnectedAppsAction,
  disconnectAppAction,
  getConnectRequestAction,
  answerConnectRequestAction,
  exportTaxYearAction,
] as const

export type Actions = (typeof actionList)[number]
export type ActionName = Actions['name']

const byName = new Map<string, AnyAction>(actionList.map((action) => [action.name, action]))

export function findAction(name: string): AnyAction | undefined {
  return byName.get(name)
}
