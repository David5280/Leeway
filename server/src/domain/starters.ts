// The starter categories and rules offered at first-run setup, mapped to
// Plaid's personal finance categories (PFC). Codes from both PFC v1 and v2
// are listed where they differ, so either version of a Plaid account files
// the same way. Detailed codes beat broad ones when categorizing, so a
// specific category (Alcohol) wins over its group's catch-all (Dining out).

import { categoryInputSchema, type CategoryInput } from './categories.js'

/** A starter category, plus the names it went by in older starter sets. */
export interface StarterCategory extends CategoryInput {
  /** Older starter names this category replaces, so an upgrade never adds it twice. */
  formerly?: string[]
}

interface StarterOptions {
  kind?: CategoryInput['kind']
  /** Off for bills paid once a period, so they never read as "ahead of pace". */
  trackPace?: boolean
  formerly?: string[]
}

function starter(
  group: string,
  name: string,
  color: string,
  icon: string,
  budgetCents: number | null,
  providerCategories: string[],
  options: StarterOptions = {},
): StarterCategory {
  const { formerly, ...fields } = options
  const category = categoryInputSchema.parse({
    group,
    name,
    color,
    icon,
    budgetCents,
    providerCategories,
    ...fields,
  })
  return formerly ? { ...category, formerly } : category
}

/**
 * Bank transfers that could be between the owner's own accounts or to and from
 * another person. "Sent to people" and "Received from people" both claim them;
 * the amount's sign picks between the two (see chooseCategory).
 */
const ACCOUNT_TRANSFERS = [
  'TRANSFER_IN_ACCOUNT_TRANSFER',
  'TRANSFER_IN_TRANSFER_IN_FROM_APPS',
  'TRANSFER_IN_OTHER_TRANSFER_IN',
  'TRANSFER_OUT_ACCOUNT_TRANSFER',
  'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS',
  'TRANSFER_OUT_OTHER_TRANSFER_OUT',
]

/** The starter set, in display order, grouped under headings. */
export const STARTER_CATEGORIES: StarterCategory[] = [
  starter('Food and drink', 'Groceries', '#5fb878', 'cart', 60000, ['FOOD_AND_DRINK_GROCERIES']),
  starter('Food and drink', 'Dining out', '#f0a04b', 'utensils', 25000, [
    'FOOD_AND_DRINK_RESTAURANT',
    'FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK',
    'FOOD_AND_DRINK',
  ]),
  starter('Food and drink', 'Fast food', '#e8894a', 'burger', 10000, [
    'FOOD_AND_DRINK_FAST_FOOD',
    'FOOD_AND_DRINK_VENDING_MACHINES',
  ]),
  starter('Food and drink', 'Coffee', '#a0785a', 'coffee', 5000, ['FOOD_AND_DRINK_COFFEE']),
  starter('Food and drink', 'Alcohol', '#b5577a', 'glass', 6000, [
    'FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR',
  ]),

  starter(
    'Home',
    'Rent and mortgage',
    '#6c7ae0',
    'key',
    null,
    ['RENT_AND_UTILITIES_RENT', 'LOAN_PAYMENTS_MORTGAGE_PAYMENT'],
    { trackPace: false },
  ),
  starter(
    'Home',
    'Utilities',
    '#7f8cff',
    'bolt',
    25000,
    [
      'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY',
      'RENT_AND_UTILITIES_WATER',
      'RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT',
      'RENT_AND_UTILITIES_INTERNET_AND_CABLE',
      'RENT_AND_UTILITIES_TELEPHONE',
      'RENT_AND_UTILITIES_OTHER_UTILITIES',
      'RENT_AND_UTILITIES',
    ],
    { trackPace: false, formerly: ['Home and utilities'] },
  ),
  starter('Home', 'Home improvement', '#8f9bb3', 'hammer', 10000, [
    'HOME_IMPROVEMENT_FURNITURE',
    'HOME_IMPROVEMENT_HARDWARE',
    'HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE',
    'HOME_IMPROVEMENT_SECURITY',
    'HOME_IMPROVEMENT_OTHER_HOME_IMPROVEMENT',
    'HOME_IMPROVEMENT',
  ]),

  starter('Getting around', 'Gas', '#4f9fd6', 'fuel', 15000, ['TRANSPORTATION_GAS']),
  starter('Getting around', 'Transportation', '#5aa9e6', 'car', 10000, [
    'TRANSPORTATION_TAXIS_AND_RIDE_SHARES',
    'TRANSPORTATION_PUBLIC_TRANSIT',
    'TRANSPORTATION_PARKING',
    'TRANSPORTATION_TOLLS',
    'TRANSPORTATION_BIKES_AND_SCOOTERS',
    'TRANSPORTATION_OTHER_TRANSPORTATION',
    'TRANSPORTATION',
  ]),
  starter('Getting around', 'Car payment', '#3d8bc4', 'car', null, ['LOAN_PAYMENTS_CAR_PAYMENT'], {
    trackPace: false,
  }),
  starter('Getting around', 'Car maintenance', '#6bb5d9', 'wrench', null, [
    'GENERAL_SERVICES_AUTOMOTIVE',
  ]),
  starter('Getting around', 'Travel', '#2fb3a6', 'plane', null, [
    'TRAVEL_FLIGHTS',
    'TRAVEL_LODGING',
    'TRAVEL_RENTAL_CARS',
    'TRAVEL_OTHER_TRAVEL',
    'TRAVEL',
  ]),

  starter('Shopping', 'Shopping', '#c678dd', 'bag', 20000, ['GENERAL_MERCHANDISE']),
  starter('Shopping', 'Clothing', '#d68fe0', 'shirt', 10000, [
    'GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES',
  ]),
  starter('Shopping', 'Gifts and donations', '#e57ba8', 'gift', null, [
    'GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES',
    'GOVERNMENT_AND_NON_PROFIT_DONATIONS',
  ]),
  starter('Shopping', 'Pets', '#c99b5a', 'paw', null, [
    'GENERAL_MERCHANDISE_PET_SUPPLIES',
    'MEDICAL_VETERINARY_SERVICES',
  ]),

  starter('Health and fitness', 'Health', '#e06c75', 'heart', 10000, [
    'MEDICAL_PRIMARY_CARE',
    'MEDICAL_DENTAL_CARE',
    'MEDICAL_EYE_CARE',
    'MEDICAL_NURSING_CARE',
    'MEDICAL_PHARMACIES_AND_SUPPLEMENTS',
    'MEDICAL_OTHER_MEDICAL',
    'MEDICAL',
  ]),
  starter('Health and fitness', 'Personal care', '#ea8a92', 'sparkle', 5000, [
    'PERSONAL_CARE_HAIR_AND_BEAUTY',
    'PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING',
    'PERSONAL_CARE_OTHER_PERSONAL_CARE',
    'PERSONAL_CARE',
  ]),
  starter('Health and fitness', 'Fitness', '#d9534f', 'dumbbell', 5000, [
    'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS',
  ]),

  starter('Fun and subscriptions', 'Entertainment', '#e5c07b', 'ticket', 10000, ['ENTERTAINMENT']),
  // Plaid files streaming services under TV and movies or music; known apps it
  // misfiles (Zwift reads as health) are caught by STARTER_RULES below.
  starter(
    'Fun and subscriptions',
    'Streaming and apps',
    '#56b6c2',
    'repeat',
    5000,
    ['ENTERTAINMENT_TV_AND_MOVIES', 'ENTERTAINMENT_MUSIC_AND_AUDIO'],
    { trackPace: false },
  ),

  starter('Bills and services', 'Insurance', '#7a8fa6', 'shield', null, [
    'GENERAL_SERVICES_INSURANCE',
  ]),
  starter('Bills and services', 'Education', '#61afef', 'book', null, [
    'GENERAL_SERVICES_EDUCATION',
  ]),
  starter('Bills and services', 'Services', '#4fa3ad', 'tool', null, ['GENERAL_SERVICES'], {
    formerly: ['Subscriptions and services'],
  }),
  starter(
    'Bills and services',
    'Taxes and government',
    '#8b8fa3',
    'landmark',
    null,
    [
      'GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT',
      'GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES',
      'GOVERNMENT_AND_NON_PROFIT_OTHER_GOVERNMENT_AND_NON_PROFIT',
      'GOVERNMENT_AND_NON_PROFIT',
    ],
    { trackPace: false },
  ),

  // Every other loan payment: buy now pay later, personal and student loans.
  // Car and mortgage payments have their own categories above. A card payment
  // lands here only when the card is not tracked in Leeway; paid to a tracked
  // card it is a transfer.
  starter(
    'Money',
    'Debt payments',
    '#a07cc5',
    'card',
    null,
    [
      'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
      'LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT',
      'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT',
      'LOAN_PAYMENTS_BNPL',
      'LOAN_PAYMENTS_CASH_ADVANCES',
      'LOAN_PAYMENTS_EWA',
      'LOAN_PAYMENTS_OTHER_PAYMENT',
      'LOAN_PAYMENTS',
    ],
    { trackPace: false },
  ),
  starter('Money', 'Fees', '#9aa0a6', 'receipt', null, ['BANK_FEES']),
  starter('Money', 'Cash and ATM', '#8fbf7f', 'cash', null, ['TRANSFER_OUT_WITHDRAWAL']),
  // A payment through Zelle, Venmo or the like to or from another person is
  // real money out or in, never a transfer (see personToPersonApp).
  starter('Money', 'Sent to people', '#c792ea', 'send', null, ACCOUNT_TRANSFERS),

  starter('Income', 'Income', '#98c379', 'wallet', null, ['INCOME'], { kind: 'income' }),
  starter('Income', 'Received from people', '#7fbf6a', 'inbox', null, ACCOUNT_TRANSFERS, {
    kind: 'income',
  }),

  // Money moving between your own accounts, or borrowed: never spending or
  // income. Which loan payments and bank transfers really are transfers is
  // decided per transaction (see isTransfer in transfers.ts); the rest fall
  // to the categories above.
  starter(
    'Transfers',
    'Transfers',
    '#6b7280',
    'swap',
    null,
    ['TRANSFER_IN', 'TRANSFER_OUT', 'LOAN_PAYMENTS', 'LOAN_DISBURSEMENTS'],
    { kind: 'transfer' },
  ),
]
