/** @type {import('tailwindcss').Config} */
// Colours resolve to CSS custom properties from src/styles/tokens.css, so every
// utility is theme-aware (dark default; `.on-light` on the root flips them).
// NEVER add a raw hex here — add a token to tokens.css and reference it.
const honey = Object.fromEntries(
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((s) => [s, `var(--honey-${s})`]),
)
const ink = Object.fromEntries(
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 850, 900, 950].map((s) => [s, `var(--ink-${s})`]),
)

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        honey,
        ink,
        // Brand actions (honey is the ONLY accent).
        brand: {
          DEFAULT: 'var(--brand)',
          hover: 'var(--brand-hover)',
          press: 'var(--brand-press)',
          dark: 'var(--brand-press)',
          light: 'var(--brand-subtle)',
          subtle: 'var(--brand-subtle)',
        },
        'on-brand': 'var(--on-brand)',
        // Semantic surfaces.
        base: 'var(--bg-base)',
        surface: 'var(--bg-surface)',
        raised: 'var(--bg-raised)',
        overlay: 'var(--bg-overlay)',
        inset: 'var(--bg-inset)',
        // Semantic text (also usable as bg-* for chips/fills).
        primary: 'var(--text-primary)',
        secondary: 'var(--text-secondary)',
        muted: 'var(--text-muted)',
        faint: 'var(--text-faint)',
        // Status foregrounds.
        ok: 'var(--ok-fg)',
        warn: 'var(--warn-fg)',
        danger: 'var(--danger-fg)',
        info: 'var(--info-fg)',
        // Data palette (charts only).
        'data-honey': 'var(--data-honey)',
        'data-teal': 'var(--data-teal)',
        'data-lime': 'var(--data-lime)',
        'data-coral': 'var(--data-coral)',
        'data-sky': 'var(--data-sky)',
        'data-violet': 'var(--data-violet)',
      },
      textColor: {
        primary: 'var(--text-primary)',
        secondary: 'var(--text-secondary)',
        muted: 'var(--text-muted)',
        faint: 'var(--text-faint)',
        brand: 'var(--text-brand)',
        'on-brand': 'var(--text-on-brand)',
      },
      borderColor: {
        DEFAULT: 'var(--border-default)',
        subtle: 'var(--border-subtle)',
        strong: 'var(--border-strong)',
        brand: 'var(--border-brand)',
      },
      divideColor: {
        DEFAULT: 'var(--border-subtle)',
        subtle: 'var(--border-subtle)',
        default: 'var(--border-default)',
      },
      ringColor: {
        brand: 'var(--brand-ring)',
        focus: 'var(--focus-ring)',
      },
      fontFamily: {
        display: 'var(--font-display)',
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },
      borderRadius: {
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
        pill: 'var(--radius-pill)',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
        brand: 'var(--glow-brand)',
        'brand-soft': 'var(--glow-brand-soft)',
      },
      minHeight: {
        touch: '3rem', // 48px minimum touch target (field/tablet use)
      },
    },
  },
  plugins: [],
}
