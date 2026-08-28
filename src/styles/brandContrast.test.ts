/**
 * The brand colour has to work on the theme it is used in.
 *
 * This exists because it did not. The dark theme's honey was chosen against
 * near-black, where it blazes. When light became the default theme it kept
 * being the primary button's background — at **1.66:1** against a white page,
 * which is below the 3:1 a control needs to read as a control at all.
 *
 * It did not look broken. It looked like a pale yellow shape, and the way it
 * surfaced was somebody saying they could not find the "add user" button. That
 * is the failure mode worth guarding: not an error, not a crash — a control
 * nobody can see.
 *
 * WCAG thresholds used here:
 *   3.0  a UI component against its background (SC 1.4.11)
 *   4.5  normal text against its background (SC 1.4.3)
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(process.cwd(), 'src', 'styles', 'tokens.css'), 'utf8')

/** The literal value of a token, following one level of `var()` indirection. */
function token(name: string, scope: 'root' | 'light'): string {
  const block =
    scope === 'light'
      ? css.slice(css.indexOf('.on-light {'))
      : css.slice(css.indexOf(':root {'), css.indexOf('.on-light {'))
  const direct = new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(block)?.[1]?.trim()
  if (!direct) throw new Error(`token --${name} not found in ${scope}`)
  const indirect = /^var\(--([\w-]+)\)$/.exec(direct)
  if (!indirect) return direct
  // Palette entries live in :root whichever theme references them.
  const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('.on-light {'))
  const resolved = new RegExp(`--${indirect[1]}\\s*:\\s*([^;]+);`).exec(rootBlock)?.[1]?.trim()
  if (!resolved) throw new Error(`token --${indirect[1]} not found`)
  return resolved
}

function rgb(value: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim())
  if (hex) {
    const n = parseInt(hex[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const parts = value.match(/[\d.]+/g)
  if (!parts || parts.length < 3) throw new Error(`cannot read colour: ${value}`)
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])]
}

const luminance = (c: [number, number, number]) => {
  const [r, g, b] = c.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(rgb(a)), luminance(rgb(b))]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

describe('the primary button on the LIGHT theme', () => {
  const brand = () => token('brand', 'light')
  // What the button actually sits on: the page surface, not pure white.
  const surface = () => token('bg-surface', 'light')

  it('is visible as a control against the page', () => {
    expect(contrast(brand(), surface())).toBeGreaterThanOrEqual(3)
  })

  it('has a readable label on it', () => {
    expect(contrast(token('on-brand', 'light'), brand())).toBeGreaterThanOrEqual(4.5)
  })

  // Brand-coloured TEXT (active nav, links) is text, so it needs 4.5 too.
  it('reads as text where the brand is used for text', () => {
    expect(contrast(token('text-brand', 'light'), surface())).toBeGreaterThanOrEqual(4.5)
  })

  // The bug in one line: the dark theme's honey must not be the light theme's.
  it('does not reuse the dark theme honey', () => {
    expect(brand()).not.toBe(token('brand', 'root'))
  })
})

describe('the primary button on the DARK theme', () => {
  const brand = () => token('brand', 'root')
  const surface = () => token('bg-surface', 'root')

  it('is visible as a control against the page', () => {
    expect(contrast(brand(), surface())).toBeGreaterThanOrEqual(3)
  })

  it('has a readable label on it', () => {
    expect(contrast(token('on-brand', 'root'), brand())).toBeGreaterThanOrEqual(4.5)
  })

  it('reads as text where the brand is used for text', () => {
    expect(contrast(token('text-brand', 'root'), surface())).toBeGreaterThanOrEqual(4.5)
  })
})
