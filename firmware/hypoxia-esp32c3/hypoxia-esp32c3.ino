/*
  ESP32-C3 Super Mini - TNT hypoxia chamber bridge

  BLE "setup" + Wi-Fi auto reconnect + UART bridge to Nano
  + reports to TNT Operations over HTTPS

  -- What changed from the original ----------------------------------------
  This talked to ThingsBoard over MQTT and took commands back as RPC. It now
  posts the Nano's telemetry line straight to TNT and reads its next command
  out of the SAME response - one round trip, no broker, no persistent
  connection, and no inbound port on a box in a shed.

  Copy secrets.example.h to secrets.h and put the chamber key in there
  (Incubation -> Hypoxia -> Add chamber). It is shown once. secrets.h is
  gitignored; the key must never come back into this file.

  The Nano is unchanged: same JSON line out, same text commands in.
*/

#include <Arduino.h>
#include <WiFi.h>
#include <Preferences.h>

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#include <HTTPClient.h>
#include <WiFiClientSecure.h>

// =====================
// PIN / UART SETTINGS
// =====================
#define ESP_RX_PIN 20
#define ESP_TX_PIN 7
#define NANO_BAUD  19200

HardwareSerial NanoLink(1);

// =====================
// BUTTON + RGB LED
// =====================
#define BTN_PIN 4

#define LED_R 0
#define LED_G 1
#define LED_B 3

static inline void setRGB(uint8_t r, uint8_t g, uint8_t b) {
  digitalWrite(LED_R, r ? HIGH : LOW);
  digitalWrite(LED_G, g ? HIGH : LOW);
  digitalWrite(LED_B, b ? HIGH : LOW);
}

enum LedMode {
  LED_BOOT,
  LED_BLE_ADV,
  LED_BLE_CONN,
  LED_WIFI_CONNECT,
  LED_WIFI_OK,
  LED_WIFI_ERR
};

LedMode ledMode = LED_BOOT;

uint32_t ledT0 = 0;
bool ledFlip = false;

// =====================
// ISSUE ROTATION (LED)
// =====================
enum IssueBits : uint8_t {
  ISSUE_NANO_ERR  = 1 << 0,
  ISSUE_NANO_WARN = 1 << 1,
  ISSUE_BLE_DISC  = 1 << 2
};

uint8_t  issueMask    = 0;
uint32_t issueT0      = 0;
bool     issueOnPhase = true;
uint8_t  issueIdx     = 0;

static inline void setIssue(uint8_t bit, bool on) {
  if (on) issueMask |= bit;
  else    issueMask &= ~bit;
}

static inline bool issueActive(uint8_t bit) {
  return (issueMask & bit) != 0;
}

static inline void colorForIssue(uint8_t bit, uint8_t &r, uint8_t &g, uint8_t &b) {
  r = g = b = 0;
  if (bit == ISSUE_NANO_ERR)  { r = 1; g = 0; b = 0; }
  if (bit == ISSUE_BLE_DISC)  { r = 0; g = 0; b = 1; }
  if (bit == ISSUE_NANO_WARN) { r = 1; g = 1; b = 0; }
}

static inline uint8_t nextActiveIssueAfter(uint8_t current) {
  const uint8_t order[] = { ISSUE_NANO_ERR, ISSUE_BLE_DISC, ISSUE_NANO_WARN };
  const uint8_t N = sizeof(order) / sizeof(order[0]);

  uint8_t idx = 0;
  for (uint8_t i = 0; i < N; i++) {
    if (order[i] == current) { idx = i; break; }
  }

  for (uint8_t step = 1; step <= N; step++) {
    uint8_t bit = order[(idx + step) % N];
    if (issueActive(bit)) return bit;
  }
  return 0;
}

static inline uint8_t firstActiveIssue() {
  const uint8_t order[] = { ISSUE_NANO_ERR, ISSUE_BLE_DISC, ISSUE_NANO_WARN };
  const uint8_t N = sizeof(order) / sizeof(order[0]);
  for (uint8_t i = 0; i < N; i++) {
    if (issueActive(order[i])) return order[i];
  }
  return 0;
}

// =====================
// WIFI STORAGE
// =====================
Preferences prefs;
String savedSsid, savedPass;

bool haveCreds() { return savedSsid.length() > 0; }

void loadCreds() {
  prefs.begin("tntpod", true);
  savedSsid = prefs.getString("ssid", "");
  savedPass = prefs.getString("pass", "");
  prefs.end();
}

void saveCreds(const String& ssid, const String& pass) {
  prefs.begin("tntpod", false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  prefs.end();
  savedSsid = ssid;
  savedPass = pass;
}

void clearCreds() {
  prefs.begin("tntpod", false);
  prefs.remove("ssid");
  prefs.remove("pass");
  prefs.end();
  savedSsid = "";
  savedPass = "";
}

// =====================
// TNT OPERATIONS
// =====================

// -------------------------------------------------------------------------
//  The chamber's key lives in secrets.h, which is NOT in this repo.
//
//  Copy secrets.example.h to secrets.h and paste the key there. Arduino
//  compiles any .h sitting in the sketch folder, so nothing else changes,
//  and a key in a gitignored file cannot be committed by accident.
//
//  This file carried a real key into a public commit once. That is the same
//  failure as the ThingsBoard token the original firmware shipped with, so
//  the key does not live here any more.
// -------------------------------------------------------------------------
#if __has_include("secrets.h")
  #include "secrets.h"
#else
  #error "Missing secrets.h - copy secrets.example.h to secrets.h and paste the chamber key into it."
#endif

static const char* TNT_URL =
  "https://tntoperations.netlify.app/.netlify/functions/hypoxia-ingest";

// Same cadence the MQTT publish used.
static const uint32_t POST_MIN_MS = 15000;
static uint32_t lastPostMs = 0;

/*
  Let's Encrypt ISRG Root X1 - the CA behind the site's certificate.

  Pinned rather than using setInsecure(). Without it, a device on a farm
  Wi-Fi could be talked into sending its telemetry to somebody else and,
  worse, taking its COMMANDS from them - and those commands open valves and
  the blast door. Valid to June 2035.
*/
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

// RPC subscribe flag
static bool tbRpcSubscribed = false;

// =====================
// COMMAND BURST SENDER (ESP -> NANO)
// =====================
static uint32_t lastNanoRxMs = 0;
static uint32_t lastNanoJsonMs = 0;
static const uint16_t SEND_WINDOW_MS = 320;

struct NanoState {
  bool valid = false;
  int v1 = -1;
  int v2 = -1;
  int blow = -1;
  int circ = -1;

  int purge = -1;
  int lastPurge = -1;

  int w = -1;
  int e = -1;

  uint32_t lastMs = 0;
} nanoState;

static String   burstCmd = "";
static bool     burstActive = false;
static uint32_t burstT0 = 0;
static uint32_t burstLastSend = 0;

static const uint16_t BURST_PERIOD_MS  = 120;
static const uint16_t BURST_TIMEOUT_MS = 8000;

static void sendCmdToNanoNow(const String& cmd) {
  NanoLink.print(cmd);
  NanoLink.print("\r\n");
}

static bool parseIntField(const String& s, const char* key, int &outVal) {
  int k = s.indexOf(key);
  if (k < 0) return false;
  k += (int)strlen(key);

  while (k < (int)s.length() && s[k] == ' ') k++;

  bool neg = false;
  if (k < (int)s.length() && s[k] == '-') { neg = true; k++; }

  if (k >= (int)s.length() || s[k] < '0' || s[k] > '9') return false;

  long v = 0;
  while (k < (int)s.length() && s[k] >= '0' && s[k] <= '9') {
    v = v * 10 + (s[k] - '0');
    k++;
  }
  if (neg) v = -v;
  outVal = (int)v;
  return true;
}

static bool commandSatisfied(const String& cmd) {
  if (!nanoState.valid) return false;

  if (cmd == "PURGE") {
    if (nanoState.purge == 1) return true;
    if (nanoState.lastPurge == 0 && nanoState.purge == 1) return true;
    return false;
  }

  if (cmd.startsWith("V1=")) {
    if (cmd.endsWith("ON"))  return (nanoState.v1 == 1);
    if (cmd.endsWith("OFF")) return (nanoState.v1 == 0);
  }

  if (cmd.startsWith("V2=")) {
    if (cmd.endsWith("ON"))  return (nanoState.v2 == 1);
    if (cmd.endsWith("OFF")) return (nanoState.v2 == 0);
  }

  if (cmd.startsWith("BLOW=")) {
    int target = cmd.substring(5).toInt();
    return (nanoState.blow == target);
  }

  if (cmd.startsWith("CIRC=")) {
    int target = cmd.substring(5).toInt();
    return (nanoState.circ == target);
  }

  return false;
}

static void startBurst(String cmd) {
  cmd.trim();
  cmd.replace("\r", "");
  cmd.replace("\n", "");
  cmd.toUpperCase();

  if (cmd.length() == 0) return;

  burstCmd = cmd;
  burstActive = true;
  burstT0 = millis();
  burstLastSend = 0;

  Serial.print("TX->NANO BURST: [");
  Serial.print(burstCmd);
  Serial.println("]");

  sendCmdToNanoNow(burstCmd);
  burstLastSend = millis();
}

static void serviceBurst() {
  if (!burstActive) return;

  uint32_t now = millis();

  if (commandSatisfied(burstCmd)) {
    Serial.println("TX->NANO BURST: confirmed by telemetry");
    burstActive = false;
    burstCmd = "";
    return;
  }

  if (now - burstT0 >= BURST_TIMEOUT_MS) {
    Serial.println("TX->NANO BURST: timeout (no telemetry confirm)");
    burstActive = false;
    burstCmd = "";
    return;
  }

  if ((now - lastNanoJsonMs) > SEND_WINDOW_MS) return;
  if (now - lastNanoRxMs < 10) return;

  if (now - burstLastSend >= BURST_PERIOD_MS) {
    sendCmdToNanoNow(burstCmd);
    burstLastSend = now;
  }
}

// =====================
// RPC HELPERS
// =====================
static String tbExtractBetween(const String& s, const char* a, const char* b) {
  int i = s.indexOf(a);
  if (i < 0) return "";
  i += (int)strlen(a);
  int j = s.indexOf(b, i);
  if (j < 0) return "";
  return s.substring(i, j);
}

/*
  Send one telemetry line, and act on whatever comes back.

  The response is {"cmd":"PURGE"} or {}. Parsed by hand rather than with a
  JSON library: it is one known field, and the sketch already parses the
  Nano's lines this way.

  startBurst() is the original command path - it repeats the command to the
  Nano until the Nano confirms it, so commands keep the delivery behaviour
  they had under RPC.
*/
static void postToTnt(const String& line) {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure tls;
  tls.setCACert(ISRG_ROOT_X1);

  HTTPClient http;
  if (!http.begin(tls, TNT_URL)) {
    Serial.println("TNT: begin failed");
    return;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", DEVICE_KEY);
  http.setTimeout(8000);

  int code = http.POST(line);

  if (code == 200) {
    String body = http.getString();
    int i = body.indexOf("\"cmd\":\"");
    if (i >= 0) {
      int j = body.indexOf('"', i + 7);
      if (j > i) {
        String cmd = body.substring(i + 7, j);
        cmd.trim();
        if (cmd.length() > 0) {
          Serial.print("TNT cmd: ");
          Serial.println(cmd);
          startBurst(cmd);
        }
      }
    }
  } else if (code == 401) {
    Serial.println("TNT: key rejected - check DEVICE_KEY, or issue a new one in the app");
  } else if (code == 403) {
    Serial.println("TNT: chamber is marked inactive in the app");
  } else {
    Serial.print("TNT POST failed: ");
    Serial.println(code);
  }

  http.end();
}

// =====================
// BLE SETTINGS
// =====================
static const char* BLE_NAME = "TNT_POD";
static const char* SERVICE_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E";
static const char* RX_UUID      = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E";
static const char* TX_UUID      = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E";

BLEServer* pServer = NULL;
BLECharacteristic* pTxChar = NULL;
BLECharacteristic* pRxChar = NULL;

bool deviceConnected = false;
bool bleEnabled = false;

static void bleNotifyText(const String& msg) {
  if (!deviceConnected || !pTxChar) return;
  pTxChar->setValue((uint8_t*)msg.c_str(), msg.length());
  pTxChar->notify();
}

// =====================
// SETUP LINES (BLE or USB serial)
// =====================
/*
  One handler for both ways in.

  Wi-Fi credentials used to arrive only over BLE, which needs a phone, an app,
  an MTU big enough for the whole string in one write, and a format dropdown set
  to text rather than hex. On the first chamber, two different BLE apps failed
  to deliver a single write and the board never printed one BLE RX line, which
  is a lot of moving parts between a person and a Wi-Fi password.

  USB is already connected while flashing, already proven, and prints straight
  back. So the same line can now be typed into the Arduino Serial Monitor.

  Both paths run THIS function rather than each parsing for itself: the two
  cannot then disagree about what "WIFI:" means, and a fix to one is a fix to
  both.
*/
static void setupReply(const String& msg, bool toBle) {
  if (toBle) bleNotifyText(msg);
  // Always to serial as well. A reply that only went to the phone is invisible
  // to whoever is watching the cable, and vice versa.
  Serial.print(msg);
}

void handleSetupLine(String v, bool fromBle) {
  v.replace("\r", "");
  v.trim();
  if (v.length() == 0) return;

  if (v.startsWith("WIFI:") || v.startsWith("WIFI,")) {
    String ssid = "", pass = "";

    if (v.startsWith("WIFI:")) {
      int s = v.indexOf("SSID=");
      int p = v.indexOf("PASS=");
      if (s >= 0) {
        int sEnd = v.indexOf(';', s);
        ssid = (sEnd >= 0) ? v.substring(s + 5, sEnd) : v.substring(s + 5);
      }
      if (p >= 0) {
        int pEnd = v.indexOf(';', p);
        pass = (pEnd >= 0) ? v.substring(p + 5, pEnd) : v.substring(p + 5);
      }
    } else {
      int c1 = v.indexOf(',');
      int c2 = v.indexOf(',', c1 + 1);
      if (c1 >= 0 && c2 >= 0) {
        ssid = v.substring(c1 + 1, c2);
        pass = v.substring(c2 + 1);
      }
    }

    ssid.trim();
    pass.trim();

    if (ssid.length() == 0) {
      setupReply("WIFI_FAIL,NO_SSID\n", fromBle);
      return;
    }

    saveCreds(ssid, pass);
    setupReply("WIFI_SAVED\n", fromBle);

    ledMode = LED_WIFI_CONNECT;
    WiFi.mode(WIFI_STA);
    WiFi.begin(savedSsid.c_str(), savedPass.c_str());

    uint32_t t0 = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) {
      delay(100);
    }

    if (WiFi.status() == WL_CONNECTED) {
      String ip = WiFi.localIP().toString();
      setupReply(String("WIFI_OK,IP=") + ip + "\n", fromBle);
      ledMode = LED_WIFI_OK;
    } else {
      setupReply("WIFI_FAIL\n", fromBle);
      ledMode = LED_WIFI_ERR;
    }
    return;
  }

  // Everything else is a command for the Nano.
  startBurst(v);
}

/*
  Collect a line from USB serial, character by character.

  Deliberately not Serial.readStringUntil: that blocks for its timeout, and this
  is called from the same loop that has to keep bridging the Nano's telemetry.
  A password is typed slowly by a person, so partial input is the normal case.
*/
static String serialLine = "";

void pollSerialSetup() {
  while (Serial.available() > 0) {
    char ch = (char)Serial.read();
    if (ch == '\n' || ch == '\r') {
      if (serialLine.length() > 0) {
        String line = serialLine;
        serialLine = "";
        // Not echoed: the line contains the Wi-Fi password, and a serial
        // monitor already shows what was typed into it.
        Serial.println("USB RX: (line received)");
        handleSetupLine(line, false);
      }
      continue;
    }
    // A runaway sender must not grow this without limit.
    if (serialLine.length() < 250) serialLine += ch;
  }
}

// =====================
// MODE CONTROL
// =====================
void startBLE() {
  if (bleEnabled) return;

  BLEDevice::init(BLE_NAME);
  pServer = BLEDevice::createServer();

  class MyServerCallbacks : public BLEServerCallbacks {
    void onConnect(BLEServer* s) override {
      deviceConnected = true;
      Serial.println("BLE connected");
      ledMode = LED_BLE_CONN;
    }
    void onDisconnect(BLEServer* s) override {
      deviceConnected = false;
      Serial.println("BLE disconnected");
      ledMode = LED_BLE_ADV;
      BLEDevice::startAdvertising();
    }
  };
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService* pService = pServer->createService(SERVICE_UUID);

  pTxChar = pService->createCharacteristic(TX_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  pTxChar->addDescriptor(new BLE2902());

  class RxCallbacks : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic* c) override {
      String v = c->getValue();
      if (v.length() == 0) return;
      Serial.print("BLE RX: ");
      Serial.println(v);
      handleSetupLine(v, true);
    }
  };

  pRxChar = pService->createCharacteristic(RX_UUID, BLECharacteristic::PROPERTY_WRITE);
  pRxChar->setCallbacks(new RxCallbacks());

  pService->start();

  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->start();

  bleEnabled = true;
  deviceConnected = false;
  ledMode = LED_BLE_ADV;

  Serial.println("BLE advertising started (setup mode)");
}

void stopBLE() {
  if (!bleEnabled) return;
  BLEDevice::getAdvertising()->stop();
  deviceConnected = false;
  Serial.println("BLE advertising stopped");
}

// =====================
// LED PATTERNS
// =====================
void updateLed() {
  uint32_t now = millis();

  uint8_t baseIssues = issueMask & ~(ISSUE_BLE_DISC);
  if (baseIssues != 0 && bleEnabled && !deviceConnected) setIssue(ISSUE_BLE_DISC, true);
  else                                                  setIssue(ISSUE_BLE_DISC, false);

  if (issueMask != 0) {
    const uint16_t ON_MS  = 200;
    const uint16_t OFF_MS = 120;

    uint16_t step = issueOnPhase ? ON_MS : OFF_MS;
    if (now - issueT0 >= step) {
      issueT0 = now;

      if (issueOnPhase) {
        issueOnPhase = false;
      } else {
        issueOnPhase = true;
        uint8_t cur = (issueIdx == 0) ? ISSUE_NANO_WARN : issueIdx;
        uint8_t nxt = nextActiveIssueAfter(cur);
        if (nxt == 0) nxt = firstActiveIssue();
        issueIdx = nxt;
      }
    }

    if (!issueOnPhase) { setRGB(0,0,0); return; }

    uint8_t bit = issueIdx;
    if (bit == 0 || !issueActive(bit)) bit = firstActiveIssue();

    uint8_t r,g,b;
    colorForIssue(bit, r,g,b);
    setRGB(r,g,b);
    return;
  }

  switch (ledMode) {
    case LED_BOOT:
      if (now < 600) setRGB(1,1,1);
      else setRGB(0,0,0);
      break;

    case LED_BLE_ADV:
      if (now - ledT0 > 600) { ledT0 = now; ledFlip = !ledFlip; }
      setRGB(0,0, ledFlip ? 1 : 0);
      break;

    case LED_BLE_CONN:
      setRGB(0,0,1);
      break;

    case LED_WIFI_CONNECT:
      if (now - ledT0 > 250) { ledT0 = now; ledFlip = !ledFlip; }
      setRGB(ledFlip ? 1 : 0, ledFlip ? 1 : 0, 0);
      break;

    case LED_WIFI_OK: {
      uint32_t phase = (now % 3000);
      if (phase < 80) setRGB(0,1,0);
      else setRGB(0,0,0);
    } break;

    case LED_WIFI_ERR:
      if (now - ledT0 > 400) { ledT0 = now; ledFlip = !ledFlip; }
      setRGB(ledFlip ? 1 : 0, 0, 0);
      break;
  }
}

// =====================
// BUTTON (hold actions)
// =====================
bool btnStable = false;
bool btnLastRaw = false;
uint32_t btnLastChange = 0;
uint32_t btnPressStart = 0;
bool longFired = false;
bool veryLongFired = false;

void updateButton() {
  bool rawPressed = (digitalRead(BTN_PIN) == LOW);

  uint32_t now = millis();
  if (rawPressed != btnLastRaw) {
    btnLastRaw = rawPressed;
    btnLastChange = now;
  }

  if (now - btnLastChange < 35) return;

  if (rawPressed != btnStable) {
    btnStable = rawPressed;
    if (btnStable) {
      btnPressStart = now;
      longFired = false;
      veryLongFired = false;
    }
  }

  if (!btnStable) return;

  uint32_t held = now - btnPressStart;

  if (!longFired && held >= 3000) {
    longFired = true;
    startBLE();
    Serial.println("Button: enter BLE setup");
  }

  if (!veryLongFired && held >= 10000) {
    veryLongFired = true;
    Serial.println("Button: FACTORY RESET (wipe WiFi creds)");
    clearCreds();
    delay(200);
    ESP.restart();
  }
}

// =====================
// Nano -> BLE TX bridge
// =====================
static String nanoLine;
static bool   inJson = false;

static void handleNanoJsonLine(const String& line) {
  if (line.length() == 0) return;

  Serial.print("Nano -> BLE TX: ");
  Serial.println(line);

  lastNanoJsonMs = millis();

  if (line.indexOf("\"v1\"") >= 0 && line.indexOf("\"circ\"") >= 0) {
    int v;
    if (parseIntField(line, "\"v1\":", v))    nanoState.v1 = v;
    if (parseIntField(line, "\"v2\":", v))    nanoState.v2 = v;
    if (parseIntField(line, "\"blow\":", v))  nanoState.blow = v;
    if (parseIntField(line, "\"circ\":", v))  nanoState.circ = v;

    if (parseIntField(line, "\"purge\":", v)) {
      nanoState.lastPurge = nanoState.purge;
      nanoState.purge = v;
    }

    if (parseIntField(line, "\"w\":", v)) nanoState.w = v;
    if (parseIntField(line, "\"e\":", v)) nanoState.e = v;

    nanoState.valid = true;
    nanoState.lastMs = millis();
  }

  if (parseIntField(line, "\"e\":", nanoState.e)) setIssue(ISSUE_NANO_ERR,  (nanoState.e == 1));
  if (parseIntField(line, "\"w\":", nanoState.w)) setIssue(ISSUE_NANO_WARN, (nanoState.w == 1));

  if (deviceConnected && pTxChar) {
    String out = line + "\n";
    pTxChar->setValue((uint8_t*)out.c_str(), out.length());
    pTxChar->notify();
  }

  // Report to TNT, throttled to the same cadence the MQTT publish used.
  if (WiFi.status() == WL_CONNECTED) {
    uint32_t now = millis();
    if (lastPostMs == 0 || (now - lastPostMs) >= POST_MIN_MS) {
      lastPostMs = now;
      postToTnt(line);
    }
  }
}

void pumpNanoToBle() {
  while (NanoLink.available()) {
    char ch = (char)NanoLink.read();

    lastNanoRxMs = millis();

    if (!inJson) {
      if (ch == '{') {
        inJson = true;
        nanoLine = "{";
      }
      continue;
    }

    if (ch == '\r') continue;

    if ((uint8_t)ch >= 32 && (uint8_t)ch <= 126) {
      nanoLine += ch;

      if (nanoLine.length() > 420) {
        nanoLine = "";
        inJson = false;
        continue;
      }

      if (ch == '}') {
        String line = nanoLine;
        line.trim();
        handleNanoJsonLine(line);
        nanoLine = "";
        inJson = false;
      }
    }

    if (ch == '\n') {
      nanoLine = "";
      inJson = false;
    }
  }
}

// =====================
// WIFI connect attempt
// =====================
void tryWifiAtBoot() {
  if (!haveCreds()) return;

  Serial.print("WiFi: trying saved SSID=");
  Serial.println(savedSsid);

  ledMode = LED_WIFI_CONNECT;
  WiFi.mode(WIFI_STA);
  WiFi.begin(savedSsid.c_str(), savedPass.c_str());

  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) {
    delay(100);
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi OK. IP=");
    Serial.println(WiFi.localIP());
    ledMode = LED_WIFI_OK;
    stopBLE();
  } else {
    Serial.println("WiFi FAIL at boot");
    ledMode = LED_WIFI_ERR;
    startBLE();
  }
}

// =====================
// SETUP / LOOP
// =====================
void setup() {
  Serial.begin(19200);
  delay(200);

  pinMode(BTN_PIN, INPUT_PULLUP);

  pinMode(LED_R, OUTPUT);
  pinMode(LED_G, OUTPUT);
  pinMode(LED_B, OUTPUT);
  setRGB(0,0,0);

  Serial.println("\nESP32-C3 starting...");

  NanoLink.begin(NANO_BAUD, SERIAL_8N1, ESP_RX_PIN, ESP_TX_PIN);
  Serial.print("NanoLink UART1 RX=");
  Serial.print(ESP_RX_PIN);
  Serial.print(" TX=");
  Serial.print(ESP_TX_PIN);
  Serial.print(" BAUD=");
  Serial.println(NANO_BAUD);

  loadCreds();

  if (haveCreds()) tryWifiAtBoot();
  else {
    Serial.println("No WiFi creds stored -> BLE setup mode");
    Serial.println("Or type this line here and press Enter:");
    Serial.println("  WIFI:SSID=YourNetwork;PASS=YourPassword");
    startBLE();
  }


  setRGB(1,1,1);
  delay(120);
  setRGB(0,0,0);
}

void loop() {
  updateButton();
  updateLed();
  pollSerialSetup();
  pumpNanoToBle();
  serviceBurst();

  delay(5);
}
