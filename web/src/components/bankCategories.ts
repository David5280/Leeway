// The bank's own category codes a category can collect, as Plaid names them.

/**
 * Plaid's top-level categories and the detailed ones people reach for most.
 * Any other detailed code (see Plaid's taxonomy) can be typed in.
 */
export const BANK_CATEGORIES = [
  'FOOD_AND_DRINK',
  'FOOD_AND_DRINK_GROCERIES',
  'FOOD_AND_DRINK_RESTAURANT',
  'FOOD_AND_DRINK_FAST_FOOD',
  'FOOD_AND_DRINK_COFFEE',
  'FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR',
  'GENERAL_MERCHANDISE',
  'GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES',
  'GENERAL_SERVICES',
  'ENTERTAINMENT',
  'TRANSPORTATION',
  'TRAVEL',
  'RENT_AND_UTILITIES',
  'HOME_IMPROVEMENT',
  'MEDICAL',
  'PERSONAL_CARE',
  'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS',
  'GOVERNMENT_AND_NON_PROFIT',
  'BANK_FEES',
  'LOAN_PAYMENTS',
  'LOAN_PAYMENTS_CAR_PAYMENT',
  'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
  'INCOME',
  'TRANSFER_IN',
  'TRANSFER_OUT',
]

/** A code as words: FOOD_AND_DRINK is "Food and drink". */
export const bankCategoryLabel = (code: string) => {
  const text = code.toLowerCase().replaceAll('_', ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}
