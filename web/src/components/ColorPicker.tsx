// A row of color swatches to pick from, used for categories and goals.

import { CATEGORY_COLORS } from '../lib/theme'

export function ColorPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (hex: string) => void
}) {
  return (
    <div className="row wrap swatches" role="radiogroup" aria-label="Color">
      {CATEGORY_COLORS.map(([name, hex]) => (
        <button
          key={hex}
          type="button"
          role="radio"
          className="swatch"
          aria-label={name}
          aria-checked={value.toLowerCase() === hex.toLowerCase()}
          style={{ background: hex }}
          onClick={() => onChange(hex)}
        />
      ))}
    </div>
  )
}
