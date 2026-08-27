import React from 'react'

// Small inline icon set — the DS ships icons embedded inside specific
// components (Button's arrow, Input's eye/warning) but no standalone icon
// primitive to import. These stay local, decorative (`aria-hidden`), and
// tokenless (pure `currentColor` strokes) — no raw color values.
// TODO(ds-gap): a standalone Icon primitive (or an exported icon set) is
// missing from @izzywdev/fuzefront-design-system; every DS component that
// needs an icon currently hand-rolls its own inline SVG (see Button.jsx,
// Input.jsx). File a ds-extraction issue once a 2nd consumer needs the same
// icons rather than duplicating this file.

export const ArrowLeftIcon = ({ size = 15 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={{ flex: 'none' }}
  >
    <path d="M19 12H5M11 18l-6-6 6-6" />
  </svg>
)

export const RetryIcon = ({ size = 15 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={{ flex: 'none' }}
  >
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </svg>
)
