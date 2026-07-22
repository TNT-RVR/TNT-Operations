/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // TNT Operations brand: honey amber primary + field green secondary.
        // READABILITY RULE (inherited pattern): any element with a `bg-brand`
        // (or `bg-field`) background MUST use white text — never low-contrast.
        brand: {
          DEFAULT: '#B8860B', // honey amber
          dark: '#8C6608', // hover / deeper honey
          light: '#FBF1D3', // tint for secondary surfaces
        },
        field: {
          DEFAULT: '#4D7C0F', // canola-field green
          dark: '#3F6212',
          light: '#ECFCCB',
        },
        ink: '#1A1206', // warm near-black (headings / wordmark)
      },
      minHeight: {
        touch: '3rem', // 48px minimum touch target (field/tablet use)
      },
    },
  },
  plugins: [],
}
