// The Import screen: choosing a CSV file, checking Leeway's guess at its
// columns against a preview, picking the account and importing, then undoing.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Output } from '../../api/client'
import {
  account,
  failing,
  fakeServer,
  holdRequest,
  renderSignedIn,
  settingsWith,
} from '../../test/fake'
import { ImportTransactions } from '../ImportTransactions'

afterEach(() => vi.unstubAllGlobals())

const checking = account({ id: 'acct-1', name: 'Checking' })
const cash = account({
  id: 'acct-2',
  name: 'Cash',
  manual: true,
  connectionId: null,
  institutionName: null,
})

const BANK_CSV = [
  'Transaction Date,Description,Category,Amount',
  '11/02/2026,STARBUCKS #12,Coffee,-4.50',
  '11/03/2026,PAYROLL ACME,,2500.00',
  '11/04/2026,SAFEWAY,Groceries,-95.10',
  '13/45/2026,BROKEN,,-1.00',
].join('\n')

function imported(
  fields: Partial<Output<'import_transactions'>> = {},
): Output<'import_transactions'> {
  return {
    importId: 'imp-1',
    account: checking,
    added: 3,
    alreadyThere: 0,
    repeatsInFile: 0,
    skippedByDate: 0,
    bankHistoryStarts: null,
    unknownCategories: [],
    ...fields,
  }
}

function serve(
  handlers: Parameters<typeof fakeServer>[0] = {},
  routes: Parameters<typeof fakeServer>[1] = {},
) {
  return fakeServer(
    {
      list_accounts: () => [checking, cash],
      list_imports: () => [],
      import_transactions: () => imported(),
      undo_import: () => ({ removed: 3 }),
      ...handlers,
    },
    routes,
  )
}

function csv(text: string, name = 'history.csv') {
  return new File([text], name, { type: 'text/csv' })
}

async function chooseFile(
  user: ReturnType<typeof userEvent.setup>,
  text = BANK_CSV,
  name?: string,
) {
  await user.upload(screen.getByLabelText(/Choose (a CSV|another) file/), csv(text, name))
  await screen.findByRole('heading', { name: '2. Match the columns' })
}

const previewRows = () =>
  within(screen.getByRole('table', { name: 'Rows as they will be saved' }))
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    )

const importButton = () => screen.getByRole('button', { name: /^Import \d/ })

describe('importing a bank export', () => {
  it('starts with only the file step and says the file stays in the browser', async () => {
    serve()
    renderSignedIn(<ImportTransactions />)
    expect(
      screen.getByRole('heading', { name: 'Import transactions', level: 1 }),
    ).toBeInTheDocument()
    expect(screen.getByText(/read here in your browser/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '2. Match the columns' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to transactions' })).toHaveAttribute(
      'href',
      '/spending/activity',
    )
  })

  it('guesses the columns and previews rows as they will be saved', async () => {
    serve()
    renderSignedIn(<ImportTransactions />)
    const user = userEvent.setup()
    await chooseFile(user)

    expect(screen.getByText('history.csv')).toBeInTheDocument()
    expect(screen.getByText(/4 rows/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Date' })).toHaveDisplayValue('Transaction Date')
    expect(screen.getByRole('combobox', { name: 'Description' })).toHaveDisplayValue('Description')
    expect(screen.getByRole('combobox', { name: 'Category (optional)' })).toHaveDisplayValue(
      'Category',
    )
    expect(screen.getByRole('combobox', { name: 'Account (optional)' })).toHaveDisplayValue('None')
    expect(screen.getByRole('combobox', { name: 'Spending shows as' })).toHaveDisplayValue(
      'Negative numbers (-4.50)',
    )
    expect(previewRows()).toEqual([
      ['Nov 2, 2026', 'STARBUCKS #12', 'Coffee', '$4.50'],
      ['Nov 3, 2026', 'PAYROLL ACME', 'By your rules', '+$2,500.00'],
      ['Nov 4, 2026', 'SAFEWAY', 'Groceries', '$95.10'],
    ])
    expect(screen.getByRole('status')).toHaveTextContent(
      /3 rows ready to import, 1 cannot be read and will be skipped/,
    )
    expect(
      within(screen.getByRole('list', { name: 'Rows that cannot be read' })).getByRole('listitem'),
    ).toHaveTextContent('Row 5 has "13/45/2026", which is not a date.')
  })

  it('imports into an existing account and reports what was skipped', async () => {
    const server = serve({
      import_transactions: () =>
        imported({ added: 2, alreadyThere: 1, unknownCategories: ['Coffee'] }),
    })
    renderSignedIn(<ImportTransactions />)
    const user = userEvent.setup()
    await chooseFile(user)

    expect(importButton()).toBeDisabled()
    expect(screen.getByText('Choose the account these rows belong to.')).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Leeway account' }), 'acct-1')
    await user.click(screen.getByRole('button', { name: 'Import 3 transactions' }))

    expect(await screen.findByText(/Added 2 transactions to Checking\./)).toHaveTextContent(
      'Skipped as duplicates: 1 already in Leeway.',
    )
    expect(screen.getByText(/so your rules filed those rows: Coffee\./)).toBeInTheDocument()
    expect(server.actions('import_transactions')).toEqual([
      {
        accountId: 'acct-1',
        fileName: 'history.csv',
        rows: [
          { date: '2026-11-02', name: 'STARBUCKS #12', amountCents: 450, category: 'Coffee' },
          { date: '2026-11-03', name: 'PAYROLL ACME', amountCents: -250000, category: null },
          { date: '2026-11-04', name: 'SAFEWAY', amountCents: 9510, category: 'Groceries' },
        ],
        keepRepeats: false,
        skipBankDays: true,
      },
    ])
    // The form starts over for the next file.
    expect(screen.queryByRole('heading', { name: '2. Match the columns' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See transactions' })).toHaveAttribute(
      'href',
      '/spending/activity',
    )
  })

  it('undoes the import it just made', async () => {
    const server = serve()
    renderSignedIn(<ImportTransactions />)
    const user = userEvent.setup()
    await chooseFile(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Leeway account' }), 'acct-1')
    await user.click(importButton())
    await user.click(await screen.findByRole('button', { name: 'Undo this import' }))
    expect(
      await screen.findByText('Undone. Removed 3 transactions from Checking.'),
    ).toBeInTheDocument()
    expect(server.actions('undo_import')).toEqual([{ id: 'imp-1' }])
  })

  it('shows why undoing failed', async () => {
    serve({}, { '/api/actions/undo_import': failing('That import was already undone', 404) })
    renderSignedIn(<ImportTransactions />)
    const user = userEvent.setup()
    await chooseFile(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Leeway account' }), 'acct-1')
    await user.click(importButton())
    await user.click(await screen.findByRole('button', { name: 'Undo this import' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That import was already undone')
  })

  it('reports every reason rows were skipped, and offers no undo when nothing was added', async () => {
    serve({
      import_transactions: () =>
        imported({
          importId: null,
          added: 0,
          alreadyThere: 1,
          repeatsInFile: 1,
          skippedByDate: 1,
          bankHistoryStarts: '2026-11-03',
          account: { ...checking, name: 'My checking' },
        }),
    })
    renderSignedIn(<ImportTransactions />)
    const user = userEvent.setup()
    await chooseFile(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Leeway account' }), 'acct-1')
    await user.click(importButton())
    expect(await screen.findByText(/Added 0 transactions to My checking\./)).toHaveTextContent(
      'Skipped as duplicates: 1 already in Leeway, 1 repeated in the file, 1 the bank already sent (from Nov 3, 2026).',
    )
    expect(screen.queryByRole('button', { name: 'Undo this import' })).not.toBeInTheDocument()
  })

  it('says one transaction, and leaves out a date it was not told', async () => {
    serve({ import_transactions: () => imported({ added: 1, skippedByDate: 2 }) })
    renderSignedIn(<ImportTransactions />)
    const user = userEvent.setup()
    await chooseFile(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Leeway account' }), 'acct-1')
    await user.click(importButton())
    expect(await screen.findByText(/Added 1 transaction to Checking\./)).toHaveTextContent(
      'Skipped as duplicates: 2 the bank already sent.',
    )
  })

  it('shows the button as busy while importing, and why an import failed', async () => {
    serve({}, { '/api/actions/import_transactions': failing('Import at most 20,000 rows at once') })
    const release = holdRequest('/api/actions/import_transactions')
    renderSignedIn(<ImportTransactions />)
    const user = userEvent.setup()
    await chooseFile(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Leeway account' }), 'acct-1')
    await user.click(importButton())
    expect(await screen.findByRole('button', { name: 'Importing' })).toBeDisabled()
    release()
    expect(await screen.findByRole('alert')).toHaveTextContent('Import at most 20,000 rows at once')
    // The checked rows stay on screen to try again.
    expect(screen.getByRole('heading', { name: '3. Check the preview' })).toBeInTheDocument()
  })
})

describe('choosing the account', () => {
  it('creates a new account named after the file', async () => {
    const server = serve()
    renderSignedIn(<ImportTransactions />)
    const user = userEvent.setup()
    await chooseFile(user, BANK_CSV, 'Mint export.csv')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Leeway account' }), 'new')
    const name = screen.getByLabelText('New account name')
    expect(name).toHaveValue('Mint export')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kind' }), 'credit')

    await user.clear(name)
    expect(screen.getByText('Name the new account.')).toBeInTheDocument()
    expect(importButton()).toBeDisabled()
    await user.type(name, '  Old card  ')
    await user.click(importButton())
    await waitFor(() =>
      expect(server.actions('import_transactions')[0]).toMatchObject({
        newAccount: { name: 'Old card', type: 'credit' },
      }),
    )
    expect(server.actions('import_transactions')[0]).not.toHaveProperty('accountId')
  })

  it('offers to skip days the bank already sent only for a connected account', async () => {
    const server = serve()
    renderSignedIn(<ImportTransactions />)
    const user = userEvent.setup()
    await chooseFile(user)
    const skip = () => screen.queryByRole('checkbox', { name: /bank history starts/ })
    expect(skip()).not.toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Leeway account' }), 'acct-2')
    expect(skip()).not.toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Leeway account' }), 'acct-1')
    expect(skip()).toBeChecked()
    await user.click(skip()!)
    await user.click(importButton())
    await waitFor(() =>
      expect(server.actions('import_transactions')[0]).toMatchObject({ skipBankDays: false }),
    )
  })

  it('offers to keep rows that repeat exactly, when there are some', async () => {
    const server = serve()
    renderSignedIn(<ImportTransactions />)
    const user = userEvent.setup()
    await chooseFile(
      user,
      'Date,Description,Amount\n2026-11-02,Coffee,4.50\n2026-11-02,Coffee,4.50\n2026-11-02,Coffee,4.50',
    )
    await user.click(
      screen.getByRole('checkbox', { name: /Keep 2 rows that repeat another exactly/ }),
    )
    await user.selectOptions(screen.getByRole('combobox', { name: 'Leeway account' }), 'acct-2')
    await user.click(importButton())
    await waitFor(() =>
      expect(server.actions('import_transactions')[0]).toMatchObject({ keepRepeats: true }),
    )
  })

  it('says one row when one repeats, and nothing when none do', async () => {
    serve()
    renderSignedIn(<ImportTransactions />)
    const user = userEvent.setup()
    await chooseFile(
      user,
      'Date,Description,Amount\n2026-11-02,Coffee,4.50\n2026-11-02,Coffee,4.50',
    )
    expect(
      screen.getByRole('checkbox', { name: /Keep 1 row that repeats another exactly/ }),
    ).toBeInTheDocument()
    await chooseFile(user, 'Date,Description,Amount\n2026-11-02,Coffee,4.50')
    expect(screen.queryByRole('checkbox', { name: /repeat/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import 1 transaction' })).toBeDisabled()
  })

  it('imports one account of an export that holds several', async () => {
    const server = serve()
    renderSignedIn(<ImportTransactions />)
    const user = userEvent.setup()
    await chooseFile(
      user,
      [
        'Date,Description,Amount,Transaction Type,Account Name',
        '1/02/2020,Coffee,4.50,debit,Card',
        '1/03/2020,Pay,2500,credit,Checking',
        '1/04/2020,Rent,1500,debit,Checking',
        '1/05/2020,Gas,40,debit,',
      ].join('\n'),
    )
    const rowsFrom = screen.getByRole('combobox', { name: 'Rows from' })
    // The account with the most rows comes first and is picked to start.
    expect(rowsFrom).toHaveDisplayValue('Checking (2)')
    expect(
      within(rowsFrom).getByRole('option', { name: 'No account named (1)' }),
    ).toBeInTheDocument()
    expect(previewRows().map((row) => row[1])).toEqual(['Pay', 'Rent'])
    await user.selectOptions(rowsFrom, 'Every account in the file')
    expect(previewRows()).toHaveLength(4)
    await user.selectOptions(rowsFrom, 'Card (1)')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Leeway account' }), 'acct-2')
    await user.click(screen.getByRole('button', { name: 'Import 1 transaction' }))
    await waitFor(() =>
      expect(server.actions('import_transactions')[0]).toMatchObject({
        rows: [{ date: '2020-01-02', name: 'Coffee', amountCents: 450, category: null }],
      }),
    )
  })

  it('refuses a file with more rows than one import takes', async () => {
    serve()
    renderSignedIn(<ImportTransactions />)
    const user = userEvent.setup()
    const lines = Array.from({ length: 20_001 }, (_, i) => `2026-01-02,Row ${i},1.00`)
    await chooseFile(user, ['Date,Description,Amount', ...lines].join('\n'))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Leeway account' }), 'acct-2')
    expect(
      screen.getByText(/This file has 20,001 rows; Leeway imports up to 20,000 at once/),
    ).toBeInTheDocument()
    expect(importButton()).toBeDisabled()
  })
})

describe('fixing the guess', () => {
  it('flips the signs when the owner says spending shows as positive', async () => {
    serve()
    renderSignedIn(<ImportTransactions />)
    const user = userEvent.setup()
    await chooseFile(user)
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Spending shows as' }),
      'positive',
    )
    expect(previewRows()[0]![3]).toBe('+$4.50')
  })

  it('reads separate money out and money in columns once chosen', async () => {
    serve()
    renderSignedIn(<ImportTransactions />)
    const user = userEvent.setup()
    await chooseFile(user, 'Date,Memo,Out,In\n2026-11-02,Coffee,4.50,\n2026-11-03,Pay,,2500')
    await user.click(screen.getByRole('button', { name: 'Money out and in' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Money out' }), 'Out')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Money in' }), 'In')
    expect(previewRows().map((row) => row[3])).toEqual(['$4.50', '+$2,500.00'])
    await user.click(screen.getByRole('checkbox', { name: 'Swap money out and money in' }))
    expect(previewRows().map((row) => row[3])).toEqual(['+$4.50', '$2,500.00'])
  })

  it('reads a type column once chosen, and goes back to one amount', async () => {
    serve()
    renderSignedIn(<ImportTransactions />)
    const user = userEvent.setup()
    await chooseFile(
      user,
      'Date,Name,Value,Kind\n2026-11-02,Coffee,4.50,Sale\n2026-11-03,Pay,2500,Deposit',
    )
    await user.click(screen.getByRole('button', { name: 'Amount and type' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Amount' }), 'Value')
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Type (debit or credit)' }),
      'Kind',
    )
    expect(previewRows().map((row) => row[3])).toEqual(['+$2,500.00'])
    expect(screen.getByText(/Row 2 has "Sale", which does not say/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Money out and in' }))
    await user.click(screen.getByRole('button', { name: 'One amount' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Amount' }), 'Value')
    expect(previewRows()).toHaveLength(2)
  })

  it('follows the description and category to the columns the owner picks', async () => {
    serve()
    renderSignedIn(<ImportTransactions />)
    const user = userEvent.setup()
    await chooseFile(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Description' }), 'Category')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category (optional)' }), 'None')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Account (optional)' }), 'None')
    expect(previewRows()[0]![1]).toBe('Coffee')
    expect(screen.getByRole('combobox', { name: 'Category (optional)' })).toHaveValue('')
  })

  it('asks for the columns it could not find', async () => {
    serve()
    renderSignedIn(<ImportTransactions />)
    const user = userEvent.setup()
    await chooseFile(user, 'When,What\nyesterday,coffee')
    expect(screen.getByText('Choose the column with the date.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import 0 transactions' })).toBeDisabled()
    expect(screen.getByText('There are no rows to import yet.')).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Date' }), 'When')
    expect(screen.getByText('Choose the column with the amount.')).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Amount' }), 'What')
    expect(screen.getByRole('status')).toHaveTextContent(/0 rows ready to import, 1 cannot be read/)
  })

  it('notes dates that read either way, and reads them as the owner says', async () => {
    serve()
    renderSignedIn(<ImportTransactions />, { settings: settingsWith({ locale: 'en-GB' }) })
    const user = userEvent.setup()
    await chooseFile(user, 'Date,Description,Amount\n01/02/2026,A,1.00\n03/04/2026,B,2.00')
    expect(screen.getByText(/These dates read either way/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Date order' })).toHaveDisplayValue(
      'Day first (03/11/2026)',
    )
    expect(previewRows()[0]![0]).toBe('1 Feb 2026')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Date order' }), 'mdy')
    expect(previewRows()[0]![0]).toBe('2 Jan 2026')
  })

  it('reads decimal commas once chosen', async () => {
    serve()
    renderSignedIn(<ImportTransactions />)
    const user = userEvent.setup()
    await chooseFile(user, 'Date;Description;Amount\n2026-11-02;Coffee;-4.50\n2026-11-03;Tea;-3.00')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Decimal mark' }), ',')
    expect(previewRows()[0]![3]).toBe('$450.00')
  })

  it('treats the first row as data when told it holds no column names', async () => {
    serve()
    renderSignedIn(<ImportTransactions />)
    const user = userEvent.setup()
    const lines = ['2026-11-02,Coffee,-4.50', '2026-11-03,Tea,-3.00', '2026-11-04,Cake,-6.00']
    await chooseFile(user, ['Date,Description,Amount', ...lines, '2026-11-05,Pie,-5.00'].join('\n'))
    const header = screen.getByRole('checkbox', { name: 'The first row holds column names' })
    expect(header).toBeChecked()
    await user.click(header)
    expect(header).not.toBeChecked()
    expect(screen.getByText(/5 rows/)).toBeInTheDocument()
    // The names row is now data that cannot be read; the columns are guessed from their values.
    expect(screen.getByRole('combobox', { name: 'Description' })).toHaveDisplayValue('Column 2')
    expect(screen.getByRole('status')).toHaveTextContent(/4 rows ready to import, 1 cannot be read/)
    await user.click(header)
    expect(screen.getByRole('combobox', { name: 'Description' })).toHaveDisplayValue('Description')
  })

  it('lists the first few rows it cannot read, then how many more', async () => {
    serve()
    renderSignedIn(<ImportTransactions />)
    const user = userEvent.setup()
    const good = Array.from({ length: 10 }, (_, i) => `2026-11-0${(i % 9) + 1},Good ${i},1.00`)
    const bad = Array.from({ length: 7 }, (_, i) => `soon,Bad ${i},1.00`)
    await chooseFile(user, ['Date,Description,Amount', ...good, ...bad].join('\n'))
    expect(previewRows()).toHaveLength(8)
    const problems = within(
      screen.getByRole('list', { name: 'Rows that cannot be read' }),
    ).getAllByRole('listitem')
    expect(problems).toHaveLength(6)
    expect(problems[5]).toHaveTextContent('And 2 more.')
  })

  it('reads a file with one row and says so', async () => {
    serve()
    renderSignedIn(<ImportTransactions />)
    const user = userEvent.setup()
    await chooseFile(user, 'Date,Description,Amount\n2026-11-02,Coffee,-4.50')
    expect(screen.getByText(/, 1 row$/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/1 row ready to import\./)
  })

  it('refuses a file too big to be a bank export', async () => {
    serve()
    renderSignedIn(<ImportTransactions />)
    const big = csv('Date,Description,Amount')
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 })
    await userEvent.setup().upload(screen.getByLabelText('Choose a CSV file'), big)
    expect(await screen.findByRole('alert')).toHaveTextContent('That file is over 25 MB')
    expect(screen.queryByRole('heading', { name: '2. Match the columns' })).not.toBeInTheDocument()
  })
})

describe('past imports', () => {
  const past = (fields: Partial<Output<'list_imports'>[number]>) => ({
    id: 'imp-1',
    accountId: 'acct-1',
    accountName: 'Checking',
    fileName: 'history.csv' as string | null,
    added: 12,
    createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    ...fields,
  })

  it('lists them and undoes one after asking again', async () => {
    const server = serve({
      list_imports: () => [past({}), past({ id: 'imp-2', fileName: null, added: 1 })],
    })
    renderSignedIn(<ImportTransactions />)
    const user = userEvent.setup()
    const list = await screen.findByRole('region', { name: 'Past imports' })
    expect(list).toHaveTextContent('history.csv')
    expect(list).toHaveTextContent('12 transactions into Checking, 2 h ago')
    expect(list).toHaveTextContent('Imported file')
    expect(list).toHaveTextContent('1 transaction into Checking')

    const first = within(list).getAllByRole('button', { name: 'Undo' })[0]!
    await user.click(first)
    await user.click(within(list).getByRole('button', { name: 'Keep' }))
    expect(server.actions('undo_import')).toEqual([])
    await user.click(within(list).getAllByRole('button', { name: 'Undo' })[0]!)
    await user.click(within(list).getByRole('button', { name: 'Delete its 12 transactions' }))
    await waitFor(() => expect(server.actions('undo_import')).toEqual([{ id: 'imp-1' }]))
    await waitFor(() =>
      expect(within(list).queryByRole('button', { name: /Delete its/ })).not.toBeInTheDocument(),
    )
  })

  it('shows why an undo failed', async () => {
    serve(
      { list_imports: () => [past({})] },
      { '/api/actions/undo_import': failing('Not found', 404) },
    )
    renderSignedIn(<ImportTransactions />)
    const user = userEvent.setup()
    const list = await screen.findByRole('region', { name: 'Past imports' })
    await user.click(within(list).getByRole('button', { name: 'Undo' }))
    await user.click(within(list).getByRole('button', { name: 'Delete its 12 transactions' }))
    expect(await within(list).findByRole('alert')).toHaveTextContent('Not found')
  })
})
