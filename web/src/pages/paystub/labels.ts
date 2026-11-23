// What every line of a paystub is called on the full review, and how the
// review groups them: general to detailed, pay first, then what is taken
// out, then what the employer adds. Plain words, as a paystub's owner would
// say them, not as payroll prints them.

import type {
  LineGroup,
  LineOf,
  PayLine,
  PayValue,
} from '../../../../server/src/domain/paystubs/lines'

export const PAY_LABELS: Record<PayLine | PayValue, string> = {
  gross: 'Gross pay',
  net: 'Take-home pay',
  hours: 'Hours',
  hourlyRate: 'Hourly rate',
  annualSalary: 'Yearly salary',
}

export const LINE_LABELS: { [G in LineGroup]: Record<LineOf<G>, string> } = {
  earnings: {
    regular: 'Regular pay',
    overtime: 'Overtime',
    bonus: 'Bonus',
    commission: 'Commission',
    other: 'Other earnings',
  },
  taxes: {
    federalIncome: 'Federal income tax',
    stateIncome: 'State income tax',
    local: 'Local tax',
    socialSecurity: 'Social Security',
    medicare: 'Medicare',
    other: 'Other taxes',
  },
  preTax: {
    plan401k: '401(k)',
    plan403b: '403(b)',
    plan457: '457',
    pension: 'Pension',
    hsa: 'HSA',
    fsa: 'FSA',
    health: 'Health insurance',
    dental: 'Dental',
    vision: 'Vision',
    commuter: 'Commuter',
    other: 'Other, before tax',
  },
  postTax: {
    roth401k: 'Roth 401(k)',
    roth403b: 'Roth 403(b)',
    roth457: 'Roth 457',
    afterTax: 'After-tax retirement',
    other: 'Other, after tax',
  },
  employer: {
    match: 'Retirement match',
    hsa: 'HSA',
    pension: 'Pension',
  },
}

/** A group of lines shown together under a heading of its own, inside a section. */
export interface LineBlock {
  group: LineGroup
  /** A small heading above the lines, when a section holds more than one block. */
  heading?: string
}

/** A section of the review: a heading, and the blocks of lines under it. */
export interface Section {
  id: 'pay' | 'taxes' | 'deductions' | 'employer'
  title: string
  blocks: LineBlock[]
}

/**
 * The review's sections in order. Pay leads with gross and take-home (drawn
 * apart, PayFields), then what makes up gross pay.
 */
export const SECTIONS: Section[] = [
  { id: 'pay', title: 'Pay', blocks: [{ group: 'earnings', heading: 'What makes up your pay' }] },
  { id: 'taxes', title: 'Taxes', blocks: [{ group: 'taxes' }] },
  {
    id: 'deductions',
    title: 'Deductions and savings',
    blocks: [
      { group: 'preTax', heading: 'Before tax' },
      { group: 'postTax', heading: 'After tax' },
    ],
  },
  { id: 'employer', title: 'Employer contributions', blocks: [{ group: 'employer' }] },
]
