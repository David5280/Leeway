// Pieces every chart shares: the frame with its accessible name, the value
// axis, line-end labels, and a hover or tap readout.

import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { nearestIndex } from '../../lib/chartScale'

/** Axis and label text: the interface font, sized to read at a glance. */
export const AXIS_FONT = 12
const LABEL_FONT = 13

/**
 * The SVG and its wrapper. The chart is named for what it shows and described
 * in one sentence, so a screen reader gets the numbers the picture carries.
 * The readout, when there is one, floats over the chart from the wrapper.
 */
export function ChartFrame({
  measure,
  width,
  height,
  name,
  description,
  readout,
  children,
}: {
  measure: (node: HTMLDivElement | null) => void
  width: number
  height: number
  name: string
  description: string
  readout?: ReactNode
  children: ReactNode
}) {
  const descriptionId = useId()
  return (
    <div ref={measure} className="chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={name}
        aria-describedby={descriptionId}
        className="chart-svg"
      >
        {children}
      </svg>
      <p id={descriptionId} className="visually-hidden">
        {description}
      </p>
      {readout}
    </div>
  )
}

/** Horizontal gridlines with their values in a gutter on the left. */
export function ValueAxis({
  ticks,
  y,
  left,
  right,
  format,
}: {
  ticks: number[]
  y: (value: number) => number
  left: number
  right: number
  format: (value: number) => string
}) {
  return (
    <g aria-hidden="true">
      {ticks.map((value) => (
        <g key={value}>
          <line
            x1={left}
            x2={right}
            y1={y(value)}
            y2={y(value)}
            // The zero line anchors the chart, so it is drawn firmer than the rest.
            className={value === 0 ? 'chart-baseline' : 'chart-grid'}
          />
          <text x={left - 8} y={y(value) + 4} textAnchor="end" className="chart-axis">
            {format(value)}
          </text>
        </g>
      ))}
    </g>
  )
}

/**
 * A label at the end of a line, in place of a legend: a name over a value.
 * `y` is the label's centre; callers spread labels first so none overlap.
 */
export function EndLabel({
  x,
  y,
  name,
  value,
  tone = 'muted',
}: {
  x: number
  y: number
  name: string
  /** Drawn inside an SVG <text>: an amount as <Money as="tspan" />. */
  value: ReactNode
  tone?: 'muted' | 'ink'
}) {
  return (
    <g aria-hidden="true">
      <text x={x} y={y - 2} className="chart-axis">
        {name}
      </text>
      <text x={x} y={y + LABEL_FONT} className={`chart-value ${tone}`}>
        {value}
      </text>
    </g>
  )
}

/** The height two-line end labels need apart, so `spreadLabels` keeps them clear. */
export const END_LABEL_GAP = AXIS_FONT + LABEL_FONT + 6

/**
 * Tracks which data point the pointer (mouse, pen or finger) is nearest, from
 * the x position of each point. Returns the active index (-1 for none) and the
 * handlers (with the ref) for a transparent rectangle laid over the plot.
 *
 * A mouse moving off the plot clears the readout; a finger lifting does not,
 * since a phone fires leave the moment a tap ends and the readout would vanish
 * before it is read. A finger's readout clears instead when the touch turns
 * into a scroll (the browser cancels the pointer) or the next touch lands
 * anywhere off the plot.
 */
export function usePointer(positions: number[], width: number) {
  const [active, setActive] = useState(-1)
  const layer = useRef<SVGRectElement>(null)
  const showing = active >= 0

  // Listen for a press elsewhere only while a readout is up.
  useEffect(() => {
    if (!showing) return
    const clearOutside = (event: globalThis.PointerEvent) => {
      if (!layer.current?.contains(event.target as Node)) setActive(-1)
    }
    document.addEventListener('pointerdown', clearOutside)
    return () => document.removeEventListener('pointerdown', clearOutside)
  }, [showing])

  const track = (event: PointerEvent<SVGRectElement>) => {
    const svg = event.currentTarget.ownerSVGElement
    const box = svg?.getBoundingClientRect()
    // The SVG draws at its measured width, but scale anyway in case CSS stretched it.
    const scale = box && box.width > 0 ? width / box.width : 1
    const x = (event.clientX - (box?.left ?? 0)) * scale
    setActive(nearestIndex(x, positions))
  }
  return {
    active: active < positions.length ? active : -1,
    handlers: {
      ref: layer,
      onPointerMove: track,
      onPointerDown: track,
      onPointerCancel: () => setActive(-1),
      onPointerLeave: (event: PointerEvent<SVGRectElement>) => {
        if (event.pointerType !== 'touch') setActive(-1)
      },
    },
  }
}

/** The transparent layer over the plot that the pointer handlers listen on. */
export function PointerLayer({
  left,
  top,
  width,
  height,
  handlers,
}: {
  left: number
  top: number
  width: number
  height: number
  handlers: ReturnType<typeof usePointer>['handlers']
}) {
  return (
    <rect
      x={left}
      y={top}
      width={Math.max(0, width)}
      height={Math.max(0, height)}
      fill="transparent"
      className="chart-hit"
      data-testid="chart-hit"
      {...handlers}
    />
  )
}

/** The readout for the point under the pointer: a heading and a few lines. */
export function Readout({
  x,
  chartWidth,
  title,
  lines,
}: {
  x: number
  chartWidth: number
  title: string
  /** Each line in order; an amount as <Money />. */
  lines: ReactNode[]
}) {
  // Kept inside the chart: centred on the point unless that would spill over an edge.
  const half = 80
  const left = Math.min(Math.max(x, half), Math.max(half, chartWidth - half))
  return (
    <div className="chart-readout" style={{ left }} aria-hidden="true">
      <strong>{title}</strong>
      {lines.map((line, index) => (
        // The lines never reorder, so their places are their keys.
        <span key={index}>{line}</span>
      ))}
    </div>
  )
}

/** A vertical guide at the point under the pointer. */
export function Guide({ x, top, bottom }: { x: number; top: number; bottom: number }) {
  return <line x1={x} x2={x} y1={top} y2={bottom} className="chart-guide" aria-hidden="true" />
}
