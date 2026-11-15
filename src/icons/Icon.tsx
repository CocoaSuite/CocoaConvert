/**
 * The shared icon set (Design Bible section 11): 24 × 24 grid, 2 px stroke,
 * round caps and joins, no fill, coloured with currentColor.
 */
const PATHS = {
  open: 'M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2M12 4v11M7 9l5-5 5 5',
  download: 'M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2M12 4v11M7 10l5 5 5-5',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  chev: 'M6 9l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3',
  update: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  swap: 'M4 8h13M14 5l3 3-3 3M20 16H7M10 13l-3 3 3 3',
  image: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM20 15l-5-5L5 20',
  doc: 'M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7zM14 3v4h4M9 12h6M9 16h6',
  sheet: 'M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 10h16M4 15h16M10 4v16',
  slides: 'M3 5h18M5 5v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5M12 16v4M8 20h8',
  book: 'M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2zM5 18a2 2 0 0 1 2-2h11M9 8h5',
  audio: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  video: 'M4 6h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM16 10l5-3v10l-5-3',
  archive: 'M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM3 4h18v4H3zM10 12h4',
  data: 'M8 4H7a2 2 0 0 0-2 2v3a2 2 0 0 1-2 2v2a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2h1M16 4h1a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2v2a2 2 0 0 0-2 2v3a2 2 0 0 1-2 2h-1',
  alert: 'M12 9v4M12 16.5v.01M10.3 4.2L2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z',
  server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7v.01M8 17v.01',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, class: cls }: { name: IconName; size?: number; class?: string }) {
  return (
    <svg
      class={cls}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The suite's heavy open C with CocoaConvert's glyph (an arrow and a dot) in its opening. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M19.43 5.31A10 10 0 1 0 19.43 18.69L15.72 15.35A5 5 0 1 1 15.72 8.65Z"
      />
      <path d="M15.6 9.6L18 12l-2.4 2.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="21.2" cy="12" r="1.3" fill="currentColor" />
    </svg>
  );
}
