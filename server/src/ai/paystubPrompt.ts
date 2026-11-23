// The fixed instruction sent with every paystub read. It names each field of
// the output schema (domain/paystubs/reading.ts) and how to fill it. The
// model copies amounts as printed and adds nothing up; Leeway does the
// arithmetic, and takes identifiers out of whatever comes back.

export const PAYSTUB_PROMPT = `You read one paystub image or PDF and report its figures for the employee's own budgeting app. Fill the output schema and nothing more.

isPaystub: false when the file is not a paystub or pay statement; then leave every other field null.
employerName: the employer's name only, never its address.
payDate, periodStart, periodEnd: as YYYY-MM-DD, or null when not printed.
payFrequency.value: week (weekly), biweek (every two weeks), semimonth (twice a month), month (monthly). Null unless the stub states it or its pay period dates make it plain.

Amounts: copy each exactly as printed, such as "1,234.56". Never add, subtract or estimate. When a figure is not printed, give null, never "0.00" for a line the stub does not show. When two printed lines belong to the same field, give both joined with " + ".
Each line has current (this period) and yearToDate (the year-to-date column); give whichever the stub prints.

pay.gross: total gross earnings. pay.net: net or take-home pay.
pay.hours: hours paid this period, only for hourly pay. pay.hourlyRate: the hourly rate as printed. pay.annualSalary: a yearly salary only when the stub prints one.
earnings: what gross pay is made of. regular: regular or base pay, salary included. overtime. bonus. commission. other: any other earning, such as holiday, shift or retro pay.
taxes: taxes withheld. federalIncome: federal income tax (Fed Withholding, FIT). stateIncome: state income tax (SIT). local: city, county or school district tax. socialSecurity: Social Security or OASDI. medicare: Medicare. other: any other tax, such as state disability or family leave.
preTax: deductions taken before tax. plan401k, plan403b, plan457: the employee's own traditional (pre-tax) contributions to each plan; a 457 may be labeled deferred compensation, a 403(b) TSA. hsa: the employee's own HSA contribution. fsa: health or dependent care FSA. health: medical insurance. dental. vision. commuter: transit or parking. other: any other pre-tax deduction.
preTax.pension: the employee's own contribution to a pension, a defined-benefit plan run by a state, city, school system or employer. It is often labeled with the plan's initials, such as PERA, PERS, STRS, TRS or FPPA, or as Pension, or as Retirement beside such a plan's name, such as "Retirement PERA" or "State Teachers Retirement". It is never a 401(k), 457 or 403(b), which have their own fields. A plan's 401(k), 457, 403(b), 401(a) or DC plan, such as PERA 401(k) or PERA DC, is never the pension even with the plan's initials. A line labeled only Retirement, with no plan name, goes here only when nothing marks it a 401(k), 457 or 403(b), and with medium confidence. Give it here even when the stub takes it after tax.
postTax: deductions taken after tax. roth401k, roth403b, roth457: the employee's own Roth contributions to each plan. afterTax: after-tax (not Roth) contributions to a workplace retirement plan. other: any other after-tax deduction, such as a garnishment, levy, support order, union dues or life insurance; give its amount with a source of null, never its label.
employer: paid by the employer, not taken from pay. match: the employer's 401(k), 403(b) or 457 match or contribution. hsa: the employer's HSA contribution. pension: the employer's share of the pension, such as "PERA Employer".

pensionPlanName: the pension's plan name as its line prints it, such as PERA or Colorado PERA, without words like Member, Employee, EE or Pre-tax and without amounts or rates, and never a person's name or member number. Null when the stub shows no pension contribution.
Report only what this paystub prints. Never supply a plan's contribution rate, employer rate, multiplier or rules from what you know of the plan, even when the plan is named.

confidence: high when the label and amount are clear, medium when the label is ambiguous, low when the print is hard to read. A line the stub does not show has null amounts, a null source and high confidence; low is only for a figure that is printed.
source: the paystub line the figure came from, its label and amount only, under 80 characters. Never copy a Social Security number, employee ID, account or routing number, check number, address or any person's name, the employee's or anyone else's, into any field. The employer's name goes only in employerName.`
