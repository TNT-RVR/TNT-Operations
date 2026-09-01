/**
 * No credential may sit in a firmware source file.
 *
 * This is not hypothetical and it is not the student's mistake. The original
 * sketch carried its ThingsBoard token as a string literal, which is why the
 * app issues per-chamber keys and stores only their SHA-256. Then a real device
 * key was pasted into `hypoxia-esp32c3.ino` and committed to this repo, which
 * is PUBLIC -- reproducing the exact failure the design was meant to end.
 *
 * A comment saying "do not put the key here" had already been written directly
 * above the line the key went into. So this is a test instead.
 *
 * The key belongs in `secrets.h`, which is gitignored. `secrets.example.h`
 * carries the placeholder and is what gets committed.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const FIRMWARE = 'firmware'

/** Every source file under firmware/, except the gitignored key files. */
function sources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...sources(full))
      continue
    }
    if (entry === 'secrets.h') continue // gitignored, holds the real key
    if (/\.(ino|h|hpp|c|cpp)$/i.test(entry)) out.push(full)
  }
  return out
}

/**
 * A value that is plainly not a credential. Empty, or shouting placeholder.
 * Anything else assigned to a KEY/TOKEN/SECRET/PASSWORD name is treated as
 * real, because guessing which long strings are harmless is how one gets
 * through.
 */
const PLACEHOLDER = /^(|PASTE_[A-Z_]+|YOUR_[A-Z_]+|CHANGE_?ME|TODO|X+)$/

/**
 * Both spellings that put a credential in C source.
 *
 * `#define` is not an afterthought — it is how the firmware we were handed
 * carried its ThingsBoard token. A guard that only understood `=` would catch
 * our mistake while missing the original one it was written for.
 */
const PATTERNS = [
  /\b([A-Za-z0-9_]*(?:key|token|secret|password|passwd))\s*(?:\[\])?\s*=\s*"([^"]*)"/gi,
  /#define\s+([A-Za-z0-9_]*(?:key|token|secret|password|passwd))\s+"([^"]*)"/gi,
]

describe('firmware carries no credentials', () => {
  const files = sources(FIRMWARE)

  it('finds firmware sources to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s has no literal key', (file) => {
    const text = readFileSync(file, 'utf8')
    const found: string[] = []
    for (const pattern of PATTERNS) {
      for (const m of text.matchAll(pattern)) {
        if (!PLACEHOLDER.test(m[2])) found.push(m[1])
      }
    }
    expect(found, `${file} assigns a literal credential to ${found.join(', ')}`).toEqual([])
  })

  it('keeps secrets.h out of git', () => {
    const ignore = readFileSync('.gitignore', 'utf8')
    expect(ignore).toMatch(/firmware\/\*\*\/secrets\.h/)
  })

  it('ships an example header so the real one is obvious to create', () => {
    const example = readFileSync(join(FIRMWARE, 'hypoxia-esp32c3', 'secrets.example.h'), 'utf8')
    expect(example).toContain('DEVICE_KEY')
    expect(example).toContain('PASTE_THE_KEY_HERE')
  })
})
