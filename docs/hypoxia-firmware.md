# Hypoxia firmware — reporting to TNT directly

What to change in the student's ESP32-C3 sketch so a chamber talks to TNT
Operations instead of ThingsBoard, and how to flash it.

The Nano is **not** changed. It keeps printing its one JSON line and keeps
accepting the same text commands; only the bridge in the middle changes.

---

## What this replaces

The ESP32 currently opens an MQTT connection to `thingsboard.cloud`, publishes
each telemetry line to `v1/devices/me/telemetry`, and subscribes to
`v1/devices/me/rpc/request/+` for commands.

That becomes one HTTPS POST per cycle. The reply to that POST carries the next
queued command, so there is no broker, no persistent connection, no second
endpoint to poll, and no inbound port on a box in a shed.

It is also less code: `PubSubClient` and the whole RPC-parsing block come out.

---

## 1. Get the device key

In the app: **Incubation → Hypoxia → Add chamber**. Name it, and the next screen
shows the key **once**. Copy it before closing.

Only a hash is stored, so it cannot be shown again. If it is lost, use **Issue
new key** on the chamber and reflash — that is deliberately cheaper than a
credential anyone could look up. It is also the fix for how this arrived: the
old sketch carried its ThingsBoard token as a string literal in a file that got
emailed around.

## 2. Edit the sketch

Open `TNT_ESP32C3_CODE.ino` in the Arduino IDE.

**Remove** — the ThingsBoard section:

```cpp
#include <PubSubClient.h>
static const char* TB_HOST  = "thingsboard.cloud";
static const int   TB_PORT  = 1883;
static const char* TB_TOKEN = "…";        // ← and rotate this in ThingsBoard
```
…along with `tbOnMqtt`, `tbConnect`, the `tbMqtt` client and its `loop()` calls.

**Add** — near the top:

```cpp
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

static const char* TNT_URL  = "https://tntoperations.netlify.app/.netlify/functions/hypoxia-ingest";
static const char* DEVICE_KEY = "PASTE_THE_KEY_HERE";

// Let's Encrypt ISRG Root X1 — the CA behind the site's certificate.
// Pinning the root means a device on a farm Wi-Fi cannot be talked into
// sending its telemetry, or taking its commands, from somebody else.
static const char* ISRG_ROOT_X1 = R"CERT(
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
)CERT";
```

**Add** — the reporting function, and call it where the ThingsBoard publish was:

```cpp
static uint32_t lastPostMs = 0;
static const uint32_t POST_MIN_MS = 15000;   // same cadence as before

// Sends the Nano's line and acts on whatever comes back.
static void postToTnt(const String& line) {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure tls;
  tls.setCACert(ISRG_ROOT_X1);

  HTTPClient http;
  if (!http.begin(tls, TNT_URL)) return;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", DEVICE_KEY);
  http.setTimeout(8000);

  int code = http.POST(line);
  if (code == 200) {
    String body = http.getString();
    // {"cmd":"PURGE"} or {}
    int i = body.indexOf("\"cmd\":\"");
    if (i >= 0) {
      int j = body.indexOf('"', i + 7);
      if (j > i) {
        String cmd = body.substring(i + 7, j);
        cmd.trim();
        if (cmd.length() > 0) startBurst(cmd);   // the existing Nano path
      }
    }
  } else {
    Serial.print("TNT POST failed: "); Serial.println(code);
  }
  http.end();
}
```

In `handleNanoJsonLine`, replace the ThingsBoard queueing:

```cpp
  // was: tbPendingJson = line; tbHavePending = true;
  uint32_t now = millis();
  if (now - lastPostMs >= POST_MIN_MS) {
    lastPostMs = now;
    postToTnt(line);
  }
```

`startBurst` already exists and already repeats a command to the Nano until it
is confirmed, so commands keep the delivery behaviour they had.

## 3. Flash it

1. Arduino IDE → **Tools → Board → ESP32C3 Dev Module**
2. Select the port the board appears on
3. **Upload**
4. Open **Serial Monitor at 115200** and watch for `TNT POST failed` — silence
   there means it is posting cleanly

The chamber shows live readings in the app within a minute.

---

## Checking it

- **Incubation → Hypoxia** — the card leaves "Silent" and shows oxygen
- Press **Purge now** — the chamber should act within ~15 seconds, and the
  telemetry that follows shows `purging`
- The history chart fills in as readings arrive

## If it stays silent

| Symptom | Cause |
|---|---|
| `TNT POST failed: 401` | Key wrong or not saved. Issue a new one and reflash. |
| `TNT POST failed: 403` | The chamber is marked inactive in the app. |
| `TNT POST failed: -1` | TLS or Wi-Fi. Check the board is on the network. |
| Nothing in Serial at all | The Nano is not sending lines — check the UART wiring. |

## What did not change

The Nano firmware, the command vocabulary, the purge cycle, calibration, and
the BLE setup path. Only the bridge's transport moved.
