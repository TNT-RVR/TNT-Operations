import { useTheme } from '@/styles/theme'

/**
 * TNT bee mark — the one brand glyph (logo, loading, empty states only).
 *
 * Uses the official artwork files, swapped by theme:
 *   - dark theme  → /bee-dark.png   (yellow/honey mark)
 *   - light theme → /bee-light.png  (black mark)
 */
export function BeeMark({ size = 28, className, title }: { size?: number; className?: string; title?: string }) {
  const { theme } = useTheme()
  const src = theme === 'light' ? '/bee-light.png' : '/bee-dark.png'
  return <img src={src} width={size} height={size} className={className} alt={title ?? 'TNT'} />
}
