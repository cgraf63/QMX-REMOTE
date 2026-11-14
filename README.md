# QMX-REMOTE

Small Wi-Fi box (Raspberry Pi Zero 2 W) for remote control of the QRP Labs **QMX** and **QMX+** in the browser. Built on [YAESU-REMOTE](https://github.com/cgraf63/YAESU-REMOTE) (server, Wi-Fi, OLED, audio, installer); the QMX driver and page come from [SHACK-SERVER](https://github.com/cgraf63/SHACK-SERVER).

The page looks like the radio: the real 2 × 16 LCD (CAT `LC;`, drawn as a dot matrix), tuning knob, S / power / SWR meters, modes, bands, VFO A / B, split, RIT, AF / RF gain, keyer speed, CW text with macros, the QMX's CW decoder, a carrier key for tuning (max. 15 s) and RX audio.

| | QMX | QMX+ | QDX |
|---|---|---|---|
| Bands | 80–20 m, 60–15 m or 20–10 m version | 160–6 m | – |
| Detection | `ID020` + `VN…QMX` / `OMQC` | same, QMX+ from the bands | `ID020` + `VN…QDX` |
| Status | works (driver from SHACK-SERVER) | works | connects, not tested |

## CAT on the QMX

Checked against the QMX CAT manual (firmware 1_04_003): the QMX speaks a subset of the **Kenwood TS-480** commands plus own commands, over a USB virtual COM port (`ttyACM`, the baud rate does not matter). Commands end with `;`, never with CR / LF.

- `ID;` always answers `ID020;` (TS-480) – on the QMX, QMX+ and QDX alike, so it cannot tell them apart. The box asks `VN;` (firmware, e.g. `VN1_04_003QMX;`) and `OM;` (`OMQC;` on the QMX) as well. Without either answer, a QRP Labs name in `/dev/serial/by-id` decides; any other TS-480 style radio is reported as “not a QMX”.
- QMX and QMX+ run the same firmware. Which bands the radio has comes from `BN;` (band number in the radio's band list) together with the current band: “Auto” on the page. Firmware without `BN` (1_02_xxx): choose the version on the page, it is saved in `data/config.json`.
- Output power is **read only** over CAT (`PC;` = measured power in 0.1 W, only while transmitting) – there is no command to set it.
- A carriage return switches the QMX port into terminal mode. That is why the installer masks **ModemManager** (it sends `AT…\r` to every new ttyACM port) and brltty.

## Install on the Raspberry Pi

Raspberry Pi OS Lite (Bookworm or newer, 32 or 64 bit) on a Zero 2 W, 3, 4 or 5. Write the card with the Raspberry Pi Imager (user, SSH and – if you like – Wi-Fi in its settings), then on the Pi:

```sh
sudo apt install -y git
git clone https://github.com/cgraf63/QMX-REMOTE.git
cd QMX-REMOTE
sudo ./scripts/install.sh            # options: --oled-driver sh1106, --no-oled, --port 8080, --dry-run
sudo reboot
```

The script installs Node.js 22, creates the user `qmx`, builds into `/opt/qmx-remote`, sets the hostname `qmx-remote`, turns on I2C, masks ModemManager / brltty and installs the services (`qmx-remote` on port 80, `qmx-remote-oled`) and the polkit rule. Running it again after `git pull` updates the box.

Radio: USB cable to the Pi's **USB** port (not PWR) – on the Zero 2 W with a micro-USB OTG adapter or cable.

Pi Zero / Zero 2 W: the script adds `dwc_otg.speed=1` to `cmdline.txt` (USB at 12 Mbit/s) – that stopped the USB drop-outs in YAESU-REMOTE. The QMX is a full-speed device anyway (CAT + 48 kHz sound card), nothing is lost. Skip with `--no-usb-fullspeed`.

Audio: the QMX's USB sound card is found automatically (the sound card on the same USB device as the CAT port); set `audio.device` / `AUDIO_DEVICE` to override.

## Run (development)

Node 22. Only runtime dependency: `ws` (audio WebSocket). The serial port is opened directly (`stty` + `/dev/ttyACM…`), no native modules.

```sh
npm install
npm run dev          # http://localhost:8080
npm run build && npm start
```

Configuration is optional – `data/config.json` or environment:

| Setting | Env | Default |
|---|---|---|
| HTTP port | `PORT` | 8080 |
| CAT device | `CAT_DEVICE` | `auto` (QRP Labs device in `/dev/serial/by-id`, first virtual COM port; else `ttyACM*`, `ttyUSB*`) |
| CAT baud rate | `CAT_BAUD` | ttyACM: 115200 (ignored by USB), serial adapters: 38400, 115200, 19200, 9600, 4800 |
| Audio device | `AUDIO_DEVICE` | `auto` (sound card of the QMX) |
| Audio on/off | `AUDIO=off` | on |
| Data directory | `QMX_DATA` | `./data` |
| Band version | `qmx.bands` in config.json, or on the page | `auto` |
| Callsign for `{CALL}` | `callsign` in config.json, or **CALL** on the page | – |

The USB port is reopened 2 s after a drop. The box notices when the radio is swapped (`VN;` reports another product, or no answer for 20 s) and searches again.

## Wi-Fi (no hotspot on the Pi)

The box joins the home router or the phone hotspot. Setup in the browser: **WI-FI** on the remote page (`/wifi.html`).

- **First start:** turn on a phone hotspot `QMX-REMOTE`, password `qmx-remote` (2.4 GHz / iPhone “Maximise Compatibility”). The box joins it; open `http://qmx-remote.local` or the address shown in the phone's hotspot settings.
- **Or** put `wifi.txt` on the boot drive of the SD card (see `system/wifi.txt.example`): `ssid=` / `password=` pairs, best first, optional `country=`. Imported at start, passwords are removed from the file afterwards.
- **Saved networks in order** (NetworkManager autoconnect priority 100, 90, …): the box takes the first one in range. The setup network always stays last (priority −100) and cannot be deleted.
- **Switching** warns first (the page loses the connection). If the new network does not come up within 30 s, the box goes back to the previous one.
- **ntfy:** with a topic set, the box sends “QMX-REMOTE online – 192.168.x.x” with a link whenever it gets a new address (Android often cannot open `.local` names).

On the Pi: `system/qmx-remote.service` (systemd, user `qmx`, imports `wifi.txt` as root before the start) and `system/50-qmx-remote.rules` (polkit: user `qmx` may manage NetworkManager, no sudo).

## OLED status display (optional)

A 0.96" I2C OLED (SSD1306, 128 × 64; 1.3" SH1106 works too) shows the radio (QMX / QMX+) with frequency and mode (model inverted while transmitting), the Wi-Fi network with signal, the IP address and a turning logo – as long as it turns, the Pi is running. Without Wi-Fi it shows the setup hotspot name.

Wiring: VCC → pin 1 (3.3 V), GND → pin 6, SDA → pin 3, SCL → pin 5. `oled/qmx_oled.py` uses the Python standard library only (I2C directly via `/dev/i2c-1`); service: `system/qmx-remote-oled.service`. Preview without a display: `python3 oled/qmx_oled.py --demo --png preview.png`.

## Test without a radio

`tools/sim/qmx_sim.py` simulates a QMX / QMX+ on a virtual serial port (Python 3, standard library only):

```sh
python3 tools/sim/qmx_sim.py --link /tmp/cat-sim
CAT_DEVICE=/tmp/cat-sim AUDIO=off npm run dev
```

Options: `--bands 80-20|60-15|20-10|plus` (band version), `--old-firmware` (1_02_005: no `BN`, `LC`, `TR`, `RG`, `SA`), `--model qdx|ts480` (detection test), `--rit relative`, `--verbose`. Like the QMX it stops answering after a carriage return (terminal mode).

Wi-Fi page without NetworkManager: `NMCLI=tools/sim/fake_nmcli.py` (state in `/tmp/fake-nmcli.json`: networks in range with their passwords, saved connections). A wrong password makes the switch fail and fall back, like on the Pi.

## API

| | |
|---|---|
| `GET /api/status` | server and detection status |
| `GET /api/radio` | state (409 while no radio is connected) |
| `GET /api/radio/tables` | modes, bands, tune steps, band versions |
| `POST /api/radio/control` | `{ control, value }` – frequency, frequencyB, mode, band, bandUp, bandDown, vfo, split, aEqualsB, swap, rit, ritOffset, ritClear, afGain, rfGain, keyerSpeed, step, cw, cwStop, carrier, clearDecoded, rx |
| `POST /api/radio/bands` | `{ version }` band version, saved |
| `GET/POST /api/settings` | callsign for `{CALL}` |
| `GET /api/wifi`, `…/saved`, `…/scan` | Wi-Fi status, saved networks, networks in range |
| `POST /api/wifi/add`, `…/remove`, `…/order`, `…/connect` | manage networks, switch with fallback |
| `GET/POST /api/wifi/ntfy`, `POST …/ntfy/test` | ntfy message with the address |
| `GET /api/display` | everything the OLED shows (radio, frequency, Wi-Fi, IP) |
| `WS /audio`, `WS /audio-tx` | RX / TX audio, 48 kHz, 16 bit, mono |

## Roadmap

1. ~~Server from YAESU-REMOTE, QMX driver and page from SHACK-SERVER, detection with `VN;` / `OM;`~~
2. Test on the Zero 2 W with QMX and QMX+ (detection, USB drop, sound card name)
3. QDX: test, own band list
4. TX audio from the browser (digital modes: `TX;` + USB audio), HTTPS for the microphone
5. SD card image for the Zero 2 W
