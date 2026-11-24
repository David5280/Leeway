// The Data section: importing transactions, and exporting the setup to a file and importing one.

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { failing, fakeServer, renderSignedIn, settings } from '../../test/fake'
import { DataSection } from './Data'

afterEach(() => vi.unstubAllGlobals())

describe('Data', () => {
  const exported = {
    app: 'leeway',
    version: 1,
    exportedAt: '2026-11-17T00:00:00.000Z',
    settings,
    categories: [],
    rules: [],
  }
  let downloads: { name: string; blob: Blob }[]

  beforeEach(() => {
    downloads = []
    // jsdom has neither object URLs nor downloads; record what would be saved.
    let blob: Blob | null = null
    URL.createObjectURL = (b: Blob | MediaSource) => {
      blob = b as Blob
      return 'blob:leeway-export'
    }
    // Freeing the file is the download helper's to test (see lib/download.test.ts).
    URL.revokeObjectURL = () => {}
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push({ name: this.download, blob: blob! })
    })
  })

  afterEach(() => vi.restoreAllMocks())

  function file(text: string, name = 'leeway.json') {
    return new File([text], name, { type: 'application/json' })
  }

  it('leads to importing transactions from a file', () => {
    fakeServer({})
    renderSignedIn(<DataSection />)
    expect(screen.getByRole('region', { name: 'Data' })).toHaveTextContent('Import transactions')
    expect(screen.getByRole('link', { name: 'Import a CSV file' })).toHaveAttribute(
      'href',
      '/spending/activity/import',
    )
  })

  it('downloads everything as leeway.json', async () => {
    const server = fakeServer({ export_config: () => exported })
    renderSignedIn(<DataSection />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Export leeway.json' }))
    await waitFor(() => expect(downloads).toHaveLength(1))
    expect(downloads[0]!.name).toBe('leeway.json')
    expect(downloads[0]!.blob.type).toBe('application/json')
    expect(JSON.parse(await downloads[0]!.blob.text())).toEqual(exported)
    expect(server.actions('export_config')).toEqual([{}])
  })

  it('shows why an export failed and downloads nothing', async () => {
    fakeServer({}, { '/api/actions/export_config': failing('Export is broken', 500) })
    renderSignedIn(<DataSection />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Export leeway.json' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Export is broken')
    expect(downloads).toEqual([])
  })

  it('imports a file, keeping what is there by default', async () => {
    const server = fakeServer({
      import_config: () => ({ categoriesAdded: 2, rulesAdded: 5 }),
    })
    renderSignedIn(<DataSection />)
    await userEvent
      .setup()
      .upload(screen.getByLabelText('Choose a file'), file(JSON.stringify(exported)))
    expect(await screen.findByText('Added 2 categories and 5 rules.')).toBeInTheDocument()
    expect(server.actions('import_config')).toEqual([
      { config: JSON.parse(JSON.stringify(exported)), mode: 'merge' },
    ])
  })

  it('imports a file replacing categories and rules when asked', async () => {
    const server = fakeServer({
      import_config: () => ({ categoriesAdded: 7, rulesAdded: 0 }),
    })
    renderSignedIn(<DataSection />)
    const user = userEvent.setup()
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Import mode' }),
      'Import and replace my categories and rules',
    )
    await user.upload(screen.getByLabelText('Choose a file'), file('{"app":"leeway","version":1}'))
    expect(await screen.findByText('Added 7 categories and 0 rules.')).toBeInTheDocument()
    expect(server.actions('import_config')).toEqual([
      { config: { app: 'leeway', version: 1 }, mode: 'replace' },
    ])
  })

  it('refreshes what is on screen after an import', async () => {
    fakeServer({ import_config: () => ({ categoriesAdded: 1, rulesAdded: 1 }) })
    const { client } = renderSignedIn(<DataSection />)
    client.setQueryData(['action', 'list_categories', {}], [])
    await userEvent.setup().upload(screen.getByLabelText('Choose a file'), file('{}'))
    await screen.findByText('Added 1 categories and 1 rules.')
    expect(client.getQueryState(['action', 'list_categories', {}])?.isInvalidated).toBe(true)
  })

  it('says a file that is not JSON is not valid, without sending it', async () => {
    const server = fakeServer({ import_config: () => ({ categoriesAdded: 0, rulesAdded: 0 }) })
    renderSignedIn(<DataSection />)
    await userEvent.setup().upload(screen.getByLabelText('Choose a file'), file('name,amount\n'))
    expect(await screen.findByRole('alert')).toHaveTextContent('That file is not valid JSON.')
    expect(server.actions('import_config')).toEqual([])
  })

  it('shows why the server turned a file down, clearing an earlier success', async () => {
    let fail = false
    fakeServer(
      { import_config: () => ({ categoriesAdded: 1, rulesAdded: 0 }) },
      {
        '/api/actions/import_config': () =>
          fail
            ? failing('Rules point at categories that are not in the file')()
            : Response.json({ result: { categoriesAdded: 1, rulesAdded: 0 } }),
      },
    )
    renderSignedIn(<DataSection />)
    const user = userEvent.setup()
    const input = screen.getByLabelText('Choose a file')
    await user.upload(input, file('{}'))
    await screen.findByText('Added 1 categories and 0 rules.')
    fail = true
    await user.upload(input, file('{}'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Rules point at categories that are not in the file',
    )
    expect(screen.queryByText(/^Added/)).not.toBeInTheDocument()
  })

  it('lets the same file be chosen again', async () => {
    const server = fakeServer({ import_config: () => ({ categoriesAdded: 0, rulesAdded: 0 }) })
    renderSignedIn(<DataSection />)
    const user = userEvent.setup()
    const input = screen.getByLabelText<HTMLInputElement>('Choose a file')
    const same = file('{}')
    await user.upload(input, same)
    expect(input.value).toBe('')
    await user.upload(input, same)
    await waitFor(() => expect(server.actions('import_config')).toHaveLength(2))
  })
})
