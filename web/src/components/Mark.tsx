/**
 * The Bluebank mark.
 *
 * Inline rather than an <img> so it costs no request and cannot flash in after
 * the nav row has already painted. The light fills only: this never sits on
 * anything but the app's own white or chrome band, so the dark variant that
 * public/favicon.svg carries would never apply.
 *
 * Keep the geometry in step with public/favicon.svg. They are the same mark and
 * the two are only separate because the favicon needs the theme swap and this
 * needs to be a component.
 */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 48 48"
         fill="none" aria-hidden="true" focusable="false">
      <rect x="5" y="7" width="30" height="22" rx="3" fill="#1b2264" />
      <rect x="9" y="13" width="30" height="22" rx="3" fill="#26399a" />
      <rect x="13" y="19" width="30" height="22" rx="3" fill="#324dc8" />
      <rect x="17.5" y="27" width="17" height="2.8" rx="1.4" fill="#ffffff" />
      <rect x="17.5" y="32.5" width="13" height="2.8" rx="1.4" fill="#ffffff" />
      <circle cx="38" cy="28.4" r="1.9" fill="#eab308" />
    </svg>
  )
}
