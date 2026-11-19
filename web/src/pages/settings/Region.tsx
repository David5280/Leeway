// Currency, number and date format, and time zone.

import { timeZones } from '../../components/PeriodEditor'
import { Setting } from '../../components/ui'
import { useApp } from '../../lib/app'
import { Section, useSave } from './Section'

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

export function RegionSection() {
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
