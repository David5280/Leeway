// Leeway's interface icons: one set of simple line drawings on a 24 unit
// grid, stroked in the text color, for navigation, section heads and account
// kinds. Categories have their own set (design/categoryIcons.tsx).

export const ICONS = {
  back: <path d="M15 6l-6 6 6 6" />,
  forward: <path d="M9 6l6 6-6 6" />,
  warn: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4M12 17v.5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8v.5" />
    </>
  ),
  overview: <path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z" />,
  activity: <path d="M4 7h16M4 12h16M4 17h10" />,
  accounts: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M7 15h4" />
    </>
  ),
  budgets: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v8l6 4" />
    </>
  ),
  plan: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </>
  ),
  up: <path d="M6 15l6-6 6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  sync: (
    <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4" />
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  chat: (
    <path d="M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9l-4 3.5V17H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
  ),
  send: <path d="M5 12h13M13 6l6 6-6 6" />,
  bell: <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9M10 20.5a2.2 2.2 0 0 0 4 0" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.6M12 18.9v2.6M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2.5 12h2.6M18.9 12h2.6M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
    </>
  ),
  wallet: (
    <>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" />
      <rect x="4" y="8" width="16" height="11" rx="2.5" />
      <path d="M16 13.5h.5" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="M3 10h18M7 15h3" />
    </>
  ),
  piggy: (
    <>
      <path d="M5 11a7 6 0 0 1 12.5-3.2L20 7v4l-1.2.6A7 6 0 0 1 16 16v3h-3v-1.6a8 8 0 0 1-3 0V19H7v-3a6 6 0 0 1-2-5z" />
      <path d="M14.5 10.5h.01" />
    </>
  ),
  growth: <path d="M4 17l5-5 4 3 7-8M15 7h5v5" />,
  sunrise: (
    <>
      <path d="M4 18h16M7 18a5 5 0 0 1 10 0M12 4v4M5.6 8.6l1.8 1.8M18.4 8.6l-1.8 1.8" />
    </>
  ),
  loan: (
    <>
      <path d="M4 10l8-5 8 5" />
      <path d="M6 10v7M10 10v7M14 10v7M18 10v7M4 19h16" />
    </>
  ),
  moneyIn: <path d="M12 4v12M6 10l6 6 6-6M5 20h14" />,
  moneyOut: <path d="M12 20V8M6 14l6-6 6 6M5 4h14" />,
  tag: (
    <>
      <path d="M3 12V4h8l9 9-8 8z" />
      <path d="M7.5 8h.01" />
    </>
  ),
  pace: (
    <>
      <path d="M4 18a8 8 0 1 1 16 0" />
      <path d="M12 18l4-6" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  receipt: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6" />
    </>
  ),
  repeat: <path d="M17 3l3 3-3 3M20 6H8a4 4 0 0 0-4 4v1M7 21l-3-3 3-3M4 18h12a4 4 0 0 0 4-4v-1" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 12h.01" />
    </>
  ),
}

export type IconName = keyof typeof ICONS
