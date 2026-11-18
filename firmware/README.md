# Moiré drive firmware

Runs the coaxial drive from the generator's Lightbox → *Coaxial, two motors* panel.
**Front disc = Layer 1, rear disc = Layer 2.** Speeds are disc rpm, positive = clockwise seen from the front.
Each motor drives its disc through a 15:45 gear pair, so the motor turns 3× faster and the opposite way. The firmware handles that for you.

## Pick a build

| PlatformIO env  | Board                | Motor driver                          | Notes |
|-----------------|----------------------|---------------------------------------|-------|
| `esp32c3`       | ESP32-C3 SuperMini   | the ULN2003 boards that come with the 28BYJ-48 | Start here. No motor mods. A little buzzy. Discs up to 4 rpm. |
| `esp32c3-tmc`   | ESP32-C3 SuperMini   | 2× TMC2209                            | Near-silent. Motors need the bipolar mod (below). Discs up to 6 rpm. |
| `esp32dev`      | classic ESP32 dev board | ULN2003                            | Same as `esp32c3`, different pins. |

Flash from this folder:

```
pio run -e esp32c3 -t upload
pio device monitor
```

## First run

1. Power up. With no Wi-Fi saved it opens an access point **Moire-Setup**, password **moiredisc**.
2. Join it and open **http://192.168.4.1**. Under *Setup*, enter your Wi-Fi and save. It restarts.
3. Open **http://moire.local** (or the IP printed on the serial monitor).
4. In the generator, Lightbox → *Coaxial* → *Drive controller* → **Send speeds** pushes the Layer 1/2 speeds to the drive.

The page has Steady, Breathe (both speeds swell and fade, the rear a quarter-cycle behind) and Drift (slow random wander, like the spring-driven originals) modes, plus a ramp so speed changes never jerk the discs.
If a disc turns the wrong way, tick *Reverse motor* for it under *Setup*.

## Wiring: ULN2003 (default)

```
ESP32-C3 SuperMini            ULN2003 board (front disc, motor A = low seat)
  GPIO0  ───────────────────  IN1
  GPIO1  ───────────────────  IN2
  GPIO3  ───────────────────  IN3
  GPIO4  ───────────────────  IN4

                              ULN2003 board (rear disc, motor B = high seat)
  GPIO5  ───────────────────  IN1
  GPIO6  ───────────────────  IN2
  GPIO7  ───────────────────  IN3
  GPIO10 ───────────────────  IN4

5 V 2 A supply  +  ──┬── 5V pin on the SuperMini
                     ├── + on both ULN2003 boards
                     └── 470 µF capacitor + (− to GND)
                GND ─┴── GND on the SuperMini and both boards (all grounds joined)
```

* GPIO2, 8 and 9 are the C3's boot pins, so they're left free on purpose.
* Each motor draws about 0.25 A while turning; the firmware switches the coils off when a disc stops.
* **Unplug the 5 V supply before plugging in USB to flash.** Most SuperMini boards have no diode between USB and the 5V pin.

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

* MS1/MS2 set each driver's UART address: front both low = 0, rear MS1 high = 1.
* The drivers generate their own steps over UART (VACTUAL), so STEP/DIR just go to GND.
* Motor current is set from the web page (default 150 mA). A 5 V 28BYJ-48 run bipolar at 12 V is limited by its own coil resistance to about 120 mA, which keeps it cool.

### 28BYJ-48 bipolar mod (TMC2209 only)

1. Pop the blue plastic cover off the motor's wire end.
2. Cut the middle PCB trace that joins the red wire to both coils (a sharp knife; check with a meter that red no longer connects to anything).
3. Coils are now **orange + pink** (coil A) and **yellow + blue** (coil B). The red wire is unused.
4. Connect coil A to A1/A2 and coil B to B1/B2 on the TMC2209. If the motor only twitches, swap the two wires of one coil.

## Shopping list

**You have:** 28BYJ-48 + ULN2003 kits, a bearing kit, an ESP32-C3 SuperMini.

**Check:** the bearing kit must include **4× 608 (8 × 22 × 7 mm)**. If it doesn't, buy a 10-pack of 608ZZ or 608-2RS (skateboard bearings).

**Electronics**
* 5 V 2 A power supply (DC barrel + panel jack, or a USB-C PD trigger board set to 5 V)
* 470 µF 10 V electrolytic capacitor
* ~20 female–female Dupont jumpers, plus a small perfboard or screw-terminal board to tidy the power
* Quiet upgrade, optional: 2× TMC2209 modules (BigTreeTech v1.3 or FYSETC), 12 V 1 A supply, mini 12→5 V buck converter (MP1584), 1 kΩ resistor, 100 µF 25 V capacitor

**Hardware** (matches the drive parts' build sheet)
* M8 threaded rod: one 1 m length, cut 110 mm
* 6× M8 nut (one spare), 4× M8 flat washer, 1× M8 penny/fender washer (24 mm OD)
* 4× M3 heat-set inserts (about 4.5 mm OD, 4–5 mm long) + 4× M3×6 button-head screws (rear disc)
* 4× M3×8 screws (motor ears)
* Wall plugs + 4 screws if it hangs on a wall (the base has 4.6 mm holes)

**Consumables and tools**
* PETG or PLA+ for the gears, hub and base; black + white/clear filament for the discs
* Blue thread locker for the nuts; a little dry PTFE lube or grease for the gears
* Soldering iron (sets the heat-set inserts), two 13 mm spanners, hacksaw and file for the rod, multimeter (for the bipolar mod)
