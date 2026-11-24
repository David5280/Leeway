// How far apart two colors look, to normal eyes and to each of the three
// kinds of color blindness, for checking that the tab colors stay apart for
// everyone (lib/places.test.ts). Pure; colors are "#RRGGBB".
//
// The simulation is Machado, Oliveira and Fernandes (2009) at full severity:
// a 3x3 matrix applied to linear RGB. The distance is CIE76: the straight line
// between two colors in CIE Lab, where about 2 is a just-noticeable step and
// 20 or more reads as plainly different at a glance.

import { parseHex } from './contrast'

type Vector = [number, number, number]
type Matrix = [Vector, Vector, Vector]

/** Normal vision, and the three kinds of color blindness, each at full strength. */
export const VISIONS = ['normal', 'protan', 'deutan', 'tritan'] as const
export type Vision = (typeof VISIONS)[number]

/** Machado 2009 matrices at severity 1.0, over linear RGB. */
const MACHADO: Record<Exclude<Vision, 'normal'>, Matrix> = {
  // Missing red cones: reds darken and merge with greens.
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  // Missing green cones: the most common kind, reds and greens merge.
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  // Missing blue cones: rare; blues merge with greens, yellows with pinks.
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.1476],
    [0.004733, 0.691367, 0.3039],
  ],
}

/** sRGB from 0 to 1, decoded to linear light. */
function toLinear(rgb: Vector): Vector {
  return rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as Vector
}

/** A color as one kind of vision sees it, in linear RGB, clamped to what a screen can show. */
export function simulate(hex: string, vision: Vision): Vector {
  const linear = toLinear(parseHex(hex))
  if (vision === 'normal') return linear
  return MACHADO[vision].map((row) => {
    const channel = row[0] * linear[0] + row[1] * linear[1] + row[2] * linear[2]
    return Math.min(1, Math.max(0, channel))
  }) as Vector
}

/** Linear RGB as CIE Lab (D65 white): lightness from 0 to 100, then two color axes. */
export function toLab([r, g, b]: Vector): Vector {
  // Linear sRGB to XYZ, each scaled by the D65 white so white lands on 1.
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
  // Lab's cube root, with its straight segment near black.
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const [fx, fy, fz] = [f(x), f(y), f(z)]
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** How different two colors look to one kind of vision: their CIE76 distance in Lab. */
export function colorDistance(a: string, b: string, vision: Vision = 'normal'): number {
  const [la, aa, ba] = toLab(simulate(a, vision))
  const [lb, ab, bb] = toLab(simulate(b, vision))
  return Math.hypot(la - lb, aa - ab, ba - bb)
}

/**
 * The closest any two of `colors` come, to any of the four kinds of vision:
 * the pair most likely to be mistaken for each other, and how far apart it is.
 * Needs two colors or more.
 */
export function closestPair(colors: Record<string, string>): {
  pair: [string, string]
  vision: Vision
  distance: number
} {
  const names = Object.keys(colors)
  const pairs = names.flatMap((a, i) => names.slice(i + 1).map((b): [string, string] => [a, b]))
  // Every pair, as each kind of vision sees it; the closest of them wins.
  const seen = VISIONS.flatMap((vision) =>
    pairs.map(([a, b]) => ({
      pair: [a, b] as [string, string],
      vision,
      distance: colorDistance(colors[a]!, colors[b]!, vision),
    })),
  )
  return seen.reduce((closest, next) => (next.distance < closest.distance ? next : closest))
}
