/**
 * Weekly grant discovery. Asks Claude (with web search) for grants that are
 * currently OPEN and relevant to a leafcutter-bee pollination business / small
 * Alberta ag company, then upserts them into `grants`. New ones (unseen url)
 * fire the 0009 insert trigger → a "New grant" notification in the bell.
 *
 * Ported from the RVR Management App's grants-pull function.
 *
 * Server-side only — secrets live in Netlify env, never in the browser:
 *   ANTHROPIC_API_KEY      — required; the function no-ops (501) without it
 *   SUPABASE_SERVICE_ROLE  — Supabase service_role key (full access; server only)
 *   SUPABASE_URL           — optional; falls back to VITE_SUPABASE_URL
 *   ANTHROPIC_MODEL        — optional; defaults to claude-sonnet-5
 *
 * Uses global fetch + the PostgREST API — no dependencies.
 */

export const config = { schedule: '0 14 * * 1' } // Mondays 14:00 UTC

const PROMPT = `Search the web for grants, rebates, and cost-share funding programs that are CURRENTLY OPEN (accepting applications) and that a commercial leafcutter-bee pollination business in Alberta, Canada could apply for. The business provides managed leafcutter bees and bee-shelter placement for hybrid canola and other seed-production fields under contract with seed companies, and also runs bee incubation facilities.

Include:
- Pollinator / bee health and apiculture programs
- Alberta provincial agriculture programs (e.g. Sustainable CAP streams) and federal ones (e.g. AAFC programs, On-Farm Climate Action Fund)
- Applied agricultural research funding (e.g. RDAR)
- General SMALL BUSINESS programs the company could use (equipment, digital adoption, hiring/training, energy efficiency, export)

Return ONLY a JSON array (no prose) where each item is:
{"title": string, "funder": string, "url": string, "amount_min": number|null, "amount_max": number|null, "eligibility_summary": string (1-2 sentences), "summary": string (1 sentence), "closes_on": "YYYY-MM-DD"|null, "region": "Alberta"|"Canada", "categories": string[]}
Use null for unknown amounts/dates. Only include programs you found evidence are open. Output the JSON array and nothing else.`

export default async (req) => {
  const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SB_KEY = process.env.SUPABASE_SERVICE_ROLE
  const apiKey = process.env.ANTHROPIC_API_KEY
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'

  if (!SB_URL || !SB_KEY) return new Response('grants-pull: not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE)', { status: 500 })
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set — add it in Netlify env to enable the pull' }), {
      status: 501,
      headers: { 'content-type': 'application/json' },
    })
  }

  const sb = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
        messages: [{ role: 'user', content: PROMPT }],
      }),
    })
    if (!res.ok) {
      return new Response(JSON.stringify({ error: `Anthropic ${res.status}`, detail: (await res.text()).slice(0, 500) }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      })
    }
    const body = await res.json()
    const text = (body.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n')
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start < 0 || end < 0) {
      return new Response(JSON.stringify({ error: 'no JSON array in reply', text: text.slice(0, 500) }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      })
    }
    const items = JSON.parse(text.slice(start, end + 1))

    let inserted = 0
    for (const g of items) {
      const grantUrl = typeof g.url === 'string' ? g.url : null
      if (!g.title || !grantUrl) continue
      const row = {
        title: String(g.title).slice(0, 300),
        funder: g.funder ? String(g.funder) : null,
        url: grantUrl,
        amount_min: typeof g.amount_min === 'number' ? g.amount_min : null,
        amount_max: typeof g.amount_max === 'number' ? g.amount_max : null,
        eligibility_summary: g.eligibility_summary ? String(g.eligibility_summary) : null,
        summary: g.summary ? String(g.summary) : null,
        closes_on: typeof g.closes_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(g.closes_on) ? g.closes_on : null,
        region: g.region ? String(g.region) : 'Alberta',
        categories: Array.isArray(g.categories) ? g.categories.map(String) : [],
        source: 'auto',
        external_key: grantUrl, // dedup: the same url won't re-insert or re-notify
      }
      // ignoreDuplicates → only genuinely new grants insert (and notify).
      const ins = await fetch(`${SB_URL}/rest/v1/grants?on_conflict=external_key`, {
        method: 'POST',
        headers: {
          ...sb,
          'Content-Type': 'application/json',
          Prefer: 'resolution=ignore-duplicates,return=representation',
        },
        body: JSON.stringify(row),
      })
      if (ins.ok) {
        const created = await ins.json()
        if (Array.isArray(created) && created.length > 0) inserted++
      }
    }

    return new Response(JSON.stringify({ ok: true, found: items.length, inserted }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'content-type': 'application/json' } })
  }
}
