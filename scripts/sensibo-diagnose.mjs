/**
 * Ask Sensibo what actually happened to our commands.
 *
 * Every acState change is recorded with a status and, when it goes wrong, a
 * reason — and none of that has ever been read. The app only ever saw "HTTP
 * 200", which means Sensibo ACCEPTED the command, not that the AC did anything
 * with it.
 *
 * This prints, per pod: whether the pod itself is online, what its remote is
 * believed to support, the last few commands with their outcomes, and then —
 * only if you pass --off — sends one power-off and reports what became of it.
 *
 * Read-only unless --off is given.
 *
 *   node scripts/sensibo-diagnose.mjs YOUR_SENSIBO_API_KEY
 *   node scripts/sensibo-diagnose.mjs YOUR_SENSIBO_API_KEY --off=POD_ID
 *
 * --off names ONE pod on purpose. This turns off real heat over real bees, and
 * a flag that acted on every incubator at once because it was easier to type
 * is not a flag worth having.
 */

const KEY = process.argv.find((a) => !a.startsWith('--') && a.length > 20 && !a.includes('\\'))
const OFF_POD = (process.argv.find((a) => a.startsWith('--off=')) ?? '').slice('--off='.length)
if (process.argv.includes('--off')) {
  console.error('Name the pod: --off=POD_ID (this switches off a real incubator)')
  process.exit(1)
}

if (!KEY) {
  console.error('Give it the Sensibo API key: node scripts/sensibo-diagnose.mjs <key> [--off=POD_ID]')
  process.exit(1)
}

const API = 'https://home.sensibo.com/api/v2'
const q = (path, params = '') => `${API}${path}?apiKey=${encodeURIComponent(KEY)}${params}`

const show = (label, value) => console.log(`   ${label.padEnd(22)} ${value}`)

async function main() {
  const podsRes = await fetch(
    q(
      '/users/me/pods',
      '&fields=id,room,acState,connectionStatus,productModel,remoteCapabilities,temperatureUnit',
    ),
  )
  const pods = (await podsRes.json())?.result ?? []
  console.log(`${pods.length} pod(s)\n`)

  for (const p of pods) {
    console.log('─'.repeat(72))
    console.log(`${p.room?.name ?? '(no room)'}   id=${p.id}   model=${p.productModel}`)

    // Is the POD itself reachable? A pod off wifi accepts nothing, and this is
    // the first thing to rule out before blaming infrared.
    const conn = p.connectionStatus
    show('pod online', conn ? `${conn.isAlive}${conn.lastSeen ? ` (last seen ${conn.lastSeen.secondsAgo}s ago)` : ''}` : 'unknown')

    const ac = p.acState ?? {}
    show('believed state', `on=${ac.on} mode=${ac.mode} target=${ac.targetTemperature}${ac.temperatureUnit ?? ''} fan=${ac.fanLevel}`)

    // Some AC remotes model "off" as a mode rather than a power flag. If this
    // list has no way to be off, that is the whole answer.
    const modes = Object.keys(p.remoteCapabilities?.modes ?? {})
    show('modes the remote has', modes.join(', ') || '(none reported)')

    // ── What became of recent commands ────────────────────────────────────
    // This is the part nothing has ever looked at: Sensibo says whether it
    // transmitted, and why not when it did not.
    const hist = await fetch(q(`/pods/${p.id}/acStates`, '&limit=8&fields=status,reason,time,acState,failureReason,resultingAcState'))
    const rows = (await hist.json())?.result ?? []
    console.log(`   last ${rows.length} command(s):`)
    for (const r of rows) {
      const st = r.status ?? '?'
      const when = r.time?.time ?? r.time?.secondsAgo ?? ''
      const on = r.acState?.on
      const fail = r.failureReason || r.resultingAcState?.on?.failureReason || ''
      console.log(
        `     ${String(st).padEnd(9)} on=${String(on).padEnd(5)} ${r.reason ?? ''} ${when}` +
          (fail ? `  FAILURE: ${JSON.stringify(fail)}` : ''),
      )
    }

    if (OFF_POD && OFF_POD === p.id) {
      console.log('   → sending power OFF …')
      const res = await fetch(q(`/pods/${p.id}/acStates/on`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newValue: false, reason: 'UserRequest' }),
      })
      const body = await res.json().catch(() => ({}))
      show('response', `HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`)

      // Give the pod a moment, then ask what it made of it.
      await new Promise((r) => setTimeout(r, 4000))
      const after = await fetch(q(`/pods/${p.id}/acStates`, '&limit=1&fields=status,reason,acState,failureReason'))
      const last = (await after.json())?.result?.[0]
      show('outcome', JSON.stringify(last).slice(0, 400))
    }
  }
}

main().catch((e) => {
  console.error('failed:', e)
  process.exit(1)
})
