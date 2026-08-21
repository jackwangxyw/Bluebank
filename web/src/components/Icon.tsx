/**
 * Inline 24x24 stroke icons. Hand-rolled rather than pulled from a library so
 * there is no extra dependency and no icon font to load.
 */
type Name =
  | 'chevron-left' | 'chevron-right' | 'chevron-down' | 'chevron-up'
  | 'bookmark' | 'highlighter' | 'more' | 'close' | 'note' | 'calculator'
  | 'grip' | 'check' | 'sliders' | 'pin' | 'trash' | 'underline' | 'arrow-right'
  | 'split' | 'expand' | 'shrink' | 'grip-h' | 'dots9' | 'tag'

const PATHS: Record<Name, string> = {
  'chevron-left': 'M15 18l-6-6 6-6',
  'chevron-right': 'M9 18l6-6-6-6',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-up': 'M18 15l-6-6-6 6',
  bookmark: 'M6 4a1 1 0 011-1h10a1 1 0 011 1v17l-6-4.5L6 21z',
  highlighter: 'M4 20h6M13.5 3.2a2 2 0 012.9 2.8L8.6 17 5 18l.8-3.7z',
  more: 'M12 5.2h.01M12 12h.01M12 18.8h.01',
  close: 'M18 6L6 18M6 6l12 12',
  note: 'M15 3H5a2 2 0 00-2 2v14a2 2 0 002 2h10l6-6V5a2 2 0 00-2-2zM15 21v-6h6',
  calculator: 'M4 3h16v18H4zM8 7h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15v4',
  grip: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
  check: 'M20 6L9 17l-5-5',
  sliders: 'M4 6h16M4 12h16M4 18h16M9 4v4M15 10v4M7 16v4',
  pin: 'M12 21s7-6.3 7-11a7 7 0 10-14 0c0 4.7 7 11 7 11zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  underline: 'M6 4v6a6 6 0 0012 0V4M4 20h16',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  split: 'M12 4v16',
  expand: 'M20 4l-6.5 6.5M20 4v5M20 4h-5M4 20l6.5-6.5M4 20v-5M4 20h5',
  shrink: 'M4 10.5l6.5-6.5M10.5 4v6.5M10.5 10.5H4M20 13.5l-6.5 6.5M13.5 20v-6.5M13.5 13.5H20',
  dots9: 'M6 6h.01M12 6h.01M18 6h.01M6 12h.01M12 12h.01M18 12h.01M6 18h.01M12 18h.01M18 18h.01',
  'grip-h': 'M5 9h14M5 15h14',
  tag: 'M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0l-6.8-6.8A2 2 0 013.2 12.4V5a2 2 0 012-2h7.4a2 2 0 011.4.6l6.6 6.6a2 2 0 010 2.8zM8 8h.01',
}

interface Props {
  name: Name
  size?: number
  strokeWidth?: number
  className?: string
}

export function Icon({ name, size = 18, strokeWidth = 1.8, className }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

/** Filled variant, used for the bookmark once a question is marked. */
/**
 * The drag handle inside the pane divider: two arrowheads pointing outward with
 * a gap between them. Proportions measured off the real handle (11 wide, a
 * 2-unit gap); there is no centre bar, the gap is the handle showing through.
 */
export function SplitHandle({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="11" viewBox="0 0 12 11"
         fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M5 0L0 5.5 5 11z" />
      <path d="M7 0L12 5.5 7 11z" />
    </svg>
  )
}

export function BookmarkFilled({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24"
         fill="currentColor" stroke="currentColor" strokeWidth={1.8}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 4a1 1 0 011-1h10a1 1 0 011 1v17l-6-4.5L6 21z" />
    </svg>
  )
}
