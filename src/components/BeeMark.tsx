/**
 * TNT bee mark — the one brand glyph (logo, loading, empty states only).
 *
 * Drawn with `currentColor`, so it takes its colour from CSS. Callers set
 * `color: var(--logo-ink)` (honey on dark, ink-black on light) to get the
 * yellow-on-dark / black-on-light treatment from a single asset. An angular,
 * outline-style geometric bee — no honeycomb motifs.
 *
 * NOTE: reconstructed to match the supplied brand art. To swap in the exact
 * vector, replace the <path> geometry here AND public/bee.svg (favicon) with
 * the official artwork, keeping stroke/fill = currentColor.
 */
export function BeeMark({ size = 28, className, title }: { size?: number; className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 240 240"
      width={size}
      height={size}
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      fill="none"
      stroke="currentColor"
      strokeWidth={15}
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      {title && <title>{title}</title>}
      {/* head + antennae */}
      <path d="M120 22 L156 52 L120 82 L84 52 Z" />
      <path d="M104 33 L96 15" />
      <path d="M136 33 L144 15" />
      {/* arms out to the wings */}
      <path d="M98 98 L54 104" />
      <path d="M142 98 L186 104" />
      <rect x="20" y="96" width="34" height="60" rx="10" />
      <rect x="186" y="96" width="34" height="60" rx="10" />
      {/* abdomen segments */}
      <path d="M120 104 L152 134 L120 164 L88 134 Z" />
      <path d="M92 152 L120 176 L148 152" />
      <path d="M100 170 L120 188 L140 170" />
      {/* stinger */}
      <path d="M110 194 L130 194 L120 214 Z" fill="currentColor" stroke="none" />
    </svg>
  )
}
