// Theme, light or dark, accent color, font, density and corners.

import type { Settings } from '../../api/client'
import { Segmented, Setting } from '../../components/ui'
import { useApp, usePrefersDark } from '../../lib/app'
import { ACCENTS, CORNERS, FONTS, THEMES, themeVariables, type ThemeId } from '../../lib/theme'
import { Section, useSave } from './Section'

export function LookSection() {
  const { settings } = useApp()
  const prefersDark = usePrefersDark()
  const save = useSave()
  const a = settings.appearance

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
      <AccentPicker />
      <Setting label="Font">
        <select
          className="input"
          style={{ width: 'auto' }}
          aria-label="Font"
          value={a.font}
          onChange={(e) =>
            save.appearance({ font: e.target.value as Settings['appearance']['font'] })
          }
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

/** Where the color picker starts: the native input only takes #rrggbb. */
export function hexOrFallback(color: string | undefined): string {
  return color?.startsWith('#') ? color : '#4f8cff'
}

/** The theme's own accent, a preset, or any color from the picker. */
function AccentPicker() {
  const { settings } = useApp()
  const prefersDark = usePrefersDark()
  const save = useSave()
  const a = settings.appearance
  // A custom accent is any color that is not a named preset.
  const customAccent = a.accent !== 'theme' && !(a.accent in ACCENTS)
  const { vars } = themeVariables(a, prefersDark)
  return (
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
            value={customAccent ? a.accent : hexOrFallback(vars['--accent'])}
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
  )
}
