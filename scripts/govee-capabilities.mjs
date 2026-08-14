/**
 * Print everything Govee will tell us about each sensor.
 *
 * The poller keeps temperature and humidity and drops the rest of the reply on
 * the floor, so "does the API report battery" cannot be answered by reading our
 * code — only by reading a real response from the real devices. This asks for
 * the device list, then the full state of each one, and prints it unfiltered.
 *
 * Read-only: it lists and reads, and writes nothing anywhere.
 *
 *   node scripts/govee-capabilities.mjs YOUR_GOVEE_API_KEY
 *   GOVEE_API_KEY=... node scripts/govee-capabilities.mjs
 */

const KEY = process.argv[2] || process.env.GOVEE_API_KEY
if (!KEY) {
  console.error('Give it the Govee API key: node scripts/govee-capabilities.mjs <key>')
  process.exit(1)
}

const LIST = 'https://openapi.api.govee.com/router/api/v1/user/devices'
const STATE = 'https://openapi.api.govee.com/router/api/v1/device/state'
const V1_LIST = 'https://developer-api.govee.com/v1/devices'
const V1_STATE = 'https://developer-api.govee.com/v1/devices/state'

const looksLikeBattery = (s) => /batt|power|volt/i.test(String(s))

async function main() {
  const listRes = await fetch(LIST, { headers: { 'Govee-API-Key': KEY } })
  const list = await listRes.json()
  const devices = list.data || []
  console.log(`v2 device list: ${listRes.status}, ${devices.length} device(s)\n`)

  for (const d of devices) {
    console.log('─'.repeat(70))
    console.log(`${d.deviceName ?? '(unnamed)'}  sku=${d.sku}  device=${d.device}`)

    // What the device SAYS it can do — the capability list from the directory.
    for (const c of d.capabilities ?? []) {
      const mark = looksLikeBattery(c.instance) ? '  ← battery?' : ''
      console.log(`   can: ${c.type} / ${c.instance}${mark}`)
    }

    // What it is reporting RIGHT NOW.
    const r = await fetch(STATE, {
      method: 'POST',
      headers: { 'Govee-API-Key': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        payload: { sku: d.sku, device: d.device },
      }),
    })
    const j = await r.json()
    console.log(`   state (v2): code ${j.code}`)
    for (const c of j.payload?.capabilities ?? []) {
      const mark = looksLikeBattery(c.instance) ? '  ← battery?' : ''
      console.log(`     ${c.type} / ${c.instance} = ${JSON.stringify(c.state?.value)}${mark}`)
    }

    // The legacy API sometimes carries properties v2 leaves out, so it is worth
    // a look before concluding the number does not exist.
    const u = `${V1_STATE}?device=${encodeURIComponent(d.device)}&model=${encodeURIComponent(d.sku)}`
    const r1 = await fetch(u, { headers: { 'Govee-API-Key': KEY } })
    const j1 = await r1.json()
    console.log(`   state (v1): code ${j1.code ?? r1.status}`)
    for (const p of j1.data?.properties ?? []) {
      const mark = Object.keys(p).some(looksLikeBattery) ? '  ← battery?' : ''
      console.log(`     ${JSON.stringify(p)}${mark}`)
    }
  }

  // v1 lists devices v2 does not always show, so check it for missing sensors.
  const r1 = await fetch(V1_LIST, { headers: { 'Govee-API-Key': KEY } })
  const j1 = await r1.json()
  const v1Devices = j1.data?.devices ?? []
  console.log('─'.repeat(70))
  console.log(`\nv1 device list: ${v1Devices.length} device(s)`)
  for (const d of v1Devices) {
    console.log(`   ${d.deviceName}  model=${d.model}  supportCmds=${JSON.stringify(d.supportCmds)}`)
  }
}

main().catch((e) => {
  console.error('failed:', e)
  process.exit(1)
})
