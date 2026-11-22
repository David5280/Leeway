import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { actionCaller } from './actionCaller.js'
import { filed, household, MONTHS } from './fixtures/emergency.js'
import { createTestContext, insertBankAccount, resetData } from './helpers.js'

// The test clock reads 2026-11-19 at noon in Denver.
let ctx: AppContext
const caller = actionCaller(() => ctx)
const { call, callError } = caller

beforeAll(async () => {
  ctx = await createTestContext({ now: new Date('2026-11-19T19:00:00Z') })
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  await ctx.db.query(`UPDATE settings SET data = '{"timeZone": "America/Denver"}'`)
})

const owner = () => household(ctx.db, caller)

/** The fund's accounts as id, whether counted, and why any is left out. */
async function accountsOfFund() {
  const fund = await call('get_emergency_fund')
  return fund!.accounts.map((a) => [a.id, a.counted, a.leftOut])
}

describe('the emergency fund offer', () => {
  it('offers one month of essential spending, counting every savings account', async () => {
    const { checking, savings, spare, rent, groceries } = await owner()
    const offer = await call('get_emergency_fund')
    expect(offer).toMatchObject({
      goalId: null,
      essentials: {
        cents: 260_000,
        from: 'spending',
        categories: ['Rent', 'Groceries'],
        categoryIds: [rent, groceries],
        picked: false,
      },
      months: 1,
      ownTarget: false,
      targetCents: 260_000,
      savedCents: 350_000,
      monthsCovered: 1.3,
      next: { months: 3, targetCents: 780_000 },
      counts: 'savings',
    })
    expect(offer!.accounts).toEqual([
      {
        id: checking,
        name: 'Test Checking',
        balanceCents: 400_000,
        counted: false,
        marked: false,
        leftOut: null,
        otherGoal: null,
      },
      expect.objectContaining({ id: savings, counted: true, marked: false }),
      expect.objectContaining({ id: spare, counted: true, marked: false }),
    ])
  })

  it('sizes the offer from the bills before a whole month of spending is held', async () => {
    await call('create_bill', {
      name: 'Rent',
      amountCents: 150_000,
      cadence: 'month',
      anchorDate: '2026-11-01',
    })
    expect(await call('get_emergency_fund')).toMatchObject({
      essentials: { cents: 150_000, from: 'bills', categories: null, categoryIds: null },
      targetCents: 150_000,
    })
  })

  it('offers nothing while there is nothing to size it by', async () => {
    expect(await call('get_emergency_fund')).toBeNull()
    expect((await callError('start_emergency_fund')).message).toContain('a month of spending')
  })

  it('counts all spending, naming no categories, when none reads as essential', async () => {
    const checking = await insertBankAccount(ctx.db, { subtype: 'checking' })
    const fun = await call('create_category', { name: 'Fun' })
    for (const month of MONTHS)
      await filed(ctx.db, checking.accountId, fun.id, `${month}-15`, 90_000)
    expect((await call('get_emergency_fund'))!.essentials).toEqual({
      cents: 90_000,
      from: 'spending',
      categories: null,
      categoryIds: null,
      picked: false,
    })
  })

  it('says which essential categories the owner picked', async () => {
    const { rent } = await owner()
    await call('update_settings', { savingsPlan: { essentialCategoryIds: [rent] } })
    expect((await call('get_emergency_fund'))!.essentials).toMatchObject({
      cents: 200_000,
      categories: ['Rent'],
      picked: true,
    })
  })

  it("keeps the owner's pick when bills size the fund, and lists the categories spent in", async () => {
    const { rent } = await owner()
    await call('update_settings', { savingsPlan: { essentialCategoryIds: [rent] } })
    await ctx.db.query('DELETE FROM transactions')
    await call('create_bill', {
      name: 'Rent',
      amountCents: 150_000,
      cadence: 'month',
      anchorDate: '2026-11-01',
    })
    expect(await call('get_emergency_fund')).toMatchObject({
      essentials: { from: 'bills', categoryIds: null, picked: true },
      essentialsChoice: { pickedIds: [rent], spentIds: [] },
    })
  })

  it('still offers a way back when the picked categories had no spending', async () => {
    const { checking, rent, groceries, fun } = await owner()
    const pets = await call('create_category', { name: 'Pets' })
    // A refund is no spending, so it leaves Pets as quiet as before.
    await filed(ctx.db, checking, pets.id, '2026-10-20', -5_000)
    await call('update_settings', { savingsPlan: { essentialCategoryIds: [pets.id] } })
    const offer = await call('get_emergency_fund')
    expect(offer).toMatchObject({
      goalId: null,
      essentials: null,
      essentialsChoice: { pickedIds: [pets.id] },
      months: null,
      targetCents: 0,
      savedCents: 350_000,
      monthsCovered: null,
      next: null,
    })
    expect(offer!.essentialsChoice.spentIds.sort()).toEqual([rent, groceries, fun].sort())
    // Handing the choice back to Leeway sizes the offer again.
    await call('update_settings', { savingsPlan: { essentialCategoryIds: null } })
    expect(await call('get_emergency_fund')).toMatchObject({
      essentials: { cents: 260_000, picked: false },
      essentialsChoice: { pickedIds: null },
    })
  })

  it('never shows an account mask', async () => {
    await owner()
    await insertBankAccount(ctx.db, { name: 'Vault', subtype: 'savings', mask: '9876' })
    expect(JSON.stringify(await call('get_emergency_fund'))).not.toContain('9876')
  })
})

describe('starting and climbing the emergency fund', () => {
  it('starts in one tap as a goal that follows the savings accounts', async () => {
    await owner()
    const goal = await call('start_emergency_fund')
    expect(goal).toMatchObject({
      name: 'Emergency fund',
      kind: 'savings',
      color: '#1BA876',
      targetCents: 260_000,
      emergencyMonths: 1,
      currentCents: 350_000,
      status: 'reached',
    })
    expect(goal.followedAccountIds).toHaveLength(2)
    expect((await call('get_emergency_fund'))!.goalId).toBe(goal.id)
    // There is only ever one.
    const again = await callError('start_emergency_fund')
    expect(again).toMatchObject({
      code: 'conflict',
      message: 'Emergency fund is already your emergency fund',
    })
  })

  it('climbs to the next step, resized from today’s essential spending', async () => {
    await owner()
    await call('start_emergency_fund')
    const fund = await call('change_emergency_fund', { months: 3 })
    expect(fund).toMatchObject({ months: 3, targetCents: 780_000, next: { months: 6 } })
    const [goal] = await call('list_goals')
    expect(goal).toMatchObject({ targetCents: 780_000, currentCents: 350_000, percent: 44 })
  })

  it('counts only the accounts the owner marks, and every savings account again when cleared', async () => {
    const { checking, savings } = await owner()
    const goal = await call('start_emergency_fund')
    const marked = await call('change_emergency_fund', { accountIds: [savings, checking] })
    expect(marked).toMatchObject({ counts: 'marked', savedCents: 700_000 })
    expect(marked.accounts.filter((a) => a.counted).map((a) => a.id)).toEqual([checking, savings])
    const cleared = await call('change_emergency_fund', { accountIds: [] })
    expect(cleared).toMatchObject({ counts: 'savings', savedCents: 350_000 })
    // A goal that follows accounts updates on its own, so money is not counted by hand.
    const refused = await callError('add_to_goal', { id: goal.id, amountCents: 1_000 })
    expect(refused.message).toBe(
      'Emergency fund follows your savings, so its progress updates on its own',
    )
  })

  it('refuses an account that cannot hold the fund', async () => {
    await owner()
    await call('start_emergency_fund')
    const card = await insertBankAccount(ctx.db, { type: 'credit', balanceCents: 1_000 })
    const error = await callError('change_emergency_fund', { accountIds: [card.accountId] })
    expect(error.message).toContain('only count checking and savings accounts')
  })

  it('takes two saves of the same accounts at once without failing', async () => {
    const { savings, spare } = await owner()
    await call('start_emergency_fund')
    const both = await Promise.all([
      call('change_emergency_fund', { accountIds: [savings, spare] }),
      call('change_emergency_fund', { accountIds: [savings, spare] }),
    ])
    expect(both.map((fund) => fund.savedCents)).toEqual([350_000, 350_000])
    const { rows } = await ctx.db.query('SELECT account_id FROM goal_accounts')
    expect(rows).toHaveLength(2)
  })

  it('marks a named goal as the fund once for two changes at once', async () => {
    const { spare } = await owner()
    await call('create_goal', { name: 'Rainy day', targetCents: 300_000, savedCents: 20_000 })
    await Promise.all([
      call('change_emergency_fund', { accountIds: [spare] }),
      call('change_emergency_fund', { months: 3 }),
    ])
    // Whichever ran first, the second sees the goal marked and keeps the accounts.
    expect(await call('get_emergency_fund')).toMatchObject({
      counts: 'marked',
      months: 3,
      savedCents: 50_000,
    })
  })

  it('starts once for two taps at once, telling the second it is already there', async () => {
    await owner()
    const taps = await Promise.allSettled([
      call('start_emergency_fund'),
      call('start_emergency_fund'),
    ])
    expect(taps.map((tap) => tap.status).sort()).toEqual(['fulfilled', 'rejected'])
    const refused = taps.find((tap) => tap.status === 'rejected')!
    expect(String(refused.reason)).toContain('Emergency fund is already your emergency fund')
    expect(await call('list_goals')).toHaveLength(1)
  })

  it('scales the target from where it stands when essentials are no longer known', async () => {
    await owner()
    await call('start_emergency_fund')
    // Spending gone, and no bills: nothing to size the next step by.
    await ctx.db.query('DELETE FROM transactions')
    const fund = await call('change_emergency_fund', { months: 3 })
    expect(fund).toMatchObject({
      essentials: null,
      months: 3,
      targetCents: 780_000,
      monthsCovered: null,
      next: null,
    })
  })

  it('needs a fund to change', async () => {
    expect((await callError('change_emergency_fund', { months: 3 })).code).toBe('not_found')
  })
})

describe('a fund linked to one account in its form', () => {
  it('shows that account as the one it counts, and keeps it on a save that changes nothing', async () => {
    const { savings, spare } = await owner()
    const goal = await call('start_emergency_fund')
    await call('update_goal', { id: goal.id, accountId: spare })
    const linked = await call('get_emergency_fund')
    expect(linked).toMatchObject({ counts: 'account', savedCents: 50_000 })
    expect(linked!.accounts.filter((a) => a.counted).map((a) => a.id)).toEqual([spare])
    expect(linked!.accounts.find((a) => a.id === spare)).toMatchObject({ marked: true })
    expect((await call('list_goals'))[0]).toMatchObject({
      currentCents: 50_000,
      followedAccountIds: null,
    })

    // Saving the same account the form starts on counts the same money.
    const kept = await call('change_emergency_fund', { accountIds: [spare] })
    expect(kept).toMatchObject({ counts: 'marked', savedCents: 50_000 })

    // Marking other accounts takes over from the one linked in the form.
    await call('update_goal', { id: goal.id, accountId: spare })
    await call('change_emergency_fund', { accountIds: [savings] })
    expect((await call('list_goals'))[0]).toMatchObject({ accountId: null, currentCents: 300_000 })
  })
})

describe('accounts another goal follows', () => {
  it('are never counted twice: the fund leaves out the account a trip follows', async () => {
    const { savings, spare } = await owner()
    const trip = await call('create_goal', {
      name: 'Trip',
      targetCents: 500_000,
      accountId: savings,
    })
    expect(await call('get_emergency_fund')).toMatchObject({
      savedCents: 50_000,
      monthsCovered: 0.1,
    })
    const fund = await call('start_emergency_fund')
    const goals = await call('list_goals')
    expect(goals.map((g) => [g.name, g.currentCents])).toEqual([
      ['Trip', 300_000],
      ['Emergency fund', 50_000],
    ])
    expect(fund.followedAccountIds).toEqual([spare])
    const view = await call('get_emergency_fund')
    expect(view!.accounts.find((a) => a.id === savings)).toMatchObject({
      counted: false,
      leftOut: 'other_goal',
      otherGoal: trip.name,
    })
  })

  it('cannot be marked for the fund', async () => {
    const { savings } = await owner()
    await call('create_goal', { name: 'Trip', targetCents: 500_000, accountId: savings })
    await call('start_emergency_fund')
    const error = await callError('change_emergency_fund', { accountIds: [savings] })
    expect(error.message).toBe(
      "Trip follows that account already, so the emergency fund can't count it too",
    )
  })

  it('drop out of a fund that marked them once another goal follows them', async () => {
    const { savings, spare } = await owner()
    await call('start_emergency_fund')
    await call('change_emergency_fund', { accountIds: [savings, spare] })
    await call('create_goal', { name: 'Trip', targetCents: 500_000, accountId: savings })
    expect(await call('get_emergency_fund')).toMatchObject({ counts: 'marked', savedCents: 50_000 })
    // Still marked, so a save that keeps it is no new mark to refuse.
    const kept = await call('change_emergency_fund', { accountIds: [savings, spare] })
    expect(kept.savedCents).toBe(50_000)
  })
})

describe('a fund linked to an account another goal follows', () => {
  const TAKEN = "Trip follows that account already, so the emergency fund can't count it too"

  it('cannot be linked, as a new named goal or by changing the fund', async () => {
    const { savings, spare } = await owner()
    await call('create_goal', { name: 'Trip', targetCents: 500_000, accountId: savings })
    const named = await callError('create_goal', {
      name: 'Rainy day',
      targetCents: 300_000,
      accountId: savings,
    })
    expect(named).toMatchObject({ code: 'invalid_input', message: TAKEN })

    const fund = await call('start_emergency_fund')
    const linked = await callError('update_goal', { id: fund.id, accountId: savings })
    expect(linked.message).toBe(TAKEN)
    // Any other account is fine.
    await call('update_goal', { id: fund.id, accountId: spare })
    expect((await call('get_emergency_fund'))!.savedCents).toBe(50_000)
  })

  it('cannot become the fund by a new name', async () => {
    const { savings } = await owner()
    await call('create_goal', { name: 'Trip', targetCents: 500_000, accountId: savings })
    const cushion = await call('create_goal', {
      name: 'Cushion',
      targetCents: 300_000,
      accountId: savings,
    })
    const renamed = await callError('update_goal', { id: cushion.id, name: 'Emergency fund' })
    expect(renamed.message).toBe(TAKEN)
  })

  it('counts nothing from it once another goal takes it, before and after the fund is marked', async () => {
    const { savings } = await owner()
    const named = await call('create_goal', {
      name: 'Rainy day',
      targetCents: 300_000,
      accountId: savings,
    })
    await call('create_goal', { name: 'Trip', targetCents: 500_000, accountId: savings })
    const card = await call('get_emergency_fund')
    expect(card).toMatchObject({ goalId: named.id, counts: 'account', savedCents: 0 })
    expect(card!.accounts.find((a) => a.id === savings)).toMatchObject({
      counted: false,
      marked: true,
      leftOut: 'other_goal',
      otherGoal: 'Trip',
    })
    expect((await call('list_goals')).map((g) => [g.name, g.currentCents])).toEqual([
      ['Rainy day', 0],
      ['Trip', 300_000],
    ])

    // A rename alone is no new link to refuse.
    await call('update_goal', { id: named.id, name: 'Rainy day fund' })
    // Marked as the fund by a step, it still counts nothing from that account.
    const climbed = await call('change_emergency_fund', { months: 3 })
    expect(climbed).toMatchObject({ counts: 'account', months: 3, savedCents: 0 })
    const marked = (await call('list_goals')).find((g) => g.id === named.id)
    expect(marked).toMatchObject({ currentCents: 0, followedAccountIds: [] })
  })
})

describe('a hidden marked account', () => {
  it('stays marked and shows as hidden, never switching the fund to every savings account', async () => {
    const { savings, spare } = await owner()
    await call('start_emergency_fund')
    await call('change_emergency_fund', { accountIds: [spare] })
    await ctx.db.query('UPDATE accounts SET hidden = true WHERE id = $1', [spare])

    expect(await call('get_emergency_fund')).toMatchObject({ counts: 'marked', savedCents: 0 })
    expect(await accountsOfFund()).toContainEqual([spare, false, 'hidden'])
    expect((await call('get_emergency_fund'))!.accounts.find((a) => a.id === spare)).toMatchObject({
      marked: true,
    })

    // Keeping the hidden one marked while adding another is allowed.
    const both = await call('change_emergency_fund', { accountIds: [spare, savings] })
    expect(both.savedCents).toBe(300_000)

    // Shown again, it counts again.
    await ctx.db.query('UPDATE accounts SET hidden = false WHERE id = $1', [spare])
    expect((await call('get_emergency_fund'))!.savedCents).toBe(350_000)
  })

  it('cannot be newly marked', async () => {
    const { spare } = await owner()
    await call('start_emergency_fund')
    await ctx.db.query('UPDATE accounts SET hidden = true WHERE id = $1', [spare])
    const error = await callError('change_emergency_fund', { accountIds: [spare] })
    expect(error.message).toContain('accounts you can see')
  })
})

describe('a goal the owner named as an emergency fund', () => {
  it('reads as its own amount, in no months, while essentials are unknown', async () => {
    await call('create_goal', { name: 'Rainy day', targetCents: 300_000, savedCents: 70_000 })
    expect(await call('get_emergency_fund')).toMatchObject({
      essentials: null,
      months: null,
      ownTarget: true,
      targetCents: 300_000,
      savedCents: 70_000,
      monthsCovered: null,
      next: null,
    })
  })

  it('is taken as the fund, as it is, instead of offering a second', async () => {
    await owner()
    const named = await call('create_goal', {
      name: 'My emergency fund',
      targetCents: 300_000,
      savedCents: 50_000,
    })
    expect(await call('get_emergency_fund')).toMatchObject({
      goalId: named.id,
      counts: 'hand',
      ownTarget: true,
      months: 1.2,
      targetCents: 300_000,
      savedCents: 50_000,
      next: { months: 3, targetCents: 780_000 },
    })
    const refused = await callError('start_emergency_fund')
    expect(refused).toMatchObject({
      code: 'conflict',
      message: 'My emergency fund is already your emergency fund',
    })
    expect(await call('list_goals')).toMatchObject([
      { id: named.id, emergencyMonths: null, targetCents: 300_000, currentCents: 50_000 },
    ])
  })

  it('keeps its count by hand when the owner climbs a step', async () => {
    await owner()
    const named = await call('create_goal', {
      name: 'Rainy day',
      targetCents: 300_000,
      savedCents: 50_000,
    })
    const climbed = await call('change_emergency_fund', { months: 3 })
    expect(climbed).toMatchObject({
      counts: 'hand',
      ownTarget: false,
      months: 3,
      targetCents: 780_000,
      savedCents: 50_000,
    })
    const added = await call('add_to_goal', { id: named.id, amountCents: 10_000 })
    expect(added).toMatchObject({ emergencyMonths: 3, currentCents: 60_000 })
  })

  it('keeps its own target when the owner points it at the savings accounts', async () => {
    await owner()
    await call('create_goal', {
      name: 'Emergency savings',
      targetCents: 300_000,
      savedCents: 50_000,
    })
    const counted = await call('change_emergency_fund', { accountIds: [] })
    expect(counted).toMatchObject({
      counts: 'savings',
      ownTarget: true,
      targetCents: 300_000,
      savedCents: 350_000,
    })
  })

  it('goes back to its count by hand after counting accounts, keeping what it counted', async () => {
    await owner()
    await call('create_goal', { name: 'Rainy day', targetCents: 300_000, savedCents: 50_000 })
    const counted = await call('change_emergency_fund', { accountIds: [] })
    expect(counted).toMatchObject({ counts: 'savings', savedCents: 350_000 })
    const byHand = await call('change_emergency_fund', { byHand: true })
    expect(byHand).toMatchObject({ counts: 'hand', savedCents: 50_000 })
    const both = await callError('change_emergency_fund', { byHand: true, accountIds: [] })
    expect(both.code).toBe('invalid_input')
  })

  it('follows the one account it was linked to', async () => {
    const { spare } = await owner()
    await call('create_goal', { name: 'Rainy day', targetCents: 300_000, accountId: spare })
    expect(await call('get_emergency_fund')).toMatchObject({
      counts: 'account',
      savedCents: 50_000,
    })
  })

  it('gives way to a goal already marked as the fund', async () => {
    const { spare } = await owner()
    const fund = await call('start_emergency_fund')
    // Not the fund, so it follows its account as any goal would.
    const named = await call('create_goal', {
      name: 'Rainy day',
      targetCents: 100_000,
      accountId: spare,
    })
    expect(named.currentCents).toBe(50_000)
    expect((await call('get_emergency_fund'))!.goalId).toBe(fund.id)
  })

  it('climbs from its own target while essentials are unknown', async () => {
    await call('create_goal', { name: 'Rainy day', targetCents: 300_000 })
    // Taken as one month, the next step is three times where it stands.
    const climbed = await call('change_emergency_fund', { months: 3 })
    expect(climbed).toMatchObject({ months: 3, ownTarget: false, targetCents: 900_000 })
  })
})

describe("the owner's own target", () => {
  it('is kept as typed, says so, and gives way to a step again', async () => {
    const { checking, rent } = await owner()
    const goal = await call('start_emergency_fund')
    // Saving the form with the target untouched keeps it sized from essentials.
    await call('update_goal', { id: goal.id, targetCents: 260_000, name: 'Cushion' })
    expect(await call('get_emergency_fund')).toMatchObject({ ownTarget: false, months: 1 })

    await call('update_goal', { id: goal.id, targetCents: 500_000 })
    expect(await call('get_emergency_fund')).toMatchObject({
      ownTarget: true,
      months: 1.9,
      targetCents: 500_000,
      next: { months: 3 },
    })
    // Essentials rising ($150 a month more, over the September and October
    // whole months held) leave an own target alone.
    await ctx.db.query(
      `INSERT INTO transactions (account_id, provider_transaction_id, date, name, amount_cents,
         category_id, category_source)
       VALUES ($1, 'more-rent', '2026-10-04', 'More rent', 30000, $2, 'manual')`,
      [checking, rent],
    )
    expect((await call('list_goals'))[0]!.targetCents).toBe(500_000)

    const stepped = await call('change_emergency_fund', { months: 3 })
    expect(stepped).toMatchObject({ ownTarget: false, months: 3, targetCents: 825_000 })
  })

  it('is not taken from a save that leaves the target out after essentials grew', async () => {
    const { checking, rent } = await owner()
    const goal = await call('start_emergency_fund')
    // $150 a month more rent over the two whole months averaged.
    await filed(ctx.db, checking, rent, '2026-10-04', 30_000)
    await call('update_goal', { id: goal.id, name: 'Cushion' })
    expect(await call('get_emergency_fund')).toMatchObject({
      ownTarget: false,
      months: 1,
      targetCents: 275_000,
    })
    // Sending back the target it reads now is no new amount either.
    await call('update_goal', { id: goal.id, targetCents: 275_000 })
    expect((await call('get_emergency_fund'))!.ownTarget).toBe(false)
  })
})
