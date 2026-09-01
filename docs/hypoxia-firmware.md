# Hypoxia chamber — setting one up, start to finish

Everything needed to take a built chamber and have it reporting into TNT
Operations, with the app able to command it.

The **Nano is not touched**. It keeps printing its one JSON line and keeps
accepting the same text commands. Only the ESP32 bridge changes: it used to
publish to the student's ThingsBoard account over MQTT, and now posts straight
to TNT.

**You do not need a ThingsBoard account.** Nothing in this depends on one.

---

## Before you start

| | |
|---|---|
| Time | About 20 minutes the first time, 5 minutes per chamber after |
| You need | The chamber wired and powered, a USB-C cable, a computer, the Wi-Fi it will use |
| Software | Arduino IDE 2.x — free, [arduino.cc/en/software](https://www.arduino.cc/en/software) |
| Nothing to configure in Netlify | The endpoint uses credentials the app already has |

The sketch is in this repo at **`firmware/hypoxia-esp32c3/hypoxia-esp32c3.ino`**
— already patched. You only fill in one line.

---

## Step 1 — Create the chamber and get its key

1. Open TNT Operations, sign in as an **admin**
2. **Incubation → Hypoxia**
3. Press **Add chamber**
4. Give it a name the crew would use (`Stack A · Pod 1`) and where it lives (`Shed 2`)
5. Press **Add chamber**

The next screen shows the **device key**. It looks like:

```
kQ7mZ2xR9vB4nL6tW1pY8cF3jH5sD0aG
```

**Copy it now.** Only a hash of it is stored, so it cannot be shown again — the
database genuinely cannot reveal it, and neither can a backup. If you lose it,
use **Issue new key** on the chamber and flash again.

> That is deliberate. The sketch you were sent had its ThingsBoard token written
> into the source as plain text, so anyone who saw the file could command the
> chamber. A key you can look up later is a key that leaks eventually.

## Step 2 — Install the Arduino IDE and ESP32 support

One-time setup. Skip if you already flash ESP32 boards.

### 2a. Install the IDE

Download **Arduino IDE 2.x** from
[arduino.cc/en/software](https://www.arduino.cc/en/software) and take the
**Windows MSI installer**.

**It must be 2.x, and it must not be the Microsoft Store build.** Both halves
matter, and both were found the hard way:

- Espressif dropped Arduino IDE 1.8.x support at esp32 core 3.0, and the current
  core is 3.x. On 1.8.x the pair half-works, which is worse than not working: it
  compiles, then fails once a board setting changes, with an error that reads
  like a fault in the sketch rather than in the IDE.
  ```
  riscv32-esp-elf-g++: fatal error: cannot specify '-o' with '-c' ... with multiple files
  Multiple libraries were found for "WiFi.h"
  ```
  The second line is the tell. The Store build ships its own `WiFi.h`, which
  shadows the ESP32 one, from a path containing a space — unquoted, that path
  becomes two arguments and the compiler sees multiple files.

- The Store build also runs in an AppContainer with a virtualised filesystem.
  `arduino-builder` is a separate process and cannot see the temp folder the IDE
  just created for it:
  ```
  CreateFile C:\Users\...\AppData\Local\Temp\arduino_build_636659:
  The system cannot find the file specified.
  ```
  Nothing in the sketch can fix that one.

If 1.8 is already installed you can leave it, or uninstall it; they do not
conflict. Note that 2.x keeps its own data directory
(`AppData\Local\Arduino15`) rather than 1.8's, so it downloads the ESP32
toolchain again even if 1.8 already had it. Budget for step 2c a second time.

Run it and accept the defaults. It is a few hundred MB.

Open it once. First launch takes a minute while it sets itself up, and Windows
may ask to allow it through the firewall — allow it, that is the IDE talking to
its own background process.

**Move the sketchbook off OneDrive.** `File → Preferences → Sketchbook
location`, set to something like `C:\Users\you\Arduino`. OneDrive syncing build
artifacts mid-compile causes intermittent failures that point nowhere in
particular.

### 2b. Add Espressif's board index

The ESP32 is not an Arduino board, so the IDE does not know it exists yet.

1. **File → Preferences** (or `Ctrl+,`)
2. Find **Additional boards manager URLs**, near the bottom of the dialog
3. Paste this in:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
   If the box already has something in it, click the small icon at its right to
   open a multi-line editor and put this on its own line — do not replace what
   is there.
4. **OK**

### 2c. Install the board package

1. **Tools → Board → Boards Manager** (or the second icon down the left
   sidebar — the little board/chip one)
2. Type **esp32** in the search box
3. Find **esp32 by Espressif Systems**. Take care: several results have similar
   names, and the one you want says *Espressif Systems*
4. **Install**

This is the slow part. It pulls a whole compiler toolchain — a few hundred MB
down, a couple of GB on disk, typically **5–15 minutes**. The progress bar sits
still for long stretches; that is normal, leave it running.

### 2d. Check it worked

**Tools → Board** should now have an **esp32** submenu with a long list of
boards in it. If it does, this step is done.

If the submenu is missing, the URL in 2b almost always has a stray space or a
line break in it. Re-open Preferences, clear the box, paste it again.

### 2e. Compile the sketch before you touch the hardware

Worth doing now, because it finds problems at a desk instead of at a chamber
with a USB cable in your hand.

1. **File → Open**, and open this file:

   ```
   C:\Users\tyler\tnt-operations\firmware\hypoxia-esp32c3\hypoxia-esp32c3.ino
   ```

2. **Tools → Board → esp32 → ESP32C3 Dev Module**
3. **Tools → Partition Scheme → Huge APP (3MB No OTA/1MB SPIFFS)** — see below,
   it does not fit on the default
4. Press **Verify** — the tick, not the arrow. It compiles without a board
   attached

The first compile is slow (a minute or two) because it builds the whole core.
You want it to finish with **"Sketch uses … bytes"**.

A red error instead means the sketch needs a fix — copy the last few lines from
the black output panel and send them to me. It compiles against a toolchain I
cannot run here, so this is the first genuine check that it builds.

> The `DEVICE_KEY` placeholder does not stop it compiling — it is only a string.
> Verify now, paste the key in later.

#### "Sketch too big"

On the DEFAULT partition scheme this does not fit:

```
Sketch uses 1386969 bytes (105%) of program storage space. Maximum is 1310720
text section exceeds available space in board
```

That is expected, and it is the price of HTTPS. The original sketch published
MQTT on port 1883 in the clear, so it never linked a TLS stack; this one pins a
certificate, which pulls in mbedTLS — a few hundred KB. The alternative was
letting anything on the farm Wi-Fi feed the chamber its commands.

**Tools → Partition Scheme → Huge APP (3MB No OTA/1MB SPIFFS)** and Verify
again. It drops to about 44%.

Nothing is lost by that choice here. The scheme only divides up the 4 MB of
flash, this sketch uses no SPIFFS at all (Wi-Fi credentials live in NVS, a
separate partition), and "No OTA" costs nothing when the board is flashed over
USB anyway. **Minimal SPIFFS (1.9MB APP with OTA/190KB SPIFFS)** also fits if
you want to keep an OTA slot for later.

## Step 3 — Put the key in `secrets.h`

**The key does not go in the `.ino`.** This repo is public, and a key committed
to it is readable by anyone forever — deleting it in a later commit does not
help, because the old commit is still there. The key goes in a gitignored file
beside the sketch.

1. In `firmware/hypoxia-esp32c3/`, copy **`secrets.example.h`** to
   **`secrets.h`** (same folder, exact name)
2. Open `secrets.h` and replace `PASTE_THE_KEY_HERE` with the key from step 1,
   **keeping the quotes**:
   ```cpp
   static const char* DEVICE_KEY = "kQ7mZ2xR9vB4nL6tW1pY8cF3jH5sD0aG";
   ```

That is the only edit. Arduino compiles any `.h` in the sketch folder, so
nothing else changes. If `secrets.h` is missing the compile stops with a message
saying so, rather than building a board that cannot authenticate.

> This happened to us: a real key was pasted into the `.ino` and committed to
> the public repo — the same mistake as the ThingsBoard token the original
> firmware shipped with. `firmwareSecrets.test.ts` now fails the build on any
> credential in a firmware source file, in either `=` or `#define` form.

## Step 4 — Flash the board

> **Disconnect the Nano's TX wire from ESP32 GPIO20 before uploading.**
> Reconnect it afterwards. This is not optional and it is not about being
> careful — see below.

1. Plug the ESP32-C3 into USB
2. **Tools → Board → esp32 → ESP32C3 Dev Module**
3. **Tools → Partition Scheme → Huge APP (3MB No OTA/1MB SPIFFS)** — the
   default is too small for this sketch; see 2e
4. **Tools → Port** — pick the one that appeared when you plugged it in
   (Windows: `COM3`/`COM4`; Mac: `/dev/cu.usbmodem…`). These boards use a CH340
   serial chip, which Windows 11 drives without a driver hunt; the IDE reports it
   as `1A86_7523` if you want to confirm you have the right port
5. **Tools → USB CDC On Boot → Disabled** — see below; on a CH340 board
   `Enabled` sends the serial output to a USB port that is not wired to anything
6. **Tools → Upload Speed → 115200** if 921600 fails. CH340 clones are not
   reliable at the higher rate
7. Press **Upload** (the arrow)

If upload fails with a port or sync error: hold **BOOT**, tap **RESET**, release
**BOOT**, and upload again.

### Why GPIO20 has to come off first

`ESP_RX_PIN` is **GPIO20**, which on the ESP32-C3 is also **UART0 RX** — the pin
the CH340 uses to send the bootloader handshake. The Nano's TX is wired to that
same pin, so with the Nano powered, two chips drive one line and esptool's bytes
never arrive intact:

```
Connecting......................................
A fatal error occurred: Failed to connect to ESP32-C3: No serial data received.
```

That message names the port and the chip, so it reads like a cable, a driver or
a dead board. It is none of those — nothing is wrong, the line is just busy.

The wiring is the student build's and is left alone deliberately: moving the
Nano link to a free pin (GPIO3, say) would mean re-terminating every chamber
already built, to save one jumper pull per flash. If a chamber is ever rewired,
change `ESP_RX_PIN` to match and this step goes away.

### USB CDC On Boot, and which way round it goes

It depends on the board, and getting it wrong costs an evening at step 6 rather
than failing loudly:

- **CH340 or CP2102 on the board** (what we have) → **Disabled**. `Serial` then
  goes out through that chip to the COM port. Enabled routes it to the C3's
  native USB pins, which are not connected to the USB socket, so the Serial
  Monitor stays blank while the board runs perfectly.
- **Native USB, no serial chip** → **Enabled**, for the opposite reason.

Check with the IDE's own verbose output: `1A86_7523` is a CH340, so Disabled.

## Step 5 — Put it on Wi-Fi

The board advertises over Bluetooth as **`TNT_POD`** on first boot, or when you
hold its button. Connect with any BLE terminal app (nRF Connect, LightBlue) and
send:

```
SSID:YourNetworkName
PASS:YourPassword
```

The onboard LED goes **green** when Wi-Fi is up. Credentials are saved, so it
reconnects by itself after a power cut.

## Step 6 — Check it

**Tools → Serial Monitor**, set to **19200 baud** — the sketch calls
`Serial.begin(19200)`, matching the Nano. Not 115200; at the wrong rate the
output is punctuation.

| What you see | What it means |
|---|---|
| Nothing about TNT | Working. It only prints on failure. |
| `TNT: key rejected` | The key is wrong or was not saved. Issue a new one, redo step 3. |
| `TNT: chamber is marked inactive` | The chamber is switched off in the app. |
| `TNT POST failed: -1` | Wi-Fi or TLS. Check the board is on the network. |
| Garbled characters | Wrong baud. Set the monitor to 19200. |
| No output at all | USB CDC On Boot is Enabled on a CH340 board (step 4.5), or the Nano's TX is off GPIO20 — it may still be unplugged from flashing. |

Then in the app, **Incubation → Hypoxia**:

- Within about a minute the card stops saying **Silent** and shows oxygen,
  temperature and humidity
- Press **Purge now**. The chamber should act within ~15 seconds, and the next
  reading comes back marked **Purging**

That second test is the one worth doing — it proves both directions, not just
that telemetry arrives.

---

## How it works, in one paragraph

Every ~15 seconds the ESP32 posts the Nano's telemetry line to TNT over HTTPS
with its key in a header. TNT stores the reading and answers with the next
queued command, if there is one — so the same round trip both reports and
collects. There is no broker, no persistent connection, and nothing listening on
the chamber's side, which is why it works behind any ordinary farm Wi-Fi.

## What you will see in the app

- **Live card** — oxygen against target, temperature, humidity, valve and blower
  state, and whether it is holding, above, below, purging, in maintenance or
  faulting
- **History** — oxygen over time with purges shaded, so the sawtooth reads as
  the mechanism working rather than as repeated failure
- **Controls** — purge, start/stop regulating, set target. Valves, blast door and
  calibration sit behind a confirm and are admin-only
- **Alerts** — out of band, controller fault, and gone quiet. All three can push
  to your phone (Notifications → Settings)

## Adding a second chamber

Repeat steps 1, 3, 4, 5. **Each chamber needs its own key** — do not reuse one.
Two boards sharing a key would write into the same chamber's history and both
collect the same commands, so a purge meant for one would fire in both.

## If you ever suspect a key has leaked

**Issue new key** on the chamber, then reflash that board with the new one. The
old key stops working immediately, so the chamber goes silent until it is
flashed — which is the correct behaviour for a credential you no longer trust.
