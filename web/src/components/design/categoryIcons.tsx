// The glyph for each category icon name, drawn on a 24px grid with a 2px
// stroke like the app's other icons (components/ui.tsx). The names are the
// ones categories store (server/src/domain/starters.ts); CategoryIcon draws
// a glyph from here, or the category's first letter for a name not listed.

import type { ReactNode } from 'react'

export const CATEGORY_GLYPHS: Record<string, ReactNode> = {
  bag: (
    <>
      <path d="M5 8h14l-1 12H6z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </>
  ),
  bolt: <path d="M13 3L5 13h6l-1 8 8-10h-6z" />,
  book: (
    <>
      <path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
      <path d="M5 17a3 3 0 0 1 3-3h10" />
    </>
  ),
  burger: (
    <>
      <path d="M4 11a8 6 0 0 1 16 0z" />
      <path d="M3 14h18M5 17h14a2 2 0 0 1-2 3H7a2 2 0 0 1-2-3z" />
    </>
  ),
  car: (
    <>
      <path d="M5 16V11l2-5h10l2 5v5z" />
      <path d="M5 11h14M7 19v-3M17 19v-3" />
      <circle cx="8.5" cy="13.5" r=".5" />
      <circle cx="15.5" cy="13.5" r=".5" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M7 15h3" />
    </>
  ),
  cart: (
    <>
      <path d="M3 4h2l2 11h11l2-8H6.2" />
      <circle cx="9" cy="19" r="1.4" />
      <circle cx="17" cy="19" r="1.4" />
    </>
  ),
  cash: (
    <>
      <rect x="3" y="7" width="18" height="11" rx="2" />
      <circle cx="12" cy="12.5" r="2.5" />
      <path d="M6 10v5M18 10v5" />
    </>
  ),
  coffee: (
    <>
      <path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z" />
      <path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3v3M11 3v3" />
    </>
  ),
  dumbbell: <path d="M3 10v4M6 7v10M18 7v10M21 10v4M6 12h12" />,
  fuel: (
    <>
      <path d="M5 20V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v15M4 20h11M5 10h9" />
      <path d="M14 8l3 2v7a1.5 1.5 0 0 0 3 0V9l-2-3" />
    </>
  ),
  gift: (
    <>
      <rect x="4" y="9" width="16" height="11" rx="1" />
      <path d="M3 9h18M12 9v11M12 9c-2-4-6-4-6-1s6 1 6 1c2-4 6-4 6-1s-6 1-6 1" />
    </>
  ),
  glass: <path d="M7 3h10l-1 7a4 4 0 0 1-8 0zM12 14v6M8 20h8" />,
  hammer: (
    <>
      <path d="M14 6l4 4M10 4h5l4 4-3 3-3-3-9 9-2-2 9-9-1-2z" />
    </>
  ),
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  inbox: (
    <>
      <path d="M4 13l2-8h12l2 8v6H4z" />
      <path d="M4 13h5l1 2h4l1-2h5" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l8-8M16 7l2 2M14 9l2 2" />
    </>
  ),
  landmark: <path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" />,
  paw: (
    <>
      <circle cx="7" cy="10" r="1.6" />
      <circle cx="10.5" cy="6.5" r="1.6" />
      <circle cx="14.5" cy="6.5" r="1.6" />
      <circle cx="18" cy="10" r="1.6" />
      <path d="M8 17c0-3 2-5 4-5s4 2 4 5a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2z" />
    </>
  ),
  plane: <path d="M10 14l-6-2 1-2 7 1 4-6h2l-1 7 4 2v2l-6-1-3 5h-2l1-5z" />,
  receipt: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6" />
    </>
  ),
  repeat: <path d="M4 11V9a3 3 0 0 1 3-3h12l-3-3M20 13v2a3 3 0 0 1-3 3H5l3 3" />,
  send: <path d="M21 3L3 10l7 3 3 7zM10 13l5-5" />,
  shield: <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />,
  shirt: <path d="M8 4l-5 3 2 4 3-1v10h8V10l3 1 2-4-5-3a4 4 0 0 1-8 0z" />,
  sparkle: <path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />,
  swap: <path d="M4 8h14l-3-3M20 16H6l3 3" />,
  ticket: (
    <>
      <path d="M3 8a2 2 0 0 0 0 4v4h18v-4a2 2 0 0 1 0-4V5H3z" />
      <path d="M14 5v11" />
    </>
  ),
  tool: <path d="M14 7a4 4 0 0 0 5 5l-8 8-3-3 8-8a4 4 0 0 0-2-2z" />,
  utensils: <path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M16 3c-2 1-3 4-3 7h3v11" />,
  wallet: (
    <>
      <path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11" />
      <circle cx="16" cy="13.5" r="1" />
    </>
  ),
  wrench: <path d="M15 4a4 4 0 0 0-4 5l-7 7 3 3 7-7a4 4 0 0 0 5-4l-2 2-2-1-1-2z" />,
  // Not a category's own: what a transaction with no category shows.
  question: <path d="M9 9a3 3 0 1 1 4 2.8c-.6.3-1 .9-1 1.6V15M12 18v.5" />,
}
