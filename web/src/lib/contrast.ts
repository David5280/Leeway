// Color contrast as WCAG measures it, for checking that every theme reads
// well (lib/contrast.test.ts). Pure; colors are "#RRGGBB".

type Rgb = [number, number, number]

/** A "#RRGGBB" color as red, green and blue from 0 to 1. */
export function parseHex(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb
}

/** A color in sRGB, as CSS color-mix(in srgb, a weight%, b) mixes it. */
export function mixRgb(a: Rgb, b: Rgb, weight: number): Rgb {
  return a.map((channel, i) => channel * weight + b[i]! * (1 - weight)) as Rgb
}

/** How bright a color looks, from 0 (black) to 1 (white). */
export function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as Rgb
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The contrast ratio between two colors, from 1 to 21. AA needs 4.5 for text, 3 for icons. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (light + 0.05) / (dark + 0.05)
}
