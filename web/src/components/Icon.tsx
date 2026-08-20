/**
 * Inline 24x24 stroke icons. Hand-rolled rather than pulled from a library so
 * there is no extra dependency and no icon font to load.
 */
type Name =
  | 'chevron-left' | 'chevron-right' | 'chevron-down' | 'chevron-up'
  | 'flag' | 'highlighter' | 'more' | 'close' | 'note' | 'calculator'
  | 'grip' | 'check' | 'sliders' | 'pin' | 'trash' | 'underline' | 'arrow-right'

const PATHS: Record<Name, string> = {
  'chevron-left': 'M15 18l-6-6 6-6',
  'chevron-right': 'M9 18l6-6-6-6',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-up': 'M18 15l-6-6-6 6',
  flag: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
  highlighter: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z',
  more: 'M12 6h.01M12 12h.01M12 18h.01',
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

/** Filled variant, used for the flag once a question is marked. */
export function FlagFilled({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24"
         fill="currentColor" stroke="currentColor" strokeWidth={1.8}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <path d="M4 22v-7" fill="none" />
    </svg>
  )
}
