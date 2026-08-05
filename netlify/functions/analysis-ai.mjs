/**
 * Plain-English reading of a correlation, from Claude.
 *
 * Replaces the eight `base44.integrations.Core.InvokeLLM` call sites in the
 * Leaf Bee Insights app. Base44 supplied a model as part of the platform; here
 * the key is ours and stays server-side.
 *
 * ── Why the prompt is shaped the way it is ───────────────────────────────────
 * The original prompt handed the model an r value and asked what it meant. Over
 * this data set that produces confident nonsense, because the strongest numbers
 * in the table are definitional — % female against % male is r = -1.000 because
 * they sum to 100, and an LLM asked "why do these correlate?" will invent a
 * biological reason rather than say "they are two halves of one total".
 *
 * So the caller passes the VERDICT it already computed (arithmetic / fragile /
 * lead), and the prompt's first instruction is to respect it. The model's job
 * is to explain an agronomic mechanism where one plausibly exists, and to say
 * plainly when the number is an artifact — not to decide which it is.
 *
 * Server-side only — secrets live in Netlify env, never in the browser:
 *   ANTHROPIC_API_KEY  — required; the function no-ops (501) without it
 *   ANTHROPIC_MODEL    — optional; defaults to claude-sonnet-5
 *
 * Uses global fetch — no dependencies.
 */

const SYSTEM = `You advise a commercial leafcutter-bee pollination business in southern Alberta. They place bee shelters on hybrid seed-canola and alfalfa fields under contract to seed companies, and run bee incubation facilities. You are reading their end-of-season field data.

Rules, in order of priority:

1. RESPECT THE VERDICT you are given. It was computed, not guessed.
   - verdict "arithmetic": the two metrics are related by definition (shares of one total, or one computed from the other). Say so in one sentence and STOP. Do not offer a biological or operational explanation. There isn't one.
   - verdict "fragile": the result rests on very few field-seasons or on a column with almost no variation. Say what would be needed to test it properly. Do not treat it as a finding.
   - verdict "lead": a real pattern worth investigating. Explain it.
2. Never claim causation from a correlation. "Fields with X also tend to show Y" is the strongest available phrasing.
3. Always respect n. A pattern over 12 field-seasons is a hypothesis; over 120 it is a pattern. Say which.
4. If you genuinely cannot think of a mechanism, say that. "No obvious agronomic reason — worth asking the crew" is a useful answer.
5. Suggest at most one concrete thing to measure or change next season.

Voice: confident, technical, plain-spoken. Active voice. No hype, no bee puns, no emoji, no bullet-point padding. Address the reader as "you". 120 words maximum.`

export default async (req) => {
  const apiKey = process.env.ANTHROPIC_API_KEY
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'

  if (!apiKey) {
    return json({ error: 'ANTHROPIC_API_KEY not set — add it in Netlify env to enable AI notes' }, 501)
  }
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body must be JSON' }, 400)
  }

  const { xLabel, yLabel, r, n, pValue, verdict, verdictReason, context } = body ?? {}
  if (!xLabel || !yLabel || typeof r !== 'number' || typeof n !== 'number') {
    return json({ error: 'Need xLabel, yLabel, r and n' }, 400)
  }

  const prompt = [
    `Metric A: ${xLabel}`,
    `Metric B: ${yLabel}`,
    `Pearson r: ${r.toFixed(3)}`,
    `Field-seasons compared (n): ${n}`,
    pValue !== null && pValue !== undefined ? `p-value: ${pValue}` : null,
    `Verdict: ${verdict ?? 'lead'}`,
    verdictReason ? `Why: ${verdictReason}` : null,
    context ? `Filters in effect: ${context}` : null,
    '',
    'Write the note.',
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 512,
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      const detail = await res.text()
      console.error('[analysis-ai] anthropic', res.status, detail)
      return json({ error: `Model call failed (${res.status})` }, 502)
    }

    const data = await res.json()
    const text = (data?.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('')
      .trim()

    return json({ note: text })
  } catch (e) {
    console.error('[analysis-ai]', e)
    return json({ error: String(e?.message ?? e) }, 500)
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
