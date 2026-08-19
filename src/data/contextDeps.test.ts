/**
 * The one invariant holding `SupabaseProvider`'s context value together.
 *
 * Every screen reads ONE memoised object. So a state variable used inside that
 * object but absent from its dependency array does not go stale on its own —
 * it freezes the whole context, for every consumer, until an unrelated
 * dependency happens to change and force a recompute. That is why the symptom
 * was "the Analysis page is empty until you refresh, then fine", and why the
 * same omission had `placed_by` recorded as null and "Join crew" telling a
 * signed-in user to sign in. Seven variables had drifted off the list.
 *
 * A source-text check rather than a runtime one: the bug is in what the array
 * literal says, and rendering the provider would need the whole Supabase
 * client stood up to prove much less.
 *
 * If this fails, add the named variable to the deps array at the bottom of
 * `useMemo<DataContextValue>`. It is never right to "fix" it by renaming the
 * variable or deleting the test — the value really is read in there.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PROVIDERS = [
  { file: 'SupabaseProvider.tsx', memo: 'const value = useMemo<DataContextValue>(' },
  // The mock provider has the same shape and the same trap: a checklist
  // mark saved into state that the memo never re-reads looks like a button
  // that does nothing. Caught here first, in mock mode, before the backend.
  { file: 'AppData.tsx', memo: 'const value = useMemo<DataContextValue>(' },
]

describe.each(PROVIDERS)('$file context value', ({ file, memo }) => {
  it('lists every state it reads in its dependency array', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'data', file), 'utf8')

    const stateNames = [...src.matchAll(/const \[(\w+), set\w+\] = useState/g)].map((m) => m[1])
    expect(stateNames.length).toBeGreaterThan(20) // the regex still matches something

    const start = src.indexOf(memo)
    expect(start).toBeGreaterThan(-1)

    // Newline-agnostic: these two files disagree about line endings, and an
    // anchor written with \n matches neither in the CRLF one — which would
    // read as "the memo has no deps array" rather than as a broken test.
    const close = src.slice(start).search(/\r?\n {4}\],\r?\n {2}\)/)
    expect(close).toBeGreaterThan(-1)
    const depsEnd = start + close
    const depsStart = src.lastIndexOf('    [', depsEnd)
    expect(depsStart).toBeGreaterThan(start)

    const body = src.slice(start, depsStart)
    // Only the array literal itself, with comments stripped. Reading past the
    // closing bracket — or leaving the comments in — lets a name mentioned in
    // prose count as a dependency, which is exactly how this check first
    // passed against a deps array it should have failed.
    expect(depsEnd).toBeGreaterThan(depsStart)
    const depsText = src.slice(depsStart, depsEnd).replace(/\/\/[^\n]*/g, '')
    const deps = new Set(depsText.match(/\w+/g) ?? [])

    const missing = stateNames.filter(
      (name) => new RegExp(`(?<![\\w.])${name}(?![\\w])`).test(body) && !deps.has(name),
    )

    expect(missing, `state read in the context value but missing from its deps: ${missing.join(', ')}`).toEqual([])
  })
})
