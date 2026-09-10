/* ===== CLASSIC NANO (ATmega328P) =====
   RAM-SAFE build: all strings moved to PROGMEM (PSTR/F) to stop SRAM overflow.

==============================
AVAILABLE COMMANDS (Nano)
==============================

PURGE            Run purge routine (safe exhaust + blower + door cycle)

RUN=ON           Start normal automatic run cycle (persist to EEPROM)
RUN=OFF          Stop automatic run cycle (persist to EEPROM)

AIRREFRESH       Force full air refresh now (does NOT change calibration)

MAINT=ON         Maintenance mode (use simulated sensor values)
MAINT=OFF        Exit maintenance mode (use real sensors)
SIMO2=xx.x        Set simulated O2 (example: SIMO2=10.0)
SIMT=xx.x         Set simulated temperature C (example: SIMT=25.0)
SIMRH=xx          Set simulated RH% (example: SIMRH=55)

CAL=AIR          Calibrate O2 to ambient air (20.9%) using 3-sample average
CAL=CHAMBER      Chamber tune (3-burst avg) learns N2 pulse effect (V2 ON with V1)
CAL=ABORT        Abort calibration routine

SP=xx.x          Set O2 target setpoint (example: SP=10.0)
DB=x.x           Set O2 deadband (example: DB=1.0)
LAG=ms           Set sensor lag wait time used in cal/run (example: LAG=15000)
TPULSE=ms        Set chamber-cal pulse time (example: TPULSE=900)
VENT=ms          Set vent time after pulse (example: VENT=800)
MIX=ms           Set mix/wait time after vent (example: MIX=15000)

V1=ON            Nitrogen valve ON
V1=OFF           Nitrogen valve OFF
V2=ON            Exhaust/bleed valve ON
V2=OFF           Exhaust/bleed valve OFF

SERVO=OPEN       Open blast door
SERVO=CLOSE      Close blast door

CIRC=0..255      Set circulation fan PWM
BLOW=0..255      Set blower PWM (purge may override)

STATUS           Print one immediate telemetry line now
HELP             Print this command list (minimal)

==============================
BOOT / DISPLAY
==============================
1) 120s warmup: LCD shows ONLY warmup + countdown.
2) After warmup: ALWAYS HOLD (even after power loss).
   - LCD alternates every 5s:
     A) Stats screen
     B) "SEE APP TO" / "FINALIZE SETUP"
3) RUN starts only when esp32 sends RUN=ON.
*/

#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <Arduino_HS300x.h>
#include "DFRobot_OxygenSensor.h"
#include <EEPROM.h>
#include <Servo.h>
#include <math.h>
#include <string.h>
#include <ctype.h>
#include <NeoSWSerial.h>
#include <avr/pgmspace.h>

// ---------- I2C addresses ----------
#define LCD_ADDR 0x27
#define O2_ADDR  ADDRESS_3   // 0x73 (DFRobot O2 sensor)
#define HS300X_ADDR 0x44     // temp/humidity (Arduino_HS300x)

// Printed at boot. Bumped when a change is one somebody might need to confirm
// is actually running -- the same problem the ESP32 side has.
#define NANO_FW_VERSION "3 - absent O2 reads null, not zero"

// ---------- Nano Pin Values ----------
const uint8_t PIN_VALVE1 = 6;    // N2 valve
const uint8_t PIN_VALVE2 = 7;    // bleed/atmosphere
const uint8_t PIN_BLOW   = 5;    // purge blower (PWM)
const uint8_t PIN_CIRC   = 12;   // circulation fan
const uint8_t PIN_SERVO  = 11;   // blast door

// ---------- Link to ESP32-C3 Super Mini ----------
const uint8_t ESP_RX_PIN = 8;    // Nano RX  (ESP TX -> Nano D8)
const uint8_t ESP_TX_PIN = 9;    // Nano TX  (Nano D9 -> level shift -> ESP RX)
NeoSWSerial CTRL(ESP_RX_PIN, ESP_TX_PIN);
const unsigned long CTRL_BAUD = 19200;

// ---------- Behavior ----------
const bool     ACTIVE_LOW     = false;
const unsigned long WARMUP_MS = 120000UL;   // LOCKED: 120s warmup
const float    AIRCAL_TARGET  = 20.9f;
const float    O2_EMA_ALPHA   = 0.25f;

// Servo motion
const uint8_t  SERVO_CLOSED      = 0;
const uint8_t  SERVO_OPEN        = 180;
const uint8_t  SERVO_STEP_DEG    = 2;
const uint8_t  SERVO_STEP_DELAY  = 10;

// Fan duties
const uint8_t  BLOW_DUTY      = 200;
const uint8_t  CIRC_KICK_DUTY = 255;
const uint16_t CIRC_KICK_MS   = 1500;
const uint8_t  CIRC_HOLD_DUTY = 160;

// ---------- PURGE COMMAND ROUTINE ----------
const uint16_t PURGE_DOOR_SETTLE_MS = 700;
const uint16_t PURGE_BLOW_MS        = 10000;

// ---------- AIR REFRESH ----------
const uint32_t AIR_REFRESH_PERIOD_MS = 907200000UL; // 1.5 weeks (10.5 days)
const uint16_t AIRREF_BLOW_MS        = 20000;        // keep modest to save gas/time

// ---------- Objects ----------
LiquidCrystal_I2C lcd(LCD_ADDR, 16, 2);
DFRobot_OxygenSensor oxygen;
Servo blastDoor;

// ---------- EEPROM for O2 one-point cal y = m*x + b ----------
float m_corr = 1.0f, b_corr = 0.0f;
const int EE_MAGIC1 = 0, EE_MAGIC2 = 1, EE_M = 2, EE_B = 6;
const uint8_t MAGIC1 = 0x42, MAGIC2 = 0x7A;

// EEPROM additions
const int EE_KQ   = 10; // int16_t: k_n2_q
const int EE_LAG  = 12; // uint16_t: lag10 (ms/10)
const int EE_TP   = 14; // uint16_t: tunePulseMs
const int EE_RUN  = 16; // uint8_t: runEnabled persisted (plus magic)
const int EE_RM1  = 17; // magic byte
const int EE_RM2  = 18; // magic byte
const uint8_t RM1 = 0xA5;
const uint8_t RM2 = 0x5A;

// ---------- Telemetry / UI ----------
float o2_disp = NAN;

/*
  Whether the O2 sensor answered at boot.

  This exists because DFRobot_OxygenSensor returns 0.0 - not NaN - when the
  sensor is absent. 0.0 is a perfectly valid-looking number, so it flows
  through applyCal(), through the EMA, into telemetry, and out to the app as a
  confident reading of zero percent oxygen.

  It was hidden until now. gErr is raised by
  `isnan(o2_disp) || isnan(tC) || isnan(rH)`, and on the first chamber the
  temp/humidity sensor was ALSO missing, so NaN from that raised the fault and
  the app showed Fault. Reconnecting the HS300x removed the thing that was
  accidentally covering for this: real temperature, real humidity, a numeric
  0.0 for oxygen, and gErr back to 0. The chamber would then have reported 0%
  oxygen as fact, and the app would have called it "below target" rather than
  "broken".

  For a box that exists to hold oxygen at 10%, a believable zero is the worst
  possible reading to trust.
*/
bool o2Present = false;
unsigned long lastUI = 0, lastTX = 0;
uint8_t gWarn = 0;
uint8_t gErr  = 0;

float lastTC = NAN;
float lastRH = NAN;

// ---------- RX quiet window ----------
static unsigned long quietUntil = 0;

// ---------- Outputs (tracked) ----------
bool    gV1 = false;
bool    gV2 = false;
uint8_t gBlow = 0;
uint8_t gCirc = 0;

void valve1(bool on);
void valve2(bool on);
void blowerDuty(uint8_t d);
void circulationDuty(uint8_t d);

// ---------- Control & state ----------
unsigned long manualUntil = 0;

// =====================
// MAINTENANCE MODE
// =====================
bool maintEnabled = false;
int16_t simO2_t = 100;   // 10.0%
int16_t simT_t  = 250;   // 25.0C
int16_t simRH_i = 55;    // 55%

// =====================
// RUN controller (day-to-day)
// =====================
bool runEnabled = true; // loaded from EEPROM after warmup (but boot now forces HOLD)

// SP/DB stored in tenths of percent
int16_t spO2_t  = 100;   // 10.0% (LOCKED target default)
int16_t dbO2_t  = 10;    // 1.0%

uint16_t runVentMs = 800;
uint16_t runMixMs  = 15000;

enum RunPhase { RUN_IDLE, RUN_PULSE, RUN_VENT, RUN_MIX };
RunPhase runPh = RUN_IDLE;
unsigned long runT0 = 0;
uint16_t runPulseMs = 900;

// k_n2_q: (%drop/ms)*10000, from chamber calibration
int16_t k_n2_q = 0;

// =====================
// CALIBRATION
// =====================
enum CalState {
  CAL_IDLE=0,
  CAL_AIR_WAIT, CAL_AIR_SAMP,
  CAL_CH_BASE_WAIT, CAL_CH_BASE_SAMP,
  CAL_CH_PULSE,
  CAL_CH_AFTER_WAIT, CAL_CH_AFTER_SAMP,
  CAL_FAIL
};
CalState calSt = CAL_IDLE;

unsigned long calT0 = 0;
uint8_t calN = 0;
float calSum = 0.0f;

float chBase = 0.0f;
int16_t drop_milli[3] = {0,0,0};
uint8_t burst = 0;

unsigned long calLagMs = 15000UL;
uint16_t tunePulseMs   = 900;

// =====================
// AIR REFRESH FSM
// =====================
enum AirRefPh { AR_IDLE, AR_DOOR_OPEN, AR_WAIT, AR_BLOW, AR_DONE };
AirRefPh arPh = AR_IDLE;
unsigned long arT0 = 0;
unsigned long nextAirRefreshDue = 0;

// =====================
// HOLD MODE 
/// =====================
bool holdMode = true;                 // after warmup: true until RUN=ON
unsigned long holdFlipT0 = 0;
bool holdShowPrompt = false;

// =====================
// Small utils
// =====================
static inline bool i2cPresent(uint8_t a) {
  Wire.beginTransmission(a);
  return (Wire.endTransmission() == 0);
}

/*
  Say what is actually on the bus, once, at boot.

  Worth the few bytes: the first chamber came up with O2 and temperature and
  humidity all dead, and there was no way to tell "the sensors are unplugged"
  from "the whole I2C bus is down" without moving hardware to another board.
  Three named addresses answer that in one line.

  HS300x especially. `HS300x.begin()` returns nothing and checks nothing, so a
  missing temp/humidity sensor was completely silent -- it showed up only as
  NaN in telemetry, several layers away, as `t:-1.0` and `rh:-1`.
*/
static void i2cReport() {
  Serial.print(F("I2C: lcd(0x27)="));
  Serial.print(i2cPresent(LCD_ADDR) ? F("yes") : F("NO"));
  Serial.print(F(" hs300x(0x44)="));
  Serial.print(i2cPresent(HS300X_ADDR) ? F("yes") : F("NO"));
  Serial.print(F(" o2(0x73)="));
  Serial.println(i2cPresent(0x73) ? F("yes") : F("NO"));

  // Anything else answering, so a sensor dialled to the wrong address shows up
  // rather than looking identical to one that is absent.
  Serial.print(F("I2C: others"));
  uint8_t others = 0;
  for (uint8_t a = 1; a < 127; a++) {
    if (a == LCD_ADDR || a == HS300X_ADDR || a == 0x73) continue;
    if (i2cPresent(a)) {
      Serial.print(F(" 0x"));
      if (a < 16) Serial.print(F("0"));
      Serial.print(a, HEX);
      others++;
    }
  }
  if (!others) Serial.print(F(" none"));
  Serial.println();
}

static inline void dDig(uint8_t pin, bool on) {
  digitalWrite(pin, (ACTIVE_LOW ? (on ? LOW : HIGH) : (on ? HIGH : LOW)));
}

static inline void dPWM(uint8_t pin, uint8_t d) {
  analogWrite(pin, ACTIVE_LOW ? (uint8_t)(255 - d) : d);
}

static void printP(Print &out, const char* p) {
  char c;
  while ((c = (char)pgm_read_byte(p++)) != 0) out.write(c);
}

static void lcdWriteFixed(uint8_t row, const char* s) {
  char buf[17];
  memset(buf, ' ', 16);
  buf[16] = '\0';
  size_t n = strlen(s);
  if (n > 16) n = 16;
  memcpy(buf, s, n);
  lcd.setCursor(0, row);
  lcd.print(buf);
}

static void lcdWriteFixed_P(uint8_t row, const char* p) {
  char buf[17];
  memset(buf, ' ', 16);
  buf[16] = '\0';
  for (uint8_t i=0; i<16; i++) {
    char c = (char)pgm_read_byte(p+i);
    if (!c) break;
    buf[i] = c;
  }
  lcd.setCursor(0, row);
  lcd.print(buf);
}

float readO2libInstant() { return oxygen.getOxygenData(1); }

static inline void trimInPlace(char* s) {
  uint8_t i = 0;
  while (s[i] && isspace((unsigned char)s[i])) i++;
  if (i) memmove(s, s + i, strlen(s + i) + 1);

  int n = (int)strlen(s);
  while (n > 0 && isspace((unsigned char)s[n - 1])) {
    s[n - 1] = '\0';
    n--;
  }
}

static inline void upperInPlace(char* s) {
  for (; *s; s++) *s = (char)toupper((unsigned char)*s);
}

static inline bool startsWith(const char* s, const char* pfx) {
  return strncmp(s, pfx, strlen(pfx)) == 0;
}

// case-insensitive strstr where token is stored in PROGMEM and is already UPPER
static bool hasTok_PCI(const char* s, const char* tokP) {
  for (; *s; s++) {
    const char* a = s;
    uint8_t j = 0;
    while (*a) {
      char tb = (char)pgm_read_byte(tokP + j);
      if (!tb) return true;
      char ca = (char)toupper((unsigned char)*a);
      if (ca != tb) break;
      a++; j++;
    }
    char tb0 = (char)pgm_read_byte(tokP + j);
    if (!tb0) return true;
  }
  return false;
}

// =====================
// EEPROM helpers
// =====================
static void saveRunFlag() {
  EEPROM.update(EE_RM1, RM1);
  EEPROM.update(EE_RM2, RM2);
  EEPROM.update(EE_RUN, runEnabled ? 1 : 0);
}

static void loadRunFlag() {
  if (EEPROM.read(EE_RM1) == RM1 && EEPROM.read(EE_RM2) == RM2) {
    runEnabled = (EEPROM.read(EE_RUN) == 1);
  } else {
    runEnabled = false; // default safer: OFF until user/app enables
  }
}

void eepromSave() {
  EEPROM.update(EE_MAGIC1, MAGIC1);
  EEPROM.update(EE_MAGIC2, MAGIC2);
  EEPROM.put(EE_M, m_corr);
  EEPROM.put(EE_B, b_corr);

  EEPROM.put(EE_KQ, k_n2_q);

  uint16_t lag10 = (uint16_t)(calLagMs / 10UL);
  EEPROM.put(EE_LAG, lag10);
  EEPROM.put(EE_TP, tunePulseMs);

  saveRunFlag();
}

bool eepromLoad() {
  loadRunFlag();
  if (EEPROM.read(EE_MAGIC1) == MAGIC1 && EEPROM.read(EE_MAGIC2) == MAGIC2) {
    EEPROM.get(EE_M, m_corr);
    EEPROM.get(EE_B, b_corr);

    EEPROM.get(EE_KQ, k_n2_q);

    uint16_t lag10 = 1500;
    EEPROM.get(EE_LAG, lag10);
    calLagMs = (unsigned long)lag10 * 10UL;
    if (calLagMs < 2000UL || calLagMs > 60000UL) calLagMs = 15000UL;

    EEPROM.get(EE_TP, tunePulseMs);
    if (tunePulseMs < 200 || tunePulseMs > 5000) tunePulseMs = 900;

    return true;
  }
  return false;
}

void eepromReset() {
  m_corr = 1.0f;
  b_corr = 0.0f;
  k_n2_q = 0;
  calLagMs = 15000UL;
  tunePulseMs = 900;
  runEnabled = false;
  eepromSave();
}

float applyCal(float x) {
  float y = m_corr * x + b_corr;
  if (y < 0) y = 0;
  if (y > 100) y = 100;
  return y;
}

// =====================
// Servo helpers
// =====================
bool servoAttached = false;

void servoAttachIfNeeded() {
  if (!servoAttached) {
    blastDoor.attach(PIN_SERVO);
    servoAttached = true;
  }
}
void servoDetachIfAttached() {
  if (servoAttached) {
    blastDoor.detach();
    servoAttached = false;
  }
}

void servoMoveTo(uint8_t targetDeg, uint8_t stepDeg = SERVO_STEP_DEG, uint8_t stepDelayMs = SERVO_STEP_DELAY) {
  targetDeg = constrain(targetDeg, 0, 180);
  servoAttachIfNeeded();

  int pos = blastDoor.read();
  if (pos < 0 || pos > 180) pos = targetDeg;
  int dir = (targetDeg > pos) ? 1 : -1;

  while (pos != (int)targetDeg) {
    int remaining = abs((int)targetDeg - pos);
    int delta = (stepDeg < remaining) ? stepDeg : remaining;
    pos += dir * delta;
    blastDoor.write(pos);
    delay(stepDelayMs);
  }
  delay(50);
  servoDetachIfAttached();
}

void forceDoorClosedOnBoot() {
  blastDoor.attach(PIN_SERVO);
  blastDoor.write(SERVO_CLOSED);
  delay(600);
  blastDoor.detach();
}

// =====================
// Outputs
// =====================
void valve1(bool on) { gV1 = on; dDig(PIN_VALVE1, on); }
void valve2(bool on) { gV2 = on; dDig(PIN_VALVE2, on); }
void blowerDuty(uint8_t d) { gBlow = d; dPWM(PIN_BLOW, d); }
void circulationDuty(uint8_t d) { gCirc = d; dPWM(PIN_CIRC, d); }

// =====================
// ACK helper
// =====================
void ackToESP_P(const char* p) {
  CTRL.print(F("{\"ack\":\""));
  printP(CTRL, p);
  CTRL.println(F("\"}"));

  Serial.print(F("{\"ack\":\""));
  printP(Serial, p);
  Serial.println(F("\"}"));

  quietUntil = millis() + 250;
}

// =====================
// PURGE
// =====================
enum PurgePhase { PURGE_IDLE, PURGE_DOOR_OPEN, PURGE_DOOR_WAIT, PURGE_BLOW_ON, PURGE_BLOW_HOLD, PURGE_BLOW_OFF, PURGE_DOOR_CLOSE, PURGE_DONE };
PurgePhase purgePh = PURGE_IDLE;
unsigned long purgeT0 = 0;

bool savedValid = false;
bool savedV1 = false;
bool savedV2 = false;
uint8_t savedCirc = 0;

/*
  PURGE_DONE is NOT excluded here, and that matters.

  It used to be. The consequence was that the moment PURGE_DOOR_CLOSE set the
  phase to PURGE_DONE, this returned false, so loop() stopped calling
  purgeTick() -- and the PURGE_DONE case, which is the one that restores valve
  2 and circulation, never ran at all. The chamber was left with valve 2 open
  and circulation at 0 after every purge, permanently, because
  enforceExhaustSafety() had forced it there and nothing put it back.

  For a chamber whose whole job is holding a sealed atmosphere, that is the
  bleed valve stuck open to the room after every purge.

  Confirmed on the first chamber before the fix: two PURGE=START acks, zero
  PURGE=DONE. The end of the routine was never reached.

  Ordering is safe. loop() calls enforceExhaustSafety(true) and THEN
  purgeTick(), so on the PURGE_DONE pass the safety forcing happens first and
  the restore overwrites it, then the phase goes idle and neither runs again.
*/
bool purgeActive() {
  return purgePh != PURGE_IDLE;
}

void enforceExhaustSafety(bool active) {
  if (!active) return;
  if (gCirc != 0) circulationDuty(0);
  if (gV1) valve1(false);
  if (!gV2) valve2(true);
}

void startPurge() {
  if (purgeActive()) return;

  // pause run & cal while purging
  runPh = RUN_IDLE;

  savedV1 = gV1;
  savedV2 = gV2;
  savedCirc = gCirc;
  savedValid = true;

  valve1(false);
  valve2(true);
  circulationDuty(0);
  blowerDuty(0);

  purgePh = PURGE_DOOR_OPEN;
  purgeT0 = millis();
  ackToESP_P(PSTR("PURGE=START"));
}

void purgeTick(unsigned long now) {
  switch (purgePh) {
    case PURGE_IDLE: return;

    case PURGE_DOOR_OPEN:
      enforceExhaustSafety(true);
      servoMoveTo(SERVO_OPEN);
      purgeT0 = now;
      purgePh = PURGE_DOOR_WAIT;
      break;

    case PURGE_DOOR_WAIT:
      enforceExhaustSafety(true);
      if (now - purgeT0 >= PURGE_DOOR_SETTLE_MS) purgePh = PURGE_BLOW_ON;
      break;

    case PURGE_BLOW_ON:
      enforceExhaustSafety(true);
      blowerDuty(BLOW_DUTY);
      purgeT0 = now;
      purgePh = PURGE_BLOW_HOLD;
      break;

    case PURGE_BLOW_HOLD:
      enforceExhaustSafety(true);
      if (now - purgeT0 >= PURGE_BLOW_MS) purgePh = PURGE_BLOW_OFF;
      break;

    case PURGE_BLOW_OFF:
      enforceExhaustSafety(true);
      blowerDuty(0);
      purgePh = PURGE_DOOR_CLOSE;
      break;

    case PURGE_DOOR_CLOSE:
      enforceExhaustSafety(true);
      servoMoveTo(SERVO_CLOSED);
      purgePh = PURGE_DONE;
      break;

    case PURGE_DONE:
      blowerDuty(0);

      if (savedValid) {
        valve1(savedV1);
        valve2(savedV2);
        uint8_t restoreCirc = (savedCirc == 0) ? CIRC_HOLD_DUTY : savedCirc;
        circulationDuty(restoreCirc);
        savedValid = false;
      } else {
        circulationDuty(CIRC_HOLD_DUTY);
      }

      ackToESP_P(PSTR("PURGE=DONE"));
      purgePh = PURGE_IDLE;
      break;
  }
}

// =====================
// AIR REFRESH
// =====================
static void startAirRefresh() {
  if (purgeActive()) { ackToESP_P(PSTR("AIRREF=BUSY_PURGE")); return; }
  if (calSt != CAL_IDLE) { ackToESP_P(PSTR("AIRREF=BUSY_CAL")); return; }
  arPh = AR_DOOR_OPEN;
  arT0 = millis();
  ackToESP_P(PSTR("AIRREF=START"));
}

static void airRefTick(unsigned long now) {
  if (arPh == AR_IDLE) return;

  switch (arPh) {
    case AR_DOOR_OPEN:
      valve1(false);
      valve2(true);
      circulationDuty(0);
      blowerDuty(0);
      servoMoveTo(SERVO_OPEN);
      arT0 = now;
      arPh = AR_WAIT;
      break;

    case AR_WAIT:
      if (now - arT0 >= 500) {
        blowerDuty(BLOW_DUTY);
        arT0 = now;
        arPh = AR_BLOW;
      }
      break;

    case AR_BLOW:
      if (now - arT0 >= AIRREF_BLOW_MS) {
        blowerDuty(0);
        servoMoveTo(SERVO_CLOSED);
        valve2(false);
        circulationDuty(CIRC_HOLD_DUTY);
        arPh = AR_DONE;
      }
      break;

    case AR_DONE:
      ackToESP_P(PSTR("AIRREF=DONE"));
      arPh = AR_IDLE;
      nextAirRefreshDue = millis() + AIR_REFRESH_PERIOD_MS;
      break;

    default:
      arPh = AR_IDLE;
      break;
  }
}

// =====================
// Telemetry send
// =====================
void sendTelemetry(float o2_send, float t_send, int rh_i) {
  char o2s[10];
  char ts[10];
  dtostrf(o2_send, 0, 1, o2s);
  dtostrf(t_send,  0, 1, ts);

  CTRL.print(F("{\"pod\":1,\"o2\":")); CTRL.print(o2s);
  CTRL.print(F(",\"t\":"));          CTRL.print(ts);
  CTRL.print(F(",\"rh\":"));         CTRL.print(rh_i);
  CTRL.print(F(",\"v1\":"));         CTRL.print(gV1 ? 1 : 0);
  CTRL.print(F(",\"v2\":"));         CTRL.print(gV2 ? 1 : 0);
  CTRL.print(F(",\"blow\":"));       CTRL.print((unsigned)gBlow);
  CTRL.print(F(",\"circ\":"));       CTRL.print((unsigned)gCirc);
  CTRL.print(F(",\"purge\":"));      CTRL.print(purgeActive() ? 1 : 0);
  CTRL.print(F(",\"maint\":"));      CTRL.print(maintEnabled ? 1 : 0);
  CTRL.print(F(",\"w\":"));          CTRL.print((unsigned)gWarn);
  CTRL.print(F(",\"e\":"));          CTRL.print((unsigned)gErr);
  CTRL.println(F("}"));

  Serial.print(F("{\"pod\":1,\"o2\":")); Serial.print(o2s);
  Serial.print(F(",\"t\":"));            Serial.print(ts);
  Serial.print(F(",\"rh\":"));           Serial.print(rh_i);
  Serial.print(F(",\"v1\":"));           Serial.print(gV1 ? 1 : 0);
  Serial.print(F(",\"v2\":"));           Serial.print(gV2 ? 1 : 0);
  Serial.print(F(",\"blow\":"));         Serial.print((unsigned)gBlow);
  Serial.print(F(",\"circ\":"));         Serial.print((unsigned)gCirc);
  Serial.print(F(",\"purge\":"));        Serial.print(purgeActive() ? 1 : 0);
  Serial.print(F(",\"maint\":"));        Serial.print(maintEnabled ? 1 : 0);
  Serial.print(F(",\"w\":"));            Serial.print((unsigned)gWarn);
  Serial.print(F(",\"e\":"));            Serial.print((unsigned)gErr);
  Serial.println(F("}"));
}

// =====================
// Calibration helpers
// =====================
static int16_t robustAvg3_i16(int16_t a, int16_t b, int16_t c) {
  int16_t x=a, y=b, z=c;
  if (x>y){int16_t t=x;x=y;y=t;}
  if (y>z){int16_t t=y;y=z;z=t;}
  if (x>y){int16_t t=x;x=y;y=t;}
  int16_t med = y;
  int16_t da = abs(a - med), db = abs(b - med), dc = abs(c - med);
  int16_t thr = (int16_t)((med * 35L) / 100L);
  if (da > thr && da >= db && da >= dc) return (b + c) / 2;
  if (db > thr && db >= da && db >= dc) return (a + c) / 2;
  if (dc > thr && dc >= da && dc >= db) return (a + b) / 2;
  return (a + b + c) / 3;
}

static void calAbort() {
  calSt = CAL_IDLE;
  blowerDuty(0);
  valve1(false);
  valve2(false);
  circulationDuty(CIRC_HOLD_DUTY);
  servoMoveTo(SERVO_CLOSED);
  ackToESP_P(PSTR("CAL=ABORT"));
}

static void calStartAir() {
  if (purgeActive()) { ackToESP_P(PSTR("CAL=BUSY_PURGE")); return; }
  if (calSt != CAL_IDLE) { ackToESP_P(PSTR("CAL=BUSY")); return; }

  runPh = RUN_IDLE;

  valve1(false);
  valve2(true);
  blowerDuty(0);
  circulationDuty(CIRC_HOLD_DUTY);
  servoMoveTo(SERVO_OPEN);

  calT0 = millis();
  calN = 0; calSum = 0;
  calSt = CAL_AIR_WAIT;
  ackToESP_P(PSTR("CAL=AIR_START"));
}

static void calStartChamber() {
  if (purgeActive()) { ackToESP_P(PSTR("CAL=BUSY_PURGE")); return; }
  if (calSt != CAL_IDLE) { ackToESP_P(PSTR("CAL=BUSY")); return; }

  runPh = RUN_IDLE;

  valve2(false);
  valve1(false);
  blowerDuty(0);
  circulationDuty(CIRC_HOLD_DUTY);
  servoMoveTo(SERVO_CLOSED);

  burst = 0;
  drop_milli[0] = drop_milli[1] = drop_milli[2] = 0;

  calT0 = millis();
  calN = 0; calSum = 0;
  calSt = CAL_CH_BASE_WAIT;
  ackToESP_P(PSTR("CAL=CH_START"));
}

static bool calSample3_raw(float* outAvg) {
  float r = readO2libInstant();
  if (isnan(r) || r < 0.1f || r > 30.0f) return false;
  calSum += r; calN++;
  if (calN >= 3) { *outAvg = calSum / 3.0f; return true; }
  return false;
}

static bool calSample3_cal(float* outAvg) {
  float v = applyCal(readO2libInstant());
  if (isnan(v) || v < 0.1f || v > 30.0f) return false;
  calSum += v; calN++;
  if (calN >= 3) { *outAvg = calSum / 3.0f; return true; }
  return false;
}

static void calTick(unsigned long now) {
  if (calSt == CAL_IDLE) return;

  switch (calSt) {
    case CAL_AIR_WAIT:
      if (now - calT0 >= calLagMs) {
        calN = 0; calSum = 0;
        calSt = CAL_AIR_SAMP;
      }
      break;

    case CAL_AIR_SAMP: {
      static unsigned long nextS = 0;
      if (now < nextS) break;
      nextS = now + 500;

      float avgRaw;
      if (!calSample3_raw(&avgRaw)) break;

      m_corr = AIRCAL_TARGET / avgRaw;
      b_corr = 0.0f;
      if (!(m_corr > 0.01f && m_corr < 10.0f)) { calSt = CAL_FAIL; break; }

      eepromSave();
      ackToESP_P(PSTR("CAL=AIR_OK"));

      valve2(false);
      servoMoveTo(SERVO_CLOSED);
      circulationDuty(CIRC_HOLD_DUTY);

      calSt = CAL_IDLE;
    } break;

    case CAL_CH_BASE_WAIT:
      if (now - calT0 >= calLagMs) {
        calN = 0; calSum = 0;
        calSt = CAL_CH_BASE_SAMP;
      }
      break;

    case CAL_CH_BASE_SAMP: {
      static unsigned long nextS = 0;
      if (now < nextS) break;
      nextS = now + 500;

      float avg;
      if (!calSample3_cal(&avg)) break;

      chBase = avg;

      // LOCKED: V2 ON whenever V1 ON (flow-through, no pressurization)
      valve2(true);
      valve1(true);
      calT0 = now;
      calSt = CAL_CH_PULSE;
    } break;

    case CAL_CH_PULSE:
      if (now - calT0 >= tunePulseMs) {
        valve1(false);
        valve2(false);
        calT0 = now;
        calSt = CAL_CH_AFTER_WAIT;
      }
      break;

    case CAL_CH_AFTER_WAIT:
      if (now - calT0 >= calLagMs) {
        calN = 0; calSum = 0;
        calSt = CAL_CH_AFTER_SAMP;
      }
      break;

    case CAL_CH_AFTER_SAMP: {
      static unsigned long nextS = 0;
      if (now < nextS) break;
      nextS = now + 500;

      float avg;
      if (!calSample3_cal(&avg)) break;

      float drop = chBase - avg;
      if (drop < 0.2f || drop > 10.0f) { calSt = CAL_FAIL; break; }

      drop_milli[burst] = (int16_t)lround(drop * 1000.0f);
      burst++;

      if (burst < 3) {
        calT0 = now;
        calSt = CAL_CH_BASE_WAIT;
        if (burst == 1) ackToESP_P(PSTR("CAL=B1_OK"));
        else if (burst == 2) ackToESP_P(PSTR("CAL=B2_OK"));
      } else {
        int16_t avgDrop_milli = robustAvg3_i16(drop_milli[0], drop_milli[1], drop_milli[2]);

        long kq = (long)avgDrop_milli * 10L / (long)tunePulseMs;
        if (kq <= 0 || kq > 500) { calSt = CAL_FAIL; break; }
        k_n2_q = (int16_t)kq;

        eepromSave();
        ackToESP_P(PSTR("CAL=CH_OK"));

        valve1(false);
        valve2(false);
        blowerDuty(0);
        circulationDuty(CIRC_HOLD_DUTY);
        servoMoveTo(SERVO_CLOSED);

        calSt = CAL_IDLE;
      }
    } break;

    case CAL_FAIL:
      calAbort();
      ackToESP_P(PSTR("CAL=FAIL"));
      break;

    default:
      calSt = CAL_IDLE;
      break;
  }
}

// =====================
// RUN controller tick
// =====================
static uint16_t computePulseMsFromErrorTenths(int16_t err_t) {
  if (err_t <= 0) return 0;

  if (k_n2_q <= 0) {
    long ms = 300L + (long)err_t * 25L;
    if (ms < 200) ms = 200;
    if (ms > 2000) ms = 2000;
    return (uint16_t)ms;
  }

  long ms = (long)err_t * 1000L / (long)k_n2_q;
  if (ms < 200) ms = 200;
  if (ms > 5000) ms = 5000;
  return (uint16_t)ms;
}

static void runTick(unsigned long now) {
  if (!runEnabled) return;
  if (purgeActive()) return;
  if (calSt != CAL_IDLE) return;
  if (arPh != AR_IDLE) return;
  if (now < manualUntil) return;

  if (gCirc == 0) circulationDuty(CIRC_HOLD_DUTY);

  if (isnan(o2_disp) || o2_disp < 0.1f || o2_disp > 25.0f) return;

  int16_t o2_t = (int16_t)lround(o2_disp * 10.0f);
  int16_t hi_t = spO2_t + dbO2_t;
  int16_t lo_t = spO2_t - dbO2_t;

  switch (runPh) {
    case RUN_IDLE:
      if (o2_t > hi_t) {
        int16_t err_t = o2_t - spO2_t;
        runPulseMs = computePulseMsFromErrorTenths(err_t);

        valve1(true);
        valve2(true);
        runT0 = now;
        runPh = RUN_PULSE;
        ackToESP_P(PSTR("RUN=PULSE"));
      } else if (o2_t < lo_t) {
        valve1(false);
        valve2(true);
        runT0 = now;
        runPh = RUN_VENT;
        ackToESP_P(PSTR("RUN=O2LOW_VENT"));
      }
      break;

    case RUN_PULSE:
      if (now - runT0 >= runPulseMs) {
        valve1(false);
        valve2(true);
        runT0 = now;
        runPh = RUN_VENT;
      }
      break;

    case RUN_VENT:
      if (now - runT0 >= runVentMs) {
        valve1(false);
        valve2(false);
        runT0 = now;
        runPh = RUN_MIX;
      }
      break;

    case RUN_MIX:
      if (now - runT0 >= runMixMs) {
        runPh = RUN_IDLE;
        ackToESP_P(PSTR("RUN=DONE"));
      }
      break;
  }
}

// =====================
// Command parsing
// =====================
static bool extractCmdTiny(const char* in, char* out, uint8_t outSz) {
  if (!in || !out || outSz < 8) return false;

  strncpy(out, in, outSz - 1);
  out[outSz - 1] = '\0';
  trimInPlace(out);

  uint8_t L = (uint8_t)strlen(out);
  if (L >= 3 && out[0] == '[' && out[L - 1] == ']') {
    out[L - 1] = '\0';
    memmove(out, out + 1, strlen(out + 1) + 1);
    trimInPlace(out);
  }

  upperInPlace(out);
  if (!out[0]) return false;

  // direct commands
  if (!strcmp(out, "PURGE")) return true;
  if (!strcmp(out, "AIRREFRESH")) return true;
  if (!strcmp(out, "STATUS")) return true;
  if (!strcmp(out, "HELP")) return true;

  if (!strcmp(out, "V1=ON") || !strcmp(out, "V1=OFF")) return true;
  if (!strcmp(out, "V2=ON") || !strcmp(out, "V2=OFF")) return true;
  if (!strcmp(out, "SERVO=OPEN") || !strcmp(out, "SERVO=CLOSE")) return true;

  if (!strcmp(out, "RUN=ON") || !strcmp(out, "RUN=OFF")) return true;
  if (!strcmp(out, "MAINT=ON") || !strcmp(out, "MAINT=OFF")) return true;

  if (!strcmp(out, "CAL=AIR") || !strcmp(out, "CAL=CHAMBER") || !strcmp(out, "CAL=ABORT")) return true;

  if (startsWith(out, "CIRC=")) return true;
  if (startsWith(out, "BLOW=")) return true;

  if (startsWith(out, "SP=")) return true;
  if (startsWith(out, "DB=")) return true;
  if (startsWith(out, "VENT=")) return true;
  if (startsWith(out, "MIX=")) return true;
  if (startsWith(out, "LAG=")) return true;
  if (startsWith(out, "TPULSE=")) return true;

  if (startsWith(out, "SIMO2=")) return true;
  if (startsWith(out, "SIMT=")) return true;
  if (startsWith(out, "SIMRH=")) return true;

  // embedded token detection (PROGMEM tokens)
  if (hasTok_PCI(in, PSTR("PURGE"))) { strncpy(out, "PURGE", outSz); return true; }
  if (hasTok_PCI(in, PSTR("AIRREFRESH"))) { strncpy(out, "AIRREFRESH", outSz); return true; }
  if (hasTok_PCI(in, PSTR("RUN=ON"))) { strncpy(out, "RUN=ON", outSz); return true; }
  if (hasTok_PCI(in, PSTR("RUN=OFF"))) { strncpy(out, "RUN=OFF", outSz); return true; }
  if (hasTok_PCI(in, PSTR("CAL=AIR"))) { strncpy(out, "CAL=AIR", outSz); return true; }
  if (hasTok_PCI(in, PSTR("CAL=CHAMBER"))) { strncpy(out, "CAL=CHAMBER", outSz); return true; }
  if (hasTok_PCI(in, PSTR("CAL=ABORT"))) { strncpy(out, "CAL=ABORT", outSz); return true; }
  if (hasTok_PCI(in, PSTR("MAINT=ON"))) { strncpy(out, "MAINT=ON", outSz); return true; }
  if (hasTok_PCI(in, PSTR("MAINT=OFF"))) { strncpy(out, "MAINT=OFF", outSz); return true; }

  // numeric extraction for CIRC/BLOW (plain or embedded)
  const char* p = in;
  while (*p) {
    if ((toupper((unsigned char)p[0])=='C') && (toupper((unsigned char)p[1])=='I') &&
        (toupper((unsigned char)p[2])=='R') && (toupper((unsigned char)p[3])=='C') && p[4]=='=') {
      p += 5;
      char num[4]; uint8_t n=0;
      while (*p && isdigit((unsigned char)*p) && n < 3) num[n++] = *p++;
      num[n] = '\0';
      if (n) { snprintf(out, outSz, "CIRC=%s", num); return true; }
    }
    if ((toupper((unsigned char)p[0])=='B') && (toupper((unsigned char)p[1])=='L') &&
        (toupper((unsigned char)p[2])=='O') && (toupper((unsigned char)p[3])=='W') && p[4]=='=') {
      p += 5;
      char num[4]; uint8_t n=0;
      while (*p && isdigit((unsigned char)*p) && n < 3) num[n++] = *p++;
      num[n] = '\0';
      if (n) { snprintf(out, outSz, "BLOW=%s", num); return true; }
    }
    p++;
  }

  return false;
}

// =====================
// Command handler
// =====================
static int parseMs(const char* s) {
  long v = atol(s);
  if (v < 0) v = 0;
  if (v > 60000) v = 60000;
  return (int)v;
}

static int16_t parseTenths(const char* s) {
  float f = (float)atof(s);
  long t = lround(f * 10.0f);
  if (t < 0) t = 0;
  if (t > 250) t = 250;
  return (int16_t)t;
}

void printHelpMinimal() {
  Serial.println(F("CMD: PURGE / RUN=ON|OFF / AIRREFRESH / CAL=AIR|CHAMBER|ABORT / MAINT=ON|OFF"));
}

void handleCmdC(char* cmd) {
  trimInPlace(cmd);
  upperInPlace(cmd);
  if (!cmd[0]) return;

  // keep your manual override window behavior
  bool isPurge = (!strcmp(cmd, "PURGE"));
  if (!isPurge) manualUntil = millis() + 5000;

  // HELP/STATUS
  if (!strcmp(cmd, "HELP")) { printHelpMinimal(); ackToESP_P(PSTR("HELP=OK")); return; }
  if (!strcmp(cmd, "STATUS")) {
    float o2_send = isnan(o2_disp) ? -1.0f : o2_disp;
    float t_send  = isnan(lastTC)  ? -1.0f : lastTC;
    int   rh_i    = isnan(lastRH)  ? -1    : (int)round(lastRH);
    sendTelemetry(o2_send, t_send, rh_i);
    ackToESP_P(PSTR("STATUS=OK"));
    return;
  }

  // PURGE / AIRREFRESH
  if (!strcmp(cmd, "PURGE")) { startPurge(); return; }
  if (!strcmp(cmd, "AIRREFRESH")) { startAirRefresh(); return; }

  // CAL
  if (!strcmp(cmd, "CAL=AIR"))     { calStartAir(); return; }
  if (!strcmp(cmd, "CAL=CHAMBER")) { calStartChamber(); return; }
  if (!strcmp(cmd, "CAL=ABORT"))   { calAbort(); return; }

  if (startsWith(cmd, "LAG=")) {
    int ms = parseMs(cmd + 4);
    if (ms < 2000) ms = 2000;
    if (ms > 60000) ms = 60000;
    calLagMs = (unsigned long)ms;
    eepromSave();
    ackToESP_P(PSTR("LAG=OK"));
    return;
  }

  if (startsWith(cmd, "TPULSE=")) {
    int ms = parseMs(cmd + 7);
    if (ms < 200) ms = 200;
    if (ms > 5000) ms = 5000;
    tunePulseMs = (uint16_t)ms;
    eepromSave();
    ackToESP_P(PSTR("TPULSE=OK"));
    return;
  }

  // RUN
  if (!strcmp(cmd, "RUN=ON"))  {
    runEnabled = true;
    saveRunFlag();
    holdMode = false;             
    holdShowPrompt = false;
    holdFlipT0 = millis();
    ackToESP_P(PSTR("RUN=ON"));
    return;
  }
  if (!strcmp(cmd, "RUN=OFF")) {
    runEnabled = false;
    saveRunFlag();
    runPh = RUN_IDLE;
    valve1(false);
    valve2(false);
    holdMode = true;               
    holdShowPrompt = false;
    holdFlipT0 = millis();
    ackToESP_P(PSTR("RUN=OFF"));
    return;
  }

  // MAINT
  if (!strcmp(cmd, "MAINT=ON"))  { maintEnabled = true; ackToESP_P(PSTR("MAINT=ON")); return; }
  if (!strcmp(cmd, "MAINT=OFF")) { maintEnabled = false; ackToESP_P(PSTR("MAINT=OFF")); return; }

  if (startsWith(cmd, "SIMO2=")) { simO2_t = parseTenths(cmd + 6); ackToESP_P(PSTR("SIMO2=OK")); return; }
  if (startsWith(cmd, "SIMT="))  { simT_t  = parseTenths(cmd + 5) * 10; ackToESP_P(PSTR("SIMT=OK")); return; } // crude
  if (startsWith(cmd, "SIMRH=")) {
    int v = atoi(cmd + 6);
    if (v < 0) v = 0;
    if (v > 100) v = 100;
    simRH_i = (int16_t)v;
    ackToESP_P(PSTR("SIMRH=OK"));
    return;
  }

  // SP/DB/Vent/Mix
  if (startsWith(cmd, "SP="))   { spO2_t = parseTenths(cmd + 3); ackToESP_P(PSTR("SP=OK")); return; }
  if (startsWith(cmd, "DB="))   { dbO2_t = parseTenths(cmd + 3); if (dbO2_t < 1) dbO2_t = 1; ackToESP_P(PSTR("DB=OK")); return; }
  if (startsWith(cmd, "VENT=")) { int ms = parseMs(cmd + 5); if (ms > 20000) ms = 20000; runVentMs = (uint16_t)ms; ackToESP_P(PSTR("VENT=OK")); return; }
  if (startsWith(cmd, "MIX="))  { int ms = parseMs(cmd + 4); if (ms < 500) ms = 500; if (ms > 60000) ms = 60000; runMixMs = (uint16_t)ms; ackToESP_P(PSTR("MIX=OK")); return; }

  // outputs
  if (startsWith(cmd, "CIRC=")) {
    int v = atoi(cmd + 5);
    if (v < 0) v = 0;
    if (v > 255) v = 255;
    circulationDuty((uint8_t)v);
    ackToESP_P(PSTR("CIRC=OK"));
    return;
  }
  if (startsWith(cmd, "BLOW=")) {
    int v = atoi(cmd + 5);
    if (v < 0) v = 0;
    if (v > 255) v = 255;
    blowerDuty((uint8_t)v);
    ackToESP_P(PSTR("BLOW=OK"));
    return;
  }

  if (!strcmp(cmd, "V1=ON"))  { valve1(true);  ackToESP_P(PSTR("V1=ON")); return; }
  if (!strcmp(cmd, "V1=OFF")) { valve1(false); ackToESP_P(PSTR("V1=OFF")); return; }
  if (!strcmp(cmd, "V2=ON"))  { valve2(true);  ackToESP_P(PSTR("V2=ON")); return; }
  if (!strcmp(cmd, "V2=OFF")) { valve2(false); ackToESP_P(PSTR("V2=OFF")); return; }
  if (!strcmp(cmd, "SERVO=OPEN"))  { servoMoveTo(SERVO_OPEN);   ackToESP_P(PSTR("SERVO=OPEN")); return; }
  if (!strcmp(cmd, "SERVO=CLOSE")) { servoMoveTo(SERVO_CLOSED); ackToESP_P(PSTR("SERVO=CLOSE")); return; }

  ackToESP_P(PSTR("UNKNOWN"));
}

// =====================
// RX (small buffers)
// =====================
void pollPcSerialForTestCmds() {
  static char pcBuf[60];
  static uint8_t pcLen = 0;
  static unsigned long lastByteMs = 0;

  while (Serial.available()) {
    char c = (char)Serial.read();
    lastByteMs = millis();

    if (c == 8 || c == 127) { if (pcLen > 0) pcLen--; continue; }

    if (c == '\r' || c == '\n' || c == ';') {
      if (pcLen > 0) {
        pcBuf[pcLen] = '\0';
        char cmd[24];
        if (extractCmdTiny(pcBuf, cmd, sizeof(cmd))) handleCmdC(cmd);
        pcLen = 0;
      }
      continue;
    }

    if (c < 32 || c > 126) continue;
    if (pcLen < sizeof(pcBuf) - 1) pcBuf[pcLen++] = c;
    else pcLen = 0;
  }

  if (pcLen > 0 && (millis() - lastByteMs) > 120) {
    pcBuf[pcLen] = '\0';
    char cmd[24];
    if (extractCmdTiny(pcBuf, cmd, sizeof(cmd))) handleCmdC(cmd);
    pcLen = 0;
  }
}

void pollCtrl() {
  static char ctrlBuf[60];
  static uint8_t ctrlLen = 0;
  static unsigned long lastByteMs = 0;

  while (CTRL.available()) {
    char c = (char)CTRL.read();
    lastByteMs = millis();

    if (c == '\r' || c == '\n' || c == ';') {
      if (ctrlLen > 0) {
        ctrlBuf[ctrlLen] = '\0';
        char cmd[24];
        if (extractCmdTiny(ctrlBuf, cmd, sizeof(cmd))) handleCmdC(cmd);
        ctrlLen = 0;
      }
      continue;
    }

    if (c < 32 || c > 126) continue;
    if (ctrlLen < sizeof(ctrlBuf) - 1) ctrlBuf[ctrlLen++] = c;
    else ctrlLen = 0;
  }

  if (ctrlLen > 0 && (millis() - lastByteMs) > 120) {
    ctrlBuf[ctrlLen] = '\0';
    char cmd[24];
    if (extractCmdTiny(ctrlBuf, cmd, sizeof(cmd))) handleCmdC(cmd);
    ctrlLen = 0;
  }
}

// =====================
// Setup
// =====================
void setup() {
  Wire.begin();
  Wire.setClock(100000);

  Serial.begin(115200);
  CTRL.begin(CTRL_BAUD);

  delay(200);
  Serial.println(F("NANO:BOOT"));
  Serial.print(F("NANO:FW="));
  Serial.println(F(NANO_FW_VERSION));
  Serial.print(F("NANO:BUILT="));
  Serial.print(F(__DATE__));
  Serial.print(' ');
  Serial.println(F(__TIME__));

  i2cReport();

  lcd.init();
  lcd.backlight();
  lcd.clear();
  lcdWriteFixed_P(0, PSTR("SENSORS WARMING"));
  lcdWriteFixed_P(1, PSTR("READY IN: ----s"));

  bool o2_ok = oxygen.begin(O2_ADDR);
  o2Present = o2_ok;
  if (!o2_ok) {
    lcdWriteFixed_P(1, PSTR("O2 NOT FOUND   "));
    Serial.println(F("O2:NOT_FOUND"));
    delay(800);
  }

  HS300x.begin();
  // begin() reports nothing, so ask the bus directly. Without this a missing
  // temp/humidity sensor is silent all the way to NaN in telemetry.
  if (!i2cPresent(HS300X_ADDR)) Serial.println(F("HS300X:NOT_FOUND"));

  pinMode(PIN_VALVE1, OUTPUT);
  pinMode(PIN_VALVE2, OUTPUT);
  pinMode(PIN_BLOW, OUTPUT);
  pinMode(PIN_CIRC, OUTPUT);

  valve1(false);
  valve2(false);
  blowerDuty(0);

  forceDoorClosedOnBoot();

  circulationDuty(CIRC_KICK_DUTY);
  delay(CIRC_KICK_MS);
  circulationDuty(CIRC_HOLD_DUTY);

  // Warmup: LCD shows ONLY warmup + countdown
  unsigned long w0 = millis();
  while (millis() - w0 < WARMUP_MS) {
    unsigned long now = millis();
    unsigned long left = (WARMUP_MS - (now - w0)) / 1000UL;

    char l1[17];
    snprintf_P(l1, sizeof(l1), PSTR("READY IN: %3lus"), left);
    lcdWriteFixed_P(0, PSTR("SENSORS WARMING"));
    lcdWriteFixed(1, l1);

    pollPcSerialForTestCmds();
    pollCtrl();

    if (purgeActive()) { enforceExhaustSafety(true); purgeTick(now); }
    calTick(now);
    airRefTick(now);

    delay(20);
  }

  if (!eepromLoad()) eepromReset();

  
  runEnabled = false;
  saveRunFlag();

  holdMode = true;
  holdFlipT0 = millis();
  holdShowPrompt = false;

  nextAirRefreshDue = millis() + AIR_REFRESH_PERIOD_MS;

  Serial.println(F("NANO:READY"));
  ackToESP_P(PSTR("NANO:READY"));
}

// =====================
// Loop
// =====================
void loop() {
  unsigned long now = millis();

  pollPcSerialForTestCmds();
  pollCtrl();

  if (purgeActive()) { enforceExhaustSafety(true); purgeTick(now); }

  calTick(now);
  airRefTick(now);

  // sensor reads
  float o2_raw = readO2libInstant();
  float o2 = applyCal(o2_raw);

  /*
    Refuse a reading the sensor did not give us.

    Two ways it can be absent: missing at boot (o2Present), or unplugged since
    (the library keeps returning 0.0 either way). The 0.1 floor catches the
    second, and matches what calSample3_raw already rejects as implausible --
    this chamber targets 10% and a real reading never approaches zero, so an
    exact 0.0 is the library's way of saying "nothing answered".

    NAN is the honest answer, and it is the one the rest of this file already
    understands: it raises gErr below, and sendTelemetry converts it to -1.0,
    which the app reads as "no figure" rather than as a measurement.
  */
  if (!o2Present || o2_raw < 0.1f) o2 = NAN;
  float tC = HS300x.readTemperature();
  float rH = HS300x.readHumidity();

  if (maintEnabled) {
    o2 = ((float)simO2_t) / 10.0f;
    tC = ((float)simT_t) / 10.0f;
    rH = (float)simRH_i;
  }

  if (isnan(o2_disp)) o2_disp = o2;
  else o2_disp += O2_EMA_ALPHA * (o2 - o2_disp);

  lastTC = tC;
  lastRH = rH;

  float n2 = 100.0f - o2_disp;

  gErr = 0;
  gWarn = 0;
  if (isnan(o2_disp) || isnan(tC) || isnan(rH)) gErr = 1;
  if (purgeActive() || (calSt != CAL_IDLE) || (arPh != AR_IDLE) || maintEnabled) gWarn = 1;

  if (n2 < 0) n2 = 0;
  if (n2 > 100) n2 = 100;

  // UI:
  // - HOLD: alternate every 5s between stats and "SEE APP..." prompt
  if (now - lastUI >= 250) {
    lastUI = now;

    if (holdMode && !runEnabled) {
      if (now - holdFlipT0 >= 5000UL) {
        holdFlipT0 = now;
        holdShowPrompt = !holdShowPrompt;
      }

      if (holdShowPrompt) {
        lcdWriteFixed_P(0, PSTR("SEE APP TO      "));
        lcdWriteFixed_P(1, PSTR("FINALIZE SETUP  "));
      } else {
        // normal stats screen (unchanged)
        char line0[17];
        char o2b[7], n2b[7];
        dtostrf(o2_disp, 4, 1, o2b);
        dtostrf(n2,     4, 1, n2b);
        snprintf_P(line0, sizeof(line0), PSTR("O2 %s%% N2 %s"), o2b, n2b);
        lcdWriteFixed(0, line0);

        if (!isnan(tC) && !isnan(rH)) {
          char line1[17];
          char tb[7], hb[7];
          dtostrf(tC, 4, 1, tb);
          dtostrf(rH, 4, 1, hb);
          snprintf_P(line1, sizeof(line1), PSTR("T %sC RH %s%%"), tb, hb);
          lcdWriteFixed(1, line1);
        } else {
          lcdWriteFixed_P(1, PSTR("T --.-C RH --.-%"));
        }
      }
    } else {
      // ACTIVE (unchanged stats-only UI)
      char line0[17];
      char o2b[7], n2b[7];
      dtostrf(o2_disp, 4, 1, o2b);
      dtostrf(n2,     4, 1, n2b);
      snprintf_P(line0, sizeof(line0), PSTR("O2 %s%% N2 %s"), o2b, n2b);
      lcdWriteFixed(0, line0);

      if (!isnan(tC) && !isnan(rH)) {
        char line1[17];
        char tb[7], hb[7];
        dtostrf(tC, 4, 1, tb);
        dtostrf(rH, 4, 1, hb);
        snprintf_P(line1, sizeof(line1), PSTR("T %sC RH %s%%"), tb, hb);
        lcdWriteFixed(1, line1);
      } else {
        lcdWriteFixed_P(1, PSTR("T --.-C RH --.-%"));
      }
    }
  }

  // Quiet window (still listen)
  if (millis() < quietUntil) return;

  // periodic air refresh schedule (only if RUN is enabled)
  if (runEnabled && arPh == AR_IDLE) {
    if ((int32_t)(millis() - nextAirRefreshDue) >= 0) startAirRefresh();
  }

  // RUN
  runTick(now);

  // TELEMETRY
  if (now - lastTX >= 5000) {
    lastTX = now;

    // A sensor connected after boot should start working without a power
    // cycle. Retried here rather than in the main loop so it costs one bus
    // transaction every five seconds, not one per iteration.
    if (!o2Present) o2Present = oxygen.begin(O2_ADDR);

    float o2_send = isnan(o2_disp) ? -1.0f : o2_disp;
    float t_send  = isnan(tC)      ? -1.0f : tC;
    int   rh_i    = isnan(rH)      ? -1    : (int)round(rH);
    sendTelemetry(o2_send, t_send, rh_i);
    quietUntil = millis() + 250;
  }
}
