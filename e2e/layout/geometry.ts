// Boxes and shapes on the screen, in CSS pixels from the viewport's top left.

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export interface Point {
  x: number
  y: number
}

/** Below this many pixels of overlap, two boxes only touch. */
export const TOUCHING = 1

export const EVERYWHERE: Box = {
  left: -Infinity,
  top: -Infinity,
  right: Infinity,
  bottom: Infinity,
}
export const NOWHERE: Box = { left: 0, top: 0, right: 0, bottom: 0 }

export const toBox = (r: DOMRect | Box): Box => ({
  left: r.left,
  top: r.top,
  right: r.right,
  bottom: r.bottom,
})

export const width = (b: Box) => b.right - b.left
export const height = (b: Box) => b.bottom - b.top

export const intersect = (a: Box, b: Box): Box => ({
  left: Math.max(a.left, b.left),
  top: Math.max(a.top, b.top),
  right: Math.min(a.right, b.right),
  bottom: Math.min(a.bottom, b.bottom),
})

/** Whether two boxes share more than an edge. */
export const overlaps = (a: Box, b: Box) => {
  const shared = intersect(a, b)
  return width(shared) > TOUCHING && height(shared) > TOUCHING
}

/** The smallest box around all of them. */
export const union = (boxes: Box[]): Box =>
  boxes.reduce((all, b) => ({
    left: Math.min(all.left, b.left),
    top: Math.min(all.top, b.top),
    right: Math.max(all.right, b.right),
    bottom: Math.max(all.bottom, b.bottom),
  }))

/** The visible part of the page. */
export const viewport = (): Box => ({
  left: 0,
  top: 0,
  right: document.documentElement.clientWidth,
  bottom: window.innerHeight,
})

/** Whether the page is scrolled to its very end, where its last content comes to rest. */
export const isScrolledToEnd = () =>
  window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - TOUCHING

/** Whether the page is at its top, where its first content comes to rest. */
export const isScrolledToTop = () => window.scrollY <= TOUCHING

/** A box's corners, in order around it. */
export const cornersOf = (b: Box): Point[] => [
  { x: b.left, y: b.top },
  { x: b.right, y: b.top },
  { x: b.right, y: b.bottom },
  { x: b.left, y: b.bottom },
]

/** The upright box around a shape's corners. */
export const boxAround = (corners: Point[]): Box => ({
  left: Math.min(...corners.map((p) => p.x)),
  top: Math.min(...corners.map((p) => p.y)),
  right: Math.max(...corners.map((p) => p.x)),
  bottom: Math.max(...corners.map((p) => p.y)),
})

/** How far two shapes' shadows on an axis (a unit vector) overlap, in pixels. */
function sharedShadow(a: Point[], b: Point[], axis: Point): number {
  const shadow = (corners: Point[]) => corners.map((p) => p.x * axis.x + p.y * axis.y)
  const [first, second] = [shadow(a), shadow(b)]
  return (
    Math.min(Math.max(...first), Math.max(...second)) -
    Math.max(Math.min(...first), Math.min(...second))
  )
}

/** The unit perpendicular of each edge of a shape, skipping edges of no length. */
function edgeNormals(shape: Point[]): Point[] {
  return shape.flatMap((from, index) => {
    const to = shape[(index + 1) % shape.length]!
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    return length === 0 ? [] : [{ x: (from.y - to.y) / length, y: (to.x - from.x) / length }]
  })
}

/**
 * Whether two convex shapes (corners in order around each) overlap by more
 * than touching. By the separating axis theorem they are apart exactly when
 * their shadows on some edge's perpendicular do not meet, so each edge of
 * both is tried.
 */
export function shapesOverlap(a: Point[], b: Point[]): boolean {
  return [...edgeNormals(a), ...edgeNormals(b)].every((axis) => sharedShadow(a, b, axis) > TOUCHING)
}
