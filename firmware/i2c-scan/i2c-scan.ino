/*
  I2C scanner - a diagnostic, not part of a chamber.

  WHY THIS EXISTS
  ---------------
  The first chamber came up with O2:NOT_FOUND and dead temperature and humidity
  readings. That is a DETECTION failure: the Nano asked, and nothing answered.
  The question underneath it is simply "is the sensor alive, and at what
  address" - and there was no way to ask.

  The obvious tool is an I2C scanner on the Nano. That would erase the chamber
  firmware, and TNT2_NANO.ino is not in this repo, so there would be no way to
  put it back. NEVER reflash a Nano until that file is somewhere safe.

  The ESP32 can be reflashed freely, because its source IS here. So the sensor
  moves to the ESP32 for a minute instead, and the Nano is never touched.

  WIRING (temporary - four wires, then put them back)
  ---------------------------------------------------
    Sensor VCC  ->  ESP32 3V3      <- NOT 5V, see below
    Sensor GND  ->  ESP32 GND
    Sensor SDA  ->  ESP32 GPIO5
    Sensor SCL  ->  ESP32 GPIO6

  POWER IT FROM 3V3, NOT 5V. I2C is open-drain: the pull-up resistors on the
  sensor board pull the bus up to whatever VCC is. At 5V that puts 5V on two
  ESP32-C3 pins that are rated for 3.3V. The sensor is specified 3.3-5.5V, so
  3V3 runs it perfectly well and keeps the bus at a safe level.

  GPIO5 and GPIO6 are free on the Super Mini - the chamber sketch uses 0/1/3
  (LED), 4 (button), 7 and 20 (Nano UART). GPIO9 is deliberately avoided: it is
  the BOOT strap pin, and a device holding it low at reset would send the board
  into its bootloader instead of running this.

  READING THE RESULT
  ------------------
    0x73 (or 0x70-0x72) found  ->  the sensor is alive. The fault is between it
                                   and the Nano: wiring, or the Nano expecting a
                                   different address.
    nothing found              ->  the sensor is not answering on a bus we know
                                   is good. Suspect the sensor or its connector.
    something at another
    address                    ->  note it. That is likely the temp/humidity
                                   sensor, and tells us it shares this bus.

  AFTERWARDS: reflash hypoxia-esp32c3.ino and put the four wires back.
*/

#include <Arduino.h>
#include <Wire.h>

#define SCAN_SDA 5
#define SCAN_SCL 6

// The addresses a SEN0322 can be dialled to, so the output can name it rather
// than leaving somebody to look it up mid-diagnosis.
static bool isOxygenAddress(uint8_t a) { return a >= 0x70 && a <= 0x73; }

void setup() {
  Serial.begin(115200);
  delay(1500);           // USB CDC needs a moment before the first print lands
  Serial.println();
  Serial.println("I2C scanner - SDA=GPIO5 SCL=GPIO6, bus at 3.3V");
  Serial.println("SEN0322 oxygen sensor answers at 0x70-0x73 (default 0x73)");
  Serial.println();

  Wire.begin(SCAN_SDA, SCAN_SCL);
}

void loop() {
  uint8_t found = 0;

  Serial.println("scanning...");
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    uint8_t err = Wire.endTransmission();

    if (err == 0) {
      found++;
      Serial.print("  FOUND 0x");
      if (addr < 16) Serial.print("0");
      Serial.print(addr, HEX);
      if (isOxygenAddress(addr)) Serial.print("   <- SEN0322 oxygen sensor");
      Serial.println();
    }
  }

  if (found == 0) {
    Serial.println("  nothing on the bus.");
    Serial.println("  Check: 3V3 and GND present at the sensor, SDA/SCL not swapped,");
    Serial.println("  connector seated. A dead bus and a dead sensor look identical here,");
    Serial.println("  so try a known-good device on the same two pins before condemning it.");
  } else {
    Serial.print("  ");
    Serial.print(found);
    Serial.println(" device(s).");
  }

  Serial.println();
  delay(5000);
}
