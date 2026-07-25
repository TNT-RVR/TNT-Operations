#!/usr/bin/env node
/**
 * Design-token guard. Flags raw hex colours committed outside the token layer
 * (src/styles/tokens.css). Everything visual must reference a var(--*) token or
 * a Tailwind utility that maps to one — never a literal hex in a component.
 *
 * Allowed exceptions:
 *   - src/styles/tokens.css .................. the single source of truth
 *   - src/features/maps/** ................... MapLibre paint needs literal hex
 *   - src/features/field/** .................. same (the crew Field Mode map)
 *     (kept aligned to token hex values; MapLibre can't read CSS variables)
 *   - any line with a `token-exempt` comment .. explicit, reviewed escape hatch
 *
 * Usage: node scripts/check-tokens.mjs   (npm run lint:tokens)
 * Exits 1 if any violation is found.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SRC = join(ROOT, 'src')

const ALLOW_FILE = [
  /^src[\\/]styles[\\/]tokens\.css$/,
  /^src[\\/]features[\\/]maps[\\/]/,
  /^src[\\/]features[\\/]field[\\/]/,
]
const HEX = /#[0-9a-fA-F]{3,8}\b/g
const EXEMPT = /token-exempt/

/** @param {string} dir */
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (/\.(tsx?|css)$/.test(name)) yield p
  }
}

const violations = []
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file)
  if (ALLOW_FILE.some((re) => re.test(rel))) continue
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (EXEMPT.test(line)) return
    const hits = line.match(HEX)
    if (hits) violations.push(`${rel}:${i + 1}  ${hits.join(', ')}   ${line.trim().slice(0, 80)}`)
  })
}

if (violations.length) {
  console.error(`\n✖ ${violations.length} raw hex colour(s) outside the token layer:\n`)
  for (const v of violations) console.error('  ' + v)
  console.error('\nUse a var(--*) token from src/styles/tokens.css (or a Tailwind token utility).')
  console.error('Legitimate exceptions: add a `token-exempt` comment on the line.\n')
  process.exit(1)
}
console.log('✓ tokens: no raw hex outside the token layer')
