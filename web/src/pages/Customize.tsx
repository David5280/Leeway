import type { ReactNode } from 'react'
import type { Settings } from '../api/client'
import { useUpdateSettings } from '../api/settings'
import { PeriodEditor, timeZones } from '../components/PeriodEditor'
import { Shell } from '../components/Shell'
import { ErrorNote, Icon, Segmented, Setting, Switch } from '../components/ui'
import { useApp, usePrefersDark } from '../lib/app'
import { ACCENTS, CORNERS, FONTS, THEMES, themeVariables, type ThemeId } from '../lib/theme'
import { moveWidget, WIDGET_LIBRARY } from './Overview'
import {
  AccountSection,
  AgentSection,
  BackupSection,
  BanksSection,
  SignInSection,
} from './CustomizeData'

type Appearance = Settings['appearance']
type Widget = Settings['dashboard']['widgets'][number]

const SECTIONS = [
  ['look', 'Look'],
  ['layout', 'Dashboard'],
  ['budgeting', 'Budgeting'],
  ['region', 'Region'],
  ['accounts', 'Accounts'],
  ['banks', 'Banks'],
  ['agent', 'AI assistant'],
  ['backup', 'Backup'],
  ['account', 'Sign-in'],
] as const

export function Section({
  id,
  title,
  hint,
  children,
}: {
  id: string
  title: string
  hint?: string
  children: ReactNode
}) {
  return (
    <section
      id={id}
      className="card stack"
      aria-labelledby={`${id}-title`}
      style={{ scrollMarginTop: 24 }}
    >
      <div>
        <h2 id={`${id}-title`}>{title}</h2>
        {hint && <span className="small muted">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

export function Customize() {
  const update = useUpdateSettings()
  return (
    <Shell>
      <div>
        <h1>Make it yours</h1>
        <span className="muted">Every change saves right away and shows live.</span>
      </div>
      <nav aria-label="Customize sections" className="row wrap">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="chip">
            {label}
          </a>
        ))}
      </nav>
      <ErrorNote error={update.error} />
      <LookSection />
      <LayoutSection />
      <BudgetingSection />
      <RegionSection />
      <AccountSection />
      <BanksSection />
      <AgentSection />
      <BackupSection />
      <SignInSection />
    </Shell>
  )
}

function useSave() {
  const update = useUpdateSettings()
  return {
    appearance: (change: Partial<Appearance>) => update.mutate({ appearance: change }),
    settings: (change: Parameters<typeof update.mutate>[0]) => update.mutate(change),
  }
}

function LookSection() {
  const { settings } = useApp()
  const prefersDark = usePrefersDark()
  const save = useSave()
  const a = settings.appearance
  const customAccent = a.accent !== 'theme' && !(a.accent in ACCENTS)
  const { vars } = themeVariables(a, prefersDark)

  return (
    <Section id="look" title="Look">
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        {(Object.keys(THEMES) as ThemeId[]).map((id) => {
          const preview = themeVariables({ ...a, theme: id }, prefersDark).vars
          return (
            <button
              key={id}
              type="button"
              className="choice"
              aria-pressed={a.theme === id}
              onClick={() => save.appearance({ theme: id })}
              style={{ background: preview['--bg'], color: preview['--ink'] }}
            >
              <span className="row" style={{ gap: 6, color: 'inherit' }}>
                <span
                  className="dot"
                  style={{ background: preview['--accent'] }}
                  aria-hidden="true"
                />
                <strong>{THEMES[id].name}</strong>
              </span>
              <span style={{ color: preview['--muted'] }}>{THEMES[id].description}</span>
            </button>
          )
        })}
      </div>
      <Setting label="Light or dark" hint="Each theme has both">
        <Segmented
          label="Light or dark"
          value={a.mode}
          onChange={(mode) => save.appearance({ mode })}
          options={[
            { value: 'theme', label: 'Theme default' },
            { value: 'system', label: 'Match my device' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </Setting>
      <Setting label="Accent color" hint="Buttons, your leeway number, focus rings">
        <div className="row wrap" role="radiogroup" aria-label="Accent color">
          <button
            type="button"
            role="radio"
            className="chip"
            aria-checked={a.accent === 'theme'}
            onClick={() => save.appearance({ accent: 'theme' })}
          >
            Theme
          </button>
          {Object.entries(ACCENTS).map(([id, accent]) => (
            <button
              key={id}
              type="button"
              role="radio"
              className="swatch"
              aria-label={accent.name}
              aria-checked={a.accent === id}
              style={{
                background: themeVariables({ ...a, accent: id }, prefersDark).vars['--accent'],
              }}
              onClick={() => save.appearance({ accent: id })}
            />
          ))}
          <label
            className="swatch"
            aria-label="Custom color"
            style={{
              background: customAccent
                ? a.accent
                : 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)',
              position: 'relative',
            }}
          >
            <input
              type="color"
              aria-label="Pick a custom accent color"
              value={
                customAccent
                  ? a.accent
                  : vars['--accent']?.startsWith('#')
                    ? vars['--accent']
                    : '#4f8cff'
              }
              onChange={(e) => save.appearance({ accent: e.target.value })}
              style={{
                opacity: 0,
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                cursor: 'pointer',
              }}
            />
          </label>
        </div>
      </Setting>
      <Setting label="Font">
        <select
          className="input"
          style={{ width: 'auto' }}
          aria-label="Font"
          value={a.font}
          onChange={(e) => save.appearance({ font: e.target.value as Appearance['font'] })}
        >
          <option value="theme">Theme default</option>
          {Object.entries(FONTS).map(([id, font]) => (
            <option key={id} value={id}>
              {font.name}
            </option>
          ))}
        </select>
      </Setting>
      <Setting label="Density" hint="How much fits on one screen">
        <Segmented
          label="Density"
          value={a.density}
          onChange={(density) => save.appearance({ density })}
          options={[
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'compact', label: 'Compact' },
          ]}
        />
      </Setting>
      <Setting label="Corners">
        <Segmented
          label="Corners"
          value={a.corners}
          onChange={(corners) => save.appearance({ corners })}
          options={[
            { value: 'theme', label: 'Theme' },
            ...(Object.keys(CORNERS) as (keyof typeof CORNERS)[]).map((id) => ({
              value: id,
              label: id.charAt(0).toUpperCase() + id.slice(1),
            })),
          ]}
        />
      </Setting>
    </Section>
  )
}

const SIZES = [
  { value: 'half', label: 'Half' },
  { value: 'wide', label: 'Wide' },
  { value: 'full', label: 'Full' },
] as const

function LayoutSection() {
  const { settings } = useApp()
  const save = useSave()
  const widgets = settings.dashboard.widgets.filter((w) => WIDGET_LIBRARY[w.type])
  const missing = (Object.keys(WIDGET_LIBRARY) as Widget['type'][]).filter(
    (type) => !settings.dashboard.widgets.some((w) => w.type === type),
  )
  const saveWidgets = (next: Widget[]) => save.settings({ dashboard: { widgets: next } })
  const change = (index: number, patch: Partial<Widget>) =>
    saveWidgets(widgets.map((w, i) => (i === index ? { ...w, ...patch } : w)))

  return (
    <Section id="layout" title="Dashboard" hint="Or press Edit layout on the overview">
      {widgets.map((widget, i) => (
        <div key={widget.type} className="list-row wrap">
          <Switch
            label={`Show ${WIDGET_LIBRARY[widget.type]!.name}`}
            checked={widget.visible}
            onChange={(visible) => change(i, { visible })}
          />
          <span className={widget.visible ? 'grow' : 'grow muted'}>
            {WIDGET_LIBRARY[widget.type]!.name}
          </span>
          <Segmented
            label={`${WIDGET_LIBRARY[widget.type]!.name} size`}
            value={widget.size}
            options={SIZES}
            onChange={(size) => change(i, { size })}
          />
          <button
            type="button"
            className="iconbtn"
            aria-label={`Move ${WIDGET_LIBRARY[widget.type]!.name} up`}
            disabled={i === 0}
            onClick={() => saveWidgets(moveWidget(widgets, i, -1))}
          >
            <Icon name="up" size={16} />
          </button>
          <button
            type="button"
            className="iconbtn"
            aria-label={`Move ${WIDGET_LIBRARY[widget.type]!.name} down`}
            disabled={i === widgets.length - 1}
            onClick={() => saveWidgets(moveWidget(widgets, i, 1))}
          >
            <Icon name="down" size={16} />
          </button>
        </div>
      ))}
      {missing.length > 0 && (
        <div className="row wrap">
          <span className="small muted">Add:</span>
          {missing.map((type) => (
            <button
              key={type}
              type="button"
              className="chip"
              onClick={() => saveWidgets([...widgets, { type, size: 'wide', visible: true }])}
            >
              + {WIDGET_LIBRARY[type]!.name}
            </button>
          ))}
        </div>
      )}
    </Section>
  )
}

const PACE = [
  { value: '20', label: 'Relaxed' },
  { value: '10', label: 'Normal' },
  { value: '5', label: 'Strict' },
] as const

function BudgetingSection() {
  const { settings } = useApp()
  const save = useSave()
  const pace = String(settings.paceTolerancePercent)
  return (
    <Section id="budgeting" title="Budgeting">
      <PeriodEditor value={settings.period} onChange={(period) => save.settings({ period })} />
      <Setting label="Count pending transactions" hint="Money is spent even before it posts">
        <Switch
          label="Count pending transactions"
          checked={settings.includePending}
          onChange={(includePending) => save.settings({ includePending })}
        />
      </Setting>
      <Setting label="Warn at" hint="Each category can override this">
        <select
          className="input"
          style={{ width: 'auto' }}
          aria-label="Warn at"
          value={settings.defaultWarnAtPercent}
          onChange={(e) => save.settings({ defaultWarnAtPercent: Number(e.target.value) })}
        >
          {[50, 60, 70, 75, 80, 85, 90, 95, 100].map((p) => (
            <option key={p} value={p}>
              {p}% of a budget
            </option>
          ))}
          {![50, 60, 70, 75, 80, 85, 90, 95, 100].includes(settings.defaultWarnAtPercent) && (
            <option value={settings.defaultWarnAtPercent}>
              {settings.defaultWarnAtPercent}% of a budget
            </option>
          )}
        </select>
      </Setting>
      <Setting
        label="Pace sensitivity"
        hint={`How far ahead of steady spending counts as ahead: ${pace}% of the budget`}
      >
        <Segmented
          label="Pace sensitivity"
          value={
            (PACE.some((p) => p.value === pace) ? pace : '10') as (typeof PACE)[number]['value']
          }
          options={PACE}
          onChange={(value) => save.settings({ paceTolerancePercent: Number(value) })}
        />
      </Setting>
    </Section>
  )
}

const CURRENCIES = [
  'USD',
  'CAD',
  'EUR',
  'GBP',
  'AUD',
  'NZD',
  'JPY',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'MXN',
  'INR',
  'BRL',
  'ZAR',
]
const LOCALES = [
  'en-US',
  'en-GB',
  'en-CA',
  'en-AU',
  'en-IN',
  'de-DE',
  'fr-FR',
  'es-ES',
  'it-IT',
  'nl-NL',
  'pt-BR',
  'sv-SE',
  'ja-JP',
]

function currencyName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'currency' }).of(code) ?? code
  } catch {
    return code
  }
}

function RegionSection() {
  const { settings } = useApp()
  const save = useSave()
  const zones = timeZones()
  const currencies = CURRENCIES.includes(settings.currency)
    ? CURRENCIES
    : [settings.currency, ...CURRENCIES]
  const locales = LOCALES.includes(settings.locale) ? LOCALES : [settings.locale, ...LOCALES]
  const sample = (locale: string) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: settings.currency }).format(
      1234.56,
    )
  return (
    <Section id="region" title="Region">
      <Setting label="Currency">
        <select
          className="input"
          style={{ width: 'auto' }}
          aria-label="Currency"
          value={settings.currency}
          onChange={(e) => save.settings({ currency: e.target.value })}
        >
          {currencies.map((code) => (
            <option key={code} value={code}>
              {currencyName(code, settings.locale)} ({code})
            </option>
          ))}
        </select>
      </Setting>
      <Setting label="Number format">
        <select
          className="input"
          style={{ width: 'auto' }}
          aria-label="Number format"
          value={settings.locale}
          onChange={(e) => save.settings({ locale: e.target.value })}
        >
          {locales.map((locale) => (
            <option key={locale} value={locale}>
              {sample(locale)} ({locale})
            </option>
          ))}
        </select>
      </Setting>
      <Setting label="Time zone" hint="Decides when a day, and a period, begins">
        <select
          className="input"
          style={{ width: 'auto' }}
          aria-label="Time zone"
          value={settings.timeZone}
          onChange={(e) => save.settings({ timeZone: e.target.value })}
        >
          {(zones.all.includes(settings.timeZone)
            ? zones.all
            : [settings.timeZone, ...zones.all]
          ).map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </Setting>
    </Section>
  )
}
