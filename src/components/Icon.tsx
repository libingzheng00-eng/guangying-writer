/** Small line-icon set for the toolbar. Decorative only: the button keeps its
 * title / aria-label, and SVG adds no text to the button's textContent. */
const PATHS = {
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  review: 'M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  scene: 'M12 5v14M5 12h14',
  dual: 'M4 5h7v14H4zM13 5h7v14h-7z',
  omit: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM5.6 5.6l12.8 12.8',
  chevron: 'm6 9 6 6 6-6',
  select: 'M4 6h2M4 12h2M4 18h2M9 6h11M9 12h11M9 18h11',
  arrowUpRight: 'M7 17 17 7M8 7h9v9',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
