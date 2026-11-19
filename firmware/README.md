# Moiré drive firmware

Runs the coaxial drive from the generator's Lightbox → *Coaxial* panel, for 2 or 3 discs.
**Motor A → front disc = Layer 1, motor B → Layer 2, motor C → Layer 3** (3-disc builds). Speeds are disc rpm, positive = clockwise seen from the front. Set 2 or 3 discs under *Setup* on the control page.
Each motor drives its disc through a 15:45 gear pair, so the motor turns 3× faster and the opposite way. The firmware handles that for you.

## Pick a build

| PlatformIO env  | Board                | Motor driver                          | Notes |
|-----------------|----------------------|---------------------------------------|-------|
| `esp32s3`       | **ESP32-S3 SuperMini** | the ULN2003 boards from the 28BYJ-48 kits | **Recommended. 2 or 3 discs**, matches the 3D model's layout and wiring, panel button on GPIO 13, status LED. |
| `esp32c3`       | ESP32-C3 SuperMini   | ULN2003                               | 2 discs only (the C3 has pins for two boards). |
| `esp32c3-tmc`   | ESP32-C3 SuperMini   | TMC2209 (up to 3)                     | Near-silent. Motors need the bipolar mod (below). |
| `esp32dev`      | classic ESP32 dev board | ULN2003                            | 3 discs, different pins. |

Flash from this folder (first time over the S3's USB-C, through its window in the case):

```
pio run -e esp32s3 -t upload
pio device monitor
```

After that you never need to open the case: *Setup → Update firmware* on the web page takes `.pio/build/esp32s3/firmware.bin`, or `pio run -e esp32s3 -t upload --upload-port moire.local` sends it over Wi-Fi (asks for the admin password if one is set).

## First run

1. Power up. With no Wi-Fi saved it opens an access point **Moire-Setup**, password **moiredisc**.
2. Join it and open **http://192.168.4.1**. Under *Setup*, enter your Wi-Fi and save. It restarts.
3. Open **http://moire.local** (or the IP printed on the serial monitor).
4. In the generator, Lightbox → *Coaxial* → *Drive controller* → **Send speeds** pushes the Layer 1/2 speeds to the drive.

The page has Steady, Breathe (both speeds swell and fade, the rear a quarter-cycle behind) and Drift (slow random wander, like the spring-driven originals) modes, plus a ramp so speed changes never jerk the discs.
If a disc turns the wrong way, tick *Reverse motor* for it under *Setup*.

### Edit lock

Under *Setup → Set password* you can lock the drive. Anyone on your Wi-Fi can still watch the speeds, but every change (speeds, modes, Wi-Fi, the password itself) needs the password. The page remembers it in that browser; the generator has a *Controller password* box next to *Send speeds*. Five wrong tries lock edits for 30 seconds. Forgot it? Hold the board's **BOOT** button for 5 seconds while it's running, and the lock is cleared.

## Wiring plan: ESP32-S3 SuperMini + ULN2003 (the 3D model's layout)

Your kit's parts: **28BYJ-48 5 V** motors (5-wire, unipolar, red = common +5 V) and their **ULN2003 boards** (35 × 32 mm, white 5-pin motor socket, IN1-IN4 + power pins, 4 LEDs). Each motor lead plugs straight into its own board's socket; it's keyed, so it only goes in one way.

```
                         ESP32-S3 SuperMini (USB-C at the case wall, lower right)
                      side 1: TX RX 1 2 3 4 5 6 7     side 2: 5V GND 3V3 13 12 11 10 9 8

Motor A board (upper right, beside motor A → front disc L1)   IN1 IN2 IN3 IN4 ← GPIO 1  2  3  4
Motor B board (upper left,  beside motor B → L2)              IN1 IN2 IN3 IN4 ← GPIO 5  6  7  8
Motor C board (lower left,  beside motor C → L3, 3 discs)     IN1 IN2 IN3 IN4 ← GPIO 9 10 11 12
Panel button (bottom of the case)                             one leg → GPIO 13, other → GND

USB-C breakout (lower right, socket at the case wall)
  5 V ──┬── S3 SuperMini 5V pin
        ├── + on every ULN2003 board (keep its ON/OFF jumper fitted)
        └── 470 µF + (− to GND), soldered right on the breakout's pads
  GND ──┴── S3 GND and − on every board: all grounds joined
```

* **Wire colours in the 3D view:** IN1 orange, IN2 yellow, IN3 green, IN4 blue; 5 V red, GND black. 10 cm female-female jumpers reach every board.
* **Channels:** the base has a 3 mm deep ring round the centre boss and a spoke out to each board and to the ESP32. Lay the jumpers in the ESP32's spoke, round the ring, and out along their board's spoke. The gears sit 12 mm above, so nothing can catch.
* **Motor leads:** each board's socket faces its own motor, so only a few cm of lead is needed. Fold the spare in a flat zig-zag under the board, or cut the lead short and re-crimp a JST-XH 2.5 mm plug.
* **Boards:** drop each ULN2003 into its four corner cradles (no holes to line up); a dab of hot glue on two corners holds it. The S3 and the USB-C breakout drop into their trays.
* **Check your S3's silkscreen.** SuperMini clones vary, so wire by the GPIO numbers printed on your board. If yours differ, change `ULN_M1/M2/M3` and `PIN_BTN` in `platformio.ini`. GPIO 3 is a strapping pin, but only for JTAG selection, which is off by default, so it's fine as a motor output.
* **Status LED** (the S3's RGB on GPIO 48): green running, amber paused, blue in setup hotspot.

### Power: what to use

You don't need the buck converter. Everything runs on **5 V**:

* **Supply:** any **USB-C phone charger, 5 V 2 A or more.** Peak draw is about 0.9 A with three motors turning (each 28BYJ-48 coil is ~50 Ω, up to two coils on at once, ~0.2 A per motor) plus the ESP32 (~0.2 A with Wi-Fi). The firmware switches coils off when a disc stops.
* **Socket:** one of your **USB-C breakout boards**. Use the **6-pin type with two 5.1 kΩ resistors on CC1/CC2**. A bare 2-pin breakout gets no power from a USB-C to USB-C cable (it does work with a USB-A to USB-C cable).
* **Don't** power the motors from the S3's own USB-C or its 3V3 pin.
* **Flashing while powered:** if your S3 SuperMini has a diode between its USB-C and its 5V pin (most do; a small SOD-123 part next to the socket), you can leave the power plugged in. If unsure, unplug the power before plugging in the computer, or skip the cable and update over Wi-Fi.
* The buck converter is only needed if you move to a 12 V supply (TMC2209 option below).

### Compact pod layout (2 discs, the default case)

The ULN2003 boards sit **above and below** the spindle, between the two motors. The ESP32-S3 sits upper right and the USB-C breakout lower right, both with their sockets in windows in the pod wall. The wiring is the same as above. The panel button goes through the pod wall just right of the ESP32.

### Backlight (Pod + backlight case)

```
16× WS2812B modules glued round the flange at the pod's foot, facing forward, chained DOUT → DIN
  DIN of the first (the one by the ESP32) ← 330 Ω ← GPIO 44 (the S3's RX pin)
  5V / GND of the ring                    ← the USB-C breakout (through its window), not the S3
```

* **The app:** a Backlight card appears, with Glow / Breathe / Follow (a soft bright patch that turns with the front disc), brightness, colour and richness. The default is warm amber at 35 %.
* **Panel button:** double-tap turns the light on or off.
* **Power:** brightness is squared and capped at 60 %, so 16 LEDs never draw more than about 0.6 A, and a 2 A charger covers motors + light.
* **Data voltage:** the 3.3 V data line drives a WS2812B at 5 V fine when the first LED is this close. If yours flicker, power the first module through a 1N4148 diode (its 5 V drops to ~4.4 V) or add a 74AHCT125 level shifter.
* **LED count:** set `RING_LEDS` in `platformio.ini` if you use more or fewer LEDs. Set `PIN_RING` if you wire another pin.

## Wiring: ULN2003 on a C3 SuperMini (2 discs)

Motor A IN1-4 ← GPIO 0, 1, 3, 4 · Motor B IN1-4 ← GPIO 5, 6, 7, 10 · button ← GPIO 20. Power exactly as above. GPIO 2, 8 and 9 are the C3's boot pins, so they're left free.

## Wiring: TMC2209 (quiet option)

```
ESP32-C3 SuperMini                     TMC2209 front (addr 0)     TMC2209 rear (addr 1)
  GPIO6 (RX) ───────────────┬────────── PDN_UART ─────────────────── PDN_UART
  GPIO7 (TX) ──[ 1 kΩ ]─────┘
  GPIO10     ────────────────────────── EN ──────────────────────── EN
  3V3        ────────────────────────── VIO ─────────────────────── VIO, MS1
  GND        ────────────────────────── GND, MS1, MS2, STEP, DIR ── GND, MS2, STEP, DIR

12 V 1 A supply ── VM on both drivers (100 µF across VM/GND)
                └─ mini buck converter 12 V → 5 V ── SuperMini 5V pin
```

* MS1/MS2 set each driver's UART address: motor A both low = 0; motor B MS1 high = 1; motor C (3 discs) MS2 high = 2. All PDN_UART pins join the same wire.
* The drivers generate their own steps over UART (VACTUAL), so STEP/DIR just go to GND.
* Motor current is set from the web page (default 150 mA). A 5 V 28BYJ-48 run bipolar at 12 V is limited by its own coil resistance to about 120 mA, which keeps it cool.

### 28BYJ-48 bipolar mod (TMC2209 only)

1. Pop the blue plastic cover off the motor's wire end.
2. Cut the middle PCB trace that joins the red wire to both coils (a sharp knife; check with a meter that red no longer connects to anything).
3. Coils are now **orange + pink** (coil A) and **yellow + blue** (coil B). The red wire is unused.
4. Connect coil A to A1/A2 and coil B to B1/B2 on the TMC2209. If the motor only twitches, swap the two wires of one coil.

## Shopping list

**You have:** 28BYJ-48 5 V + ULN2003 kits, a bearing kit, an ESP32-S3 SuperMini, a USB-C phone charger, USB-C breakouts, a buck converter (not needed).

**Check:** the bearing kit must include **4× 608 (8 × 22 × 7 mm)** (plus **2× 6806, 30 × 42 × 7** for 3 discs). If it doesn't, buy a 10-pack of 608ZZ.

**Electronics**
* 470 µF 10 V electrolytic capacitor
* ~20 female-female Dupont jumpers, 10 cm (4 red + 4 black for power if you can)
* 7 mm momentary panel push button (for the enclosure)
* Quiet upgrade, optional: TMC2209 modules, 12 V 1 A supply, your buck converter set to 5 V, 1 kΩ resistor, 100 µF 25 V capacitor

**Hardware** (matches the drive parts' build sheet)
* M8 threaded rod: one 1 m length, cut 110 mm
* 2× M8 thin nut (DIN 439, 5 mm or less), 1× M8 dome (acorn) nut, 4× M8 flat washer
* 4× M3 heat-set inserts (about 4.5 mm OD, 4–5 mm long) + 4× M3×6 button-head screws (rear disc)
* 4× M3×8 screws (motor ears)
* 2 wall screws (head under 9 mm) for the keyholes

**Consumables and tools**
* PETG or PLA+ for the gears, hub and base; black + white/clear filament for the discs
* Blue thread locker for the nuts; a little dry PTFE lube or grease for the gears
* Soldering iron (sets the heat-set inserts), two 13 mm spanners, hacksaw and file for the rod, multimeter (for the bipolar mod)
