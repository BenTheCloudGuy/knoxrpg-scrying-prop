# Hardware Info — KnoxRPG Scrying Prop

Hardware, screen, and prop-physical reference extracted from the `knoxrpg-netheril-prop` build.

## Compute

- **Raspberry Pi** (arm64, tested on Pi 4 / Pi 5)
- **OS:** Raspberry Pi OS (Linux, arm64)
- **Runtime:** Node.js 18+

## Peripherals

| Device | Interface | Path / Pin | Baud / Config |
|---|---|---|---|
| RDM6300 RFID reader (125 kHz) | UART serial | `/dev/serial0` | 9600 baud |
| Kano Motion Sensor | USB CDC ACM | `/dev/ttyACM0` (override via `MOTION_PORT`) | 115200 baud |
| WS281x RGB LED ring (6 LEDs) | PWM / GPIO | GPIO 18 (Pin 12, PWM0) | DMA 10, `grb`, brightness 255 |
| Touchscreen display | HDMI + USB touch | — | 1920×1080, Firefox kiosk |
| RFID tags (125 kHz) | — | embedded in prop crystals | — |

### RFID Reader (RDM6300)

- 125 kHz reader on hardware UART `/dev/serial0` @ 9600 baud.
- Reads the hex ID of crystal-embedded tags; the ID maps to a crystal entry in `config/config.yaml`.

### Motion Sensor (Kano)

- USB CDC ACM device on `/dev/ttyACM0` @ 115200 baud (overridable with the `MOTION_PORT` env var).
- Hand detection thresholds (env-overridable):
  - `HAND_ON_THRESHOLD` = 230 (proximity value that counts as "hand on")
  - `HAND_OFF_TIMEOUT_MS` = 1000 ms (delay before "hand off" registers)

### RGB LED Ring (WS281x)

- 6 LEDs driven on GPIO 18 (physical Pin 12, PWM0).
- Config: DMA channel 10, strip type `grb`, brightness 255. Blanked on start/shutdown.
- Crystal colour → LED hex:

| Colour | School | LED Hex |
|---|---|---|
| White  | Abjuration    | `0xFFFFFF` |
| Blue   | Conjuration   | `0x0000FF` |
| Purple | Divination    | `0x8000FF` |
| Pink   | Enchantment   | `0xFF0080` |
| Red    | Evocation     | `0xFF0000` |
| Yellow | Illusion      | `0xFFFF00` |
| Orange | Illusion      | `0xFF8000` |
| Green  | Transmutation | `0x00FF00` |
| Black  | Necromancy    | `0x200020` (near-off) |
| Unknown | —            | `0x333333` |

## Screen

- **Resolution:** 1920×1080 (16:9), rendered design space `designWidth: 1920`, `designHeight: 1080`.
- **Display mode:** Firefox in kiosk mode, full-screen.

### Prop Aperture (foam cutout over screen)

The physical prop has a foam overlay with an irregular aperture; only the area inside the
aperture polygon is visible to players. Measured from an overhead grid photo of the foam
aperture (measured 2026-09-20).

**Safe inset margins (px, from each screen edge):**

| Edge | Inset |
|---|---|
| Top    | 150 |
| Right  | 195 |
| Bottom | 165 |
| Left   | 165 |

**Visible aperture polygon** (clockwise, in 1920×1080 design-space px):

```
(160, 150)   (700, 110)   (960, 100)   (1180, 135)
(1720, 150)  (1725, 520)  (1740, 650)  (1760, 840)
(1580, 915)  (1100, 985)  (960, 990)   (560, 945)
(300, 965)   (160, 720)   (130, 560)   (165, 300)
```

- **Calibration on the prop:** `Alt+G` to grab/tap the aperture edge, `S` to lock; `Alt+C` to
  nudge edges. Aperture definition lives in `config/screen-aperture.json` (and a per-app copy at
  `apps/dungeon-runner/config/screen-aperture.json`).

## Network / Services

| Service | Port | URL |
|---|---|---|
| Launcher (player kiosk) | 3000 | `http://localhost:3000` |
| Dungeon Runner — player | 4000 | `http://localhost:4000` |
| Dungeon Runner — GM console | 4001 | `http://localhost:4001` |

- Network info surfaced by the launcher: Wi-Fi SSID (`iwgetid -r`) and IPv4 address (prefers `wl*` interfaces).

## Simulation Mode (no hardware)

- `SIM_MODE=true` disables LEDs, serial, and GPIO so the app runs on a dev machine.
- Simulator control panel lets you trigger crystal insert/remove and hand on/off events without physical hardware.
