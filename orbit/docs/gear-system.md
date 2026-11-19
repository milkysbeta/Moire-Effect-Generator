# Moiré cartridge drive — mechanical basis

This document records the internal build logic for the first two-cartridge prototype. It is not buyer-facing copy.

## Why the first visual gears failed

The first browser model used rectangular decorative teeth and one pinion placed approximately near the cartridge. It did not maintain a pitch-circle centre distance and it had no second power path, so it could not physically produce opposite rotation or the displayed ratios.

The replacement uses standard 20° involute spur gears. For a gear with module `m` and tooth count `z`:

- Pitch diameter: `d = m × z`
- External mesh centre distance: `a = m × (z1 + z2) / 2`
- Speed relationship: `ω2 / ω1 = −z1 / z2`
- Every external mesh reverses direction.
- An idler changes direction and placement but cancels out of the overall magnitude ratio.

The involute and module definitions follow KHK's gear reference material. The actual CAD profiles are produced by the vendored BOSL2 involute gear library rather than by the old triangular or rectangular approximation.

## Selected first geometry

| Item | Value |
|---|---:|
| Pressure angle | 20° |
| Module | 0.8 mm |
| Cartridge ring | 126 teeth |
| Cartridge pinion | 18 teeth |
| Ring pitch diameter | 100.8 mm |
| Ring outside diameter | 102.4 mm |
| Ring/pinion centre distance | 57.6 mm |
| Visible Pattern Field | 92 mm |
| Gear backlash | 0.10 mm per gear, 0.20 mm total per mesh |
| Pattern bar baseline | 1.20 mm |
| Nominal nozzle | 0.4 mm |

Module 0.8 gives an ideal circular tooth thickness of roughly 1.26 mm at the pitch circle before backlash. That is close to three nominal 0.4 mm extrusion lines and is a much safer first FDM target than the finer teeth shown in the original overlay. The 18-tooth pinions avoid the severe undercut associated with very small standard 20° pinions.

## Two fixed shafts and a replaceable ratio pair

The crank/input shaft directly drives Cartridge A through an 18-tooth pinion. A second, compound shaft drives Cartridge B through another 18-tooth pinion. Behind the cartridges, one replaceable transfer pair connects those two shafts.

All transfer pairs contain a total of 72 teeth. Their shared module is 0.8, so the shaft distance is always:

`0.8 × 72 / 2 = 28.8 mm`

The chassis therefore keeps the same two shaft holes for every ratio:

| Cartridge relationship | Input transfer | Compound transfer | Shaft ratio |
|---|---:|---:|---:|
| `A +1 : B −1` | 36T | 36T | 1:1 |
| `A +1 : B −2` | 48T | 24T | 2:1 |
| `A +1 : B −3` | 54T | 18T | 3:1 |

The transfer mesh reverses the compound shaft. The compound shaft's cartridge pinion reverses motion again when it drives Cartridge B. Cartridge A has only its direct external mesh. The two cartridges consequently rotate in opposite directions, while the transfer pair sets the magnitude ratio.

At the default `1:2` setting, one full revolution of Cartridge A produces two reverse revolutions of Cartridge B. Both cartridges return to their marked Home phase after one A revolution.

The STL tooth profiles were sectioned in the gear plane and checked at 65 indexed positions across a tooth-mesh cycle. At the nominal shaft spacing, the correctly phased profiles did not overlap at any sampled position for either cartridge pinion or any of the three transfer pairs. Assembly indexing and backlash still need a physical fit test.

## Separate tooth band and rolling track

The bearings or printed rollers must not run over the gear teeth. Each cartridge therefore has two axial bands around its rim:

1. A smooth rolling track at the gear-root diameter.
2. A separate involute tooth band aligned with its pinion.

The front and rear cartridges are installed facing one another. Their thin Pattern Fields face inward across the 0.8 mm nominal air gap, while their gear bands face outward into separate pinion planes. The 1.20 mm track is paired with a 1.00 mm printed test roller. A measured 2 mm bearing would need a revised track and spacing.

## Print allowances and test order

These values are calibration starts, not guaranteed fits:

- `0.10 mm` circular backlash on each gear gives `0.20 mm` nominal total backlash in a mesh.
- The rear plate sits 0.40 mm behind the transfer pair. Adjustable roller mounts and axial retention still need detailing after the fit test. The CAD uses nominal fixed roller positions and placeholder shaft holes. The round clearance bores also need a positive shaft-to-gear connection, such as a keyed hub, before the crank can transmit torque.
- Shaft and bearing bores expose diametral compensation instead of assuming printed holes finish at their nominal diameter.
- Pattern bars begin at `1.20 mm`, corresponding to three nominal 0.4 mm extrusion lines.

Before printing a complete sculpture:

1. Print the 24T gear mesh coupon and two coupon gears.
2. Check that the pair turns freely without tooth skipping.
3. Adjust backlash and hole compensation.
4. Print one cartridge sector or complete cartridge plus one 18T pinion.
5. Check ring/pinion centre distance under light hand load.
6. Measure the available miniature bearings before finalizing roller posts.
7. Only then print the chassis and two complete cartridges.

Prusa's design guidance notes that moving FDM parts need explicit tolerance and suggests approximately 0.3 mm as an initial movable-part clearance, with printer-specific iteration still required. The BOSL2 gear library defines backlash as circular space at the pitch circle and warns that applying it to both gears combines the two values.

## Sources

- KHK, *About Gears*: https://khkgears.net/wp-content/uploads/2015/10/pa.pdf
- BOSL2 involute gear documentation: https://github.com/BelfrySCAD/BOSL2/wiki/gears.scad
- Prusa, *Modeling with 3D printing in mind*: https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135

