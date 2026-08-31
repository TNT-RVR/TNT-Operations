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
 * The FIRST fix was wrong in the other direction: darkening the fill until it
 * passed on its own turned the button brown, and that was reported too. A
 * colour dark enough to be legible text is too dark to still look like honey.
 * So the fill stays the brand and the contrast comes from the button's EDGE,
 * which is what these tests now check.
 *
 * WCAG thresholds used here:
 *   3.0  a UI component against its background (SC 1.4.11)
 *   4.5  normal text against its background (SC 1.4.3)
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(process.cwd(), 'src', 'styles', 'tokens.css'), 'utf8')

/**
 * The literal value of a token, as the cascade would resolve it.
 *
 * A token the light theme does not override INHERITS from `:root` — that is the
 * point of redefining only what changes. So a miss inside `.on-light` falls
 * back to `:root` rather than failing, which is what a browser does.
 */
function token(name: string, scope: 'root' | 'light'): string {
  const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('.on-light {'))
  const lightBlock = css.slice(css.indexOf('.on-light {'))
  const find = (block: string, key: string) =>
    new RegExp(`--${key}\\s*:\\s*([^;]+);`).exec(block)?.[1]?.trim()

  const direct =
    scope === 'light' ? (find(lightBlock, name) ?? find(rootBlock, name)) : find(rootBlock, name)
  if (!direct) throw new Error(`token --${name} not found in ${scope}`)

  const indirect = /^var\(--([\w-]+)\)$/.exec(direct)
  if (!indirect) return direct
  // Palette entries live in :root whichever theme references them.
  const resolved = find(rootBlock, indirect[1])
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
  const edge = () => token('brand-edge', 'light')
  // What the button actually sits on: the page surface, not pure white.
  const surface = () => token('bg-surface', 'light')

  /*
   * The FILL is honey and does not contrast with a pale page — it is not
   * supposed to. WCAG 1.4.11 asks that a control be distinguishable, and a
   * visible boundary satisfies that just as well as a contrasting fill. This
   * is the check that matters, and it is on the edge.
   */
  it('has an edge that makes it read as a control', () => {
    expect(contrast(edge(), surface())).toBeGreaterThanOrEqual(3)
  })

  it('has a readable label on the fill', () => {
    expect(contrast(token('on-brand', 'light'), brand())).toBeGreaterThanOrEqual(4.5)
  })

  /*
   * The mistake this file was written for, now stated the other way round.
   * Making the FILL dark enough to pass on its own turned the button brown:
   * the colour that reads as honey and the colour that reads as text on white
   * are not the same colour. The brand must stay the brand.
   */
  it('still looks like honey — the fill is the brand, in both themes', () => {
    expect(brand()).toBe(token('brand', 'root'))
  })

  // Brand-coloured TEXT (active nav, links) is text, so it needs 4.5 — and
  // that is exactly the job --honey-deep exists for.
  it('reads as text where the brand is used for text', () => {
    expect(contrast(token('text-brand', 'light'), surface())).toBeGreaterThanOrEqual(4.5)
  })
})

describe('the primary button on the DARK theme', () => {
  const brand = () => token('brand', 'root')
  const surface = () => token('bg-surface', 'root')

  // No edge needed here: honey on near-black is far past 3:1 on its own, which
  // is why --brand-edge is transparent in the dark theme.
  it('is visible as a control from its fill alone', () => {
    expect(contrast(brand(), surface())).toBeGreaterThanOrEqual(3)
  })

  it('has a readable label on it', () => {
    expect(contrast(token('on-brand', 'root'), brand())).toBeGreaterThanOrEqual(4.5)
  })

  it('reads as text where the brand is used for text', () => {
    expect(contrast(token('text-brand', 'root'), surface())).toBeGreaterThanOrEqual(4.5)
  })
})
